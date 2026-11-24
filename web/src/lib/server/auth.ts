import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { PoolClient } from "pg";
import { z } from "zod";
import type { PlatformRole, Portal, SessionContext, TenantKind, TenantRole, TenantSession } from "@/lib/contracts";
import { withTransaction } from "./db";
import { AppError, appOrigin } from "./http";
import { hashPassword, verifyDummyPassword, verifyPassword } from "./password";

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const ADMIN_TTL_SECONDS = 8 * 60 * 60;

type SessionRow = {
  id: string; user_id: string; email: string; display_name: string;
  platform_role: PlatformRole; portal: Portal; tenant_id: string | null;
  tenant_name: string | null; tenant_kind: TenantKind | null; tenant_role: TenantRole | null;
};

const LIVE_SESSION_SELECT = `
  SELECT s.id, s.user_id, s.portal, s.tenant_id, u.email, u.display_name,
    u.platform_role, t.name AS tenant_name, t.kind AS tenant_kind, m.role AS tenant_role
  FROM sessions s JOIN users u ON u.id = s.user_id
  LEFT JOIN tenants t ON t.id = s.tenant_id
  LEFT JOIN memberships m ON m.tenant_id = s.tenant_id AND m.user_id = s.user_id
  WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
    AND u.disabled_at IS NULL
    AND s.last_seen_at > now() - CASE WHEN s.portal = 'admin' THEN interval '30 minutes' ELSE interval '24 hours' END
    AND ((s.portal = 'admin' AND u.platform_role = 'super_admin') OR
      (s.portal IN ('individual', 'company') AND s.portal = t.kind AND m.active AND t.status = 'active'))`;

function sessionFromRow(row: SessionRow): SessionContext {
  return {
    sessionId: row.id, userId: row.user_id, email: row.email,
    displayName: row.display_name, platformRole: row.platform_role,
    portal: row.portal, tenantId: row.tenant_id, tenantName: row.tenant_name,
    tenantKind: row.tenant_kind, tenantRole: row.tenant_role,
  };
}

export function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionCookieName(): string {
  return process.env.NODE_ENV === "production" ? "__Host-aoos_session" : "aoos_session";
}

export function safeSessionDTO(session: SessionContext): SessionContext {
  // SessionContext deliberately contains no bearer token, hash, or credential.
  return { ...session };
}

export async function setSessionCookie(token: string, portal: Portal): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName(), token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/",
    maxAge: portal === "admin" ? ADMIN_TTL_SECONDS : SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName(), "", {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0,
  });
}

export async function getSession(): Promise<SessionContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName())?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return withTransaction(async (client) => {
    const result = await client.query<SessionRow>(LIVE_SESSION_SELECT, [tokenDigest(token)]);
    const row = result.rows[0];
    if (!row) return null;
    await client.query(`UPDATE sessions SET last_seen_at = now()
      WHERE id = $1 AND last_seen_at < now() - interval '1 minute'`, [row.id]);
    return sessionFromRow(row);
  });
}

export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) throw new AppError(401, "UNAUTHENTICATED", "سجّل الدخول للمتابعة.");
  return session;
}

export async function requireTenant(permission: "read" | "write" | "manage" = "read"): Promise<TenantSession> {
  const session = await requireSession();
  if (!session.tenantId || !session.tenantName || !session.tenantKind || !session.tenantRole || session.portal === "admin") {
    throw new AppError(403, "TENANT_REQUIRED", "سجّل الدخول عبر بوابة الأفراد أو الشركات للوصول إلى مساحة العمل.");
  }
  if ((permission === "write" && session.tenantRole === "viewer")
    || (permission === "manage" && !["owner", "admin"].includes(session.tenantRole))) {
    throw new AppError(403, "FORBIDDEN", "لا تملك الصلاحية المطلوبة لهذا الإجراء.");
  }
  return session as TenantSession;
}

export async function requireAdmin(): Promise<SessionContext> {
  const session = await requireSession();
  if (session.platformRole !== "super_admin" || session.portal !== "admin") {
    throw new AppError(403, "ADMIN_REQUIRED", "هذه الصفحة متاحة لإدارة المنصة فقط.");
  }
  return session;
}

export async function createSession(
  client: PoolClient, userId: string, portal: Portal, tenantId: string | null,
): Promise<{ token: string; session: SessionContext }> {
  const token = randomBytes(32).toString("base64url");
  const digest = tokenDigest(token);
  await client.query(`INSERT INTO sessions (token_hash, user_id, portal, tenant_id, expires_at)
    VALUES ($1, $2, $3, $4, now() + ($5 * interval '1 second'))`,
  [digest, userId, portal, tenantId, portal === "admin" ? ADMIN_TTL_SECONDS : SESSION_TTL_SECONDS]);
  const result = await client.query<SessionRow>(LIVE_SESSION_SELECT, [digest]);
  if (!result.rows[0]) throw new AppError(403, "ACCOUNT_UNAVAILABLE", "تعذّر إنشاء جلسة لهذا الحساب.");
  return { token, session: sessionFromRow(result.rows[0]) };
}

export async function revokeSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName())?.value;
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
    await withTransaction(async (client) => {
      await client.query("UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL", [tokenDigest(token)]);
    });
  }
  await clearSessionCookie();
}

type LoginInput = { email: string; password: string; portal: Portal; tenantId?: string };
type TenantChoice = { id: string; name: string; kind: TenantKind; role: TenantRole };
type LoginResult = { token: string; session: SessionContext; redirectTo: string }
  | { requiresTenantSelection: true; tenants: TenantChoice[] };

export async function login(input: LoginInput): Promise<LoginResult> {
  return withTransaction(async (client) => {
    const result = await client.query<{
      id: string; password_hash: string; disabled_at: Date | null; platform_role: PlatformRole;
    }>("SELECT id, password_hash, disabled_at, platform_role FROM users WHERE email = $1", [input.email.trim().toLowerCase()]);
    const user = result.rows[0];
    const valid = user ? await verifyPassword(input.password, user.password_hash) : (await verifyDummyPassword(input.password), false);
    const fail = () => new AppError(401, "INVALID_CREDENTIALS", "تعذّر تسجيل الدخول. تحقق من بياناتك والبوابة المختارة.");
    if (!user || !valid || user.disabled_at) throw fail();
    let tenantId: string | null = null;
    if (input.portal === "admin") {
      if (user.platform_role !== "super_admin" || input.tenantId) throw fail();
    } else {
      const memberships = await client.query<TenantChoice>(`
        SELECT t.id, t.name, t.kind, m.role FROM memberships m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = $1 AND m.active AND t.status = 'active' AND t.kind = $2
        ORDER BY t.name, t.id`, [user.id, input.portal]);
      if (!memberships.rows.length) throw fail();
      if (!input.tenantId && memberships.rows.length > 1) {
        return { requiresTenantSelection: true as const, tenants: memberships.rows };
      }
      const selected = input.tenantId ? memberships.rows.find((tenant) => tenant.id === input.tenantId) : memberships.rows[0];
      if (!selected) throw fail();
      tenantId = selected.id;
    }
    const session = await createSession(client, user.id, input.portal, tenantId);
    await writeAuditEvent(client, {
      actorUserId: user.id, tenantId, action: "auth.login", targetType: "session", targetId: session.session.sessionId,
      metadata: { portal: input.portal },
    });
    return { ...session, redirectTo: input.portal === "admin" ? "/admin" : "/app/dashboard" };
  });
}

export async function acceptInvitation(input: { token: string; name: string; password: string }): Promise<{
  token: string; session: SessionContext; redirectTo: string;
}> {
  return withTransaction(async (client) => {
    const result = await client.query<{
      id: string; email: string; tenant_id: string; role: TenantRole; kind: TenantKind; tenant_name: string;
    }>(`SELECT i.id, i.email, i.tenant_id, i.role, t.kind, t.name AS tenant_name
       FROM invitations i JOIN tenants t ON t.id = i.tenant_id
       WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.revoked_at IS NULL
         AND i.expires_at > now() AND t.status = 'active'
       FOR UPDATE OF i, t`, [tokenDigest(input.token)]);
    const invitation = result.rows[0];
    if (!invitation) throw new AppError(400, "INVALID_INVITATION", "الدعوة غير صالحة، أو انتهت مدتها، أو استُخدمت سابقًا.");
    if (invitation.kind === "individual") {
      const occupied = await client.query("SELECT 1 FROM memberships WHERE tenant_id = $1", [invitation.tenant_id]);
      if (occupied.rowCount) throw new AppError(409, "WORKSPACE_OCCUPIED", "هذه المساحة الفردية مرتبطة بحساب بالفعل.");
    }
    type User = { id: string; password_hash: string; disabled_at: Date | null };
    let user = (await client.query<User>("SELECT id, password_hash, disabled_at FROM users WHERE email = $1 FOR UPDATE", [invitation.email])).rows[0];
    let created = false;
    if (!user) {
      const passwordHash = await hashPassword(input.password);
      const inserted = await client.query<User>(`INSERT INTO users (email, display_name, password_hash)
        VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING id, password_hash, disabled_at`,
      [invitation.email, input.name, passwordHash]);
      user = inserted.rows[0];
      created = Boolean(user);
      // A concurrent acceptance may have created this identity. It still must
      // prove knowledge of that account's password; an invite cannot reset it.
      if (!user) user = (await client.query<User>("SELECT id, password_hash, disabled_at FROM users WHERE email = $1 FOR UPDATE", [invitation.email])).rows[0];
    }
    if (!user || user.disabled_at || (!created && !await verifyPassword(input.password, user.password_hash))) {
      throw new AppError(401, "INVITATION_ACCOUNT_CHECK", "إذا كان لديك حساب بهذا البريد فاستخدم كلمة مروره الحالية، أو تواصل مع مسؤول المنصة.");
    }
    const membership = await client.query(`INSERT INTO memberships (tenant_id, user_id, role)
      VALUES ($1, $2, $3) ON CONFLICT (tenant_id, user_id) DO UPDATE
        SET active = true, role = EXCLUDED.role WHERE NOT memberships.active RETURNING role`,
    [invitation.tenant_id, user.id, invitation.role]);
    if (!membership.rowCount) throw new AppError(409, "ALREADY_MEMBER", "الحساب عضو في هذه المساحة بالفعل. سجّل الدخول مباشرة.");
    await client.query("UPDATE invitations SET used_at = now(), used_by = $2 WHERE id = $1", [invitation.id, user.id]);
    await client.query(`SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true),
      set_config('app.tenant_role', $3, true)`, [user.id, invitation.tenant_id, invitation.role]);
    if (["owner", "admin"].includes(invitation.role)) {
      await client.query("INSERT INTO profiles (tenant_id, name, email) VALUES ($1, $2, $3) ON CONFLICT (tenant_id) DO NOTHING",
        [invitation.tenant_id, invitation.tenant_name, invitation.email]);
    }
    if (invitation.role !== "viewer") {
      await client.query("INSERT INTO preferences (tenant_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [invitation.tenant_id, user.id]);
    }
    const session = await createSession(client, user.id, invitation.kind, invitation.tenant_id);
    await writeAuditEvent(client, {
      actorUserId: user.id, tenantId: invitation.tenant_id, action: "invitation.accepted",
      targetType: "invitation", targetId: invitation.id, metadata: { role: invitation.role, newUser: created },
    });
    return { ...session, redirectTo: "/app/dashboard" };
  });
}

export async function writeAuditEvent(client: PoolClient, event: {
  actorUserId: string; tenantId?: string | null; action: string; targetType: string; targetId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await client.query(`INSERT INTO audit_events (actor_user_id, tenant_id, action, target_type, target_id, metadata)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb)`, [event.actorUserId, event.tenantId ?? null, event.action,
    event.targetType, event.targetId ?? null, JSON.stringify(event.metadata ?? {})]);
}

async function assertAdminInTransaction(client: PoolClient, ctx: SessionContext): Promise<void> {
  const result = await client.query(`SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = $1 AND s.user_id = $2 AND s.portal = 'admin' AND u.platform_role = 'super_admin'
      AND u.disabled_at IS NULL AND s.revoked_at IS NULL AND s.expires_at > now()
      AND s.last_seen_at > now() - interval '30 minutes'`, [ctx.sessionId, ctx.userId]);
  if (!result.rowCount) throw new AppError(403, "ADMIN_REQUIRED", "جلسة الإدارة غير صالحة. سجّل الدخول مجددًا.");
}

const adminListSchema = z.object({
  page: z.number().int().min(1).max(1_000_000).default(1),
  limit: z.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).regex(/^[^\u0000-\u001f\u007f]*$/).default(""),
}).strict();

export type AdminListOptions = z.output<typeof adminListSchema>;
export type AdminPageMetadata = { page: number; limit: number; total: number; totalPages: number };

export function readAdminListOptions(request: Request): AdminListOptions {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) {
    if (!["page", "limit", "search"].includes(key) || params.getAll(key).length !== 1) {
      throw new AppError(400, "INVALID_INPUT", "معايير البحث أو ترقيم الصفحات غير صحيحة.");
    }
  }
  const page = params.get("page") ?? "1";
  const limit = params.get("limit") ?? "25";
  if (!/^[1-9]\d*$/.test(page) || !/^[1-9]\d*$/.test(limit)) {
    throw new AppError(400, "INVALID_INPUT", "رقم الصفحة وحجمها يجب أن يكونا عددين صحيحين موجبين.");
  }
  return adminListSchema.parse({ page: Number(page), limit: Number(limit), search: params.get("search") ?? "" });
}

function pageMetadata(options: AdminListOptions, total: number): AdminPageMetadata {
  return { page: options.page, limit: options.limit, total, totalPages: Math.ceil(total / options.limit) };
}

function adminSearchPattern(search: string): string {
  // An explicit ! escape makes %, _ and ! literal, while backslashes are
  // ordinary characters. User text is always bound as a SQL parameter.
  return `%${search.replace(/[!%_]/g, "!$&")}%`;
}

type AdminUserRow = {
  id: string; email: string; displayName: string; platformRole: PlatformRole; disabled: boolean; createdAt: string;
  memberships: { tenantId: string; tenantName: string; role: TenantRole }[];
};

type AdminTenantRow = {
  id: string; name: string; kind: TenantKind; status: "active" | "suspended";
  plan: "free" | "starter" | "professional" | "enterprise"; memberCount: number; createdAt: string;
};

async function queryAdminUsers(client: PoolClient, options: AdminListOptions) {
  // Count and page use one SQL snapshot. Membership expansion happens only for
  // the selected users, never for an unbounded application-side result set.
  const result = await client.query<{ total: number; users: AdminUserRow[] }>(`
    WITH filtered AS (
      SELECT id, email, display_name, platform_role, disabled_at, created_at FROM users
      WHERE email ILIKE $1 ESCAPE '!' OR display_name ILIKE $1 ESCAPE '!'
    ), paged AS (
      SELECT * FROM filtered ORDER BY created_at DESC, id LIMIT $2 OFFSET $3
    )
    SELECT (SELECT count(*)::int FROM filtered) AS total,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'email', p.email, 'displayName', p.display_name,
        'platformRole', p.platform_role, 'disabled', p.disabled_at IS NOT NULL,
        'createdAt', p.created_at, 'memberships', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('tenantId', t.id, 'tenantName', t.name, 'role', m.role)
            ORDER BY m.created_at, m.tenant_id)
          FROM memberships m JOIN tenants t ON t.id = m.tenant_id
          WHERE m.user_id = p.id AND m.active
        ), '[]'::jsonb)) ORDER BY p.created_at DESC, p.id) FROM paged p), '[]'::jsonb) AS users`,
  [adminSearchPattern(options.search), options.limit, (options.page - 1) * options.limit]);
  return { users: result.rows[0].users, pagination: pageMetadata(options, result.rows[0].total) };
}

async function queryAdminTenants(client: PoolClient, options: AdminListOptions) {
  const result = await client.query<{ total: number; tenants: AdminTenantRow[] }>(`
    WITH filtered AS (
      SELECT id, name, kind, status, plan, created_at FROM tenants WHERE name ILIKE $1 ESCAPE '!'
    ), paged AS (
      SELECT * FROM filtered ORDER BY created_at DESC, id LIMIT $2 OFFSET $3
    )
    SELECT (SELECT count(*)::int FROM filtered) AS total,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'kind', p.kind, 'status', p.status, 'plan', p.plan,
        'createdAt', p.created_at, 'memberCount', (
          SELECT count(*)::int FROM memberships m WHERE m.tenant_id = p.id AND m.active
        )) ORDER BY p.created_at DESC, p.id) FROM paged p), '[]'::jsonb) AS tenants`,
  [adminSearchPattern(options.search), options.limit, (options.page - 1) * options.limit]);
  return { tenants: result.rows[0].tenants, pagination: pageMetadata(options, result.rows[0].total) };
}

export async function listAdminUsers(ctx: SessionContext, options: Partial<AdminListOptions> = {}) {
  return withTransaction(async (client) => {
    await assertAdminInTransaction(client, ctx);
    return queryAdminUsers(client, adminListSchema.parse(options));
  });
}

export async function listAdminTenants(ctx: SessionContext, options: Partial<AdminListOptions> = {}) {
  return withTransaction(async (client) => {
    await assertAdminInTransaction(client, ctx);
    return queryAdminTenants(client, adminListSchema.parse(options));
  });
}

export async function adminOverview(ctx: SessionContext) {
  return withTransaction(async (client) => {
    await assertAdminInTransaction(client, ctx);
    const options = adminListSchema.parse({});
    const users = await queryAdminUsers(client, options);
    const tenants = await queryAdminTenants(client, options);
    const stats = await client.query<{ users: number; tenants: number; activeTenants: number; pendingInvitations: number }>(`
      SELECT (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM tenants) AS tenants,
        (SELECT count(*)::int FROM tenants WHERE status = 'active') AS "activeTenants",
        (SELECT count(*)::int FROM invitations WHERE used_at IS NULL AND revoked_at IS NULL
          AND expires_at > now()) AS "pendingInvitations"`);
    return { users: users.users, tenants: tenants.tenants, stats: stats.rows[0],
      pagination: { users: users.pagination, tenants: tenants.pagination } };
  });
}

export async function createInvitation(ctx: SessionContext, input: {
  email: string; name: string; tenantName?: string; kind: TenantKind; role: TenantRole; tenantId?: string;
}) {
  // Validate deployment configuration before creating durable state.
  const origin = appOrigin();
  return withTransaction(async (client) => {
    await assertAdminInTransaction(client, ctx);
    let tenant: { id: string; name: string; kind: TenantKind; status: string } | undefined;
    if (input.tenantId) {
      tenant = (await client.query<typeof tenant & object>("SELECT id, name, kind, status FROM tenants WHERE id = $1 FOR UPDATE", [input.tenantId])).rows[0];
      if (!tenant || tenant.status !== "active" || tenant.kind !== input.kind) {
        throw new AppError(400, "INVALID_TENANT", "المساحة غير متاحة أو لا تطابق نوع الدعوة.");
      }
      if (tenant.kind === "individual") throw new AppError(400, "PERSONAL_WORKSPACE", "المساحة الفردية لا تدعم دعوة أعضاء إضافيين.");
      const existing = await client.query(`SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = $1 AND u.email = $2 AND m.active`, [tenant.id, input.email]);
      if (existing.rowCount) throw new AppError(409, "ALREADY_MEMBER", "هذا البريد عضو في المساحة بالفعل.");
    } else {
      if (input.role !== "owner" || !input.tenantName) throw new AppError(400, "OWNER_REQUIRED", "تحتاج المساحة الجديدة إلى دعوة مالك باسم مساحة واضح.");
      tenant = (await client.query<{ id: string; name: string; kind: TenantKind; status: string }>(
        "INSERT INTO tenants (name, kind, plan) VALUES ($1, $2, $3) RETURNING id, name, kind, status",
        [input.tenantName, input.kind, input.kind === "individual" ? "free" : "starter"])).rows[0];
    }
    const token = randomBytes(32).toString("base64url");
    const result = await client.query<{ id: string; expires_at: Date }>(`INSERT INTO invitations
      (token_hash, email, name, tenant_id, role, invited_by, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, now() + interval '7 days') RETURNING id, expires_at`,
    [tokenDigest(token), input.email, input.name, tenant.id, input.role, ctx.userId]);
    const invitation = result.rows[0];
    await writeAuditEvent(client, {
      actorUserId: ctx.userId, tenantId: tenant.id, action: "invitation.created", targetType: "invitation",
      targetId: invitation.id, metadata: { email: input.email, role: input.role, newTenant: !input.tenantId },
    });
    return {
      invitation: { id: invitation.id, email: input.email, tenantId: tenant.id, tenantName: tenant.name,
        kind: tenant.kind, role: input.role, expiresAt: invitation.expires_at.toISOString() },
      inviteUrl: `${origin}/invite?token=${encodeURIComponent(token)}`,
    };
  });
}

export async function listInvitations(ctx: SessionContext, input: Partial<AdminListOptions> = {}) {
  return withTransaction(async (client) => {
    await assertAdminInTransaction(client, ctx);
    const options = adminListSchema.parse(input);
    const result = await client.query<{
      total: number;
      invitations: { id: string; email: string; tenantId: string; tenantName: string; kind: TenantKind;
        role: TenantRole; expiresAt: string; createdAt: string; status: "pending" | "used" | "revoked" | "expired" }[];
    }>(`WITH filtered AS (
        SELECT i.id, i.email, i.tenant_id, t.name AS tenant_name, t.kind, i.role,
          i.expires_at, i.created_at, i.used_at, i.revoked_at
        FROM invitations i JOIN tenants t ON t.id = i.tenant_id
        WHERE i.email ILIKE $1 ESCAPE '!' OR i.name ILIKE $1 ESCAPE '!' OR t.name ILIKE $1 ESCAPE '!'
      ), paged AS (
        SELECT * FROM filtered ORDER BY created_at DESC, id LIMIT $2 OFFSET $3
      )
      SELECT (SELECT count(*)::int FROM filtered) AS total,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', p.id, 'email', p.email, 'tenantId', p.tenant_id, 'tenantName', p.tenant_name,
          'kind', p.kind, 'role', p.role, 'expiresAt', p.expires_at, 'createdAt', p.created_at,
          'status', CASE WHEN p.used_at IS NOT NULL THEN 'used'
                         WHEN p.revoked_at IS NOT NULL THEN 'revoked'
                         WHEN p.expires_at <= now() THEN 'expired'
                         ELSE 'pending' END
        ) ORDER BY p.created_at DESC, p.id) FROM paged p), '[]'::jsonb) AS invitations`,
    [adminSearchPattern(options.search), options.limit, (options.page - 1) * options.limit]);
    // Neither token hashes nor invite URLs can be recovered from this listing.
    return { invitations: result.rows[0].invitations, pagination: pageMetadata(options, result.rows[0].total) };
  });
}

export async function revokeInvitation(ctx: SessionContext, invitationId: string): Promise<{ revoked: true }> {
  return withTransaction(async (client) => {
    await assertAdminInTransaction(client, ctx);
    const result = await client.query<{
      tenant_id: string; email: string; role: TenantRole;
      used_at: Date | null; revoked_at: Date | null; unexpired: boolean;
    }>(`SELECT tenant_id, email, role, used_at, revoked_at, expires_at > now() AS unexpired
      FROM invitations WHERE id = $1 FOR UPDATE`, [invitationId]);
    const invitation = result.rows[0];
    if (!invitation) throw new AppError(404, "NOT_FOUND", "الدعوة غير موجودة.");
    if (invitation.used_at || invitation.revoked_at || !invitation.unexpired) {
      throw new AppError(409, "INVITATION_NOT_PENDING", "يمكن إلغاء الدعوات المعلّقة فقط.");
    }
    // Acceptance locks this same row. Whichever action obtains it first
    // determines the outcome; the other must observe its committed status.
    await client.query("UPDATE invitations SET revoked_at = now() WHERE id = $1", [invitationId]);
    await writeAuditEvent(client, {
      actorUserId: ctx.userId, tenantId: invitation.tenant_id, action: "invitation.revoked",
      targetType: "invitation", targetId: invitationId,
      metadata: { email: invitation.email, role: invitation.role },
    });
    return { revoked: true };
  });
}

export async function updateTenant(ctx: SessionContext, tenantId: string, changes: {
  status?: "active" | "suspended"; plan?: "free" | "starter" | "professional" | "enterprise";
}) {
  return withTransaction(async (client) => {
    await assertAdminInTransaction(client, ctx);
    const before = (await client.query<{ status: string; plan: string }>("SELECT status, plan FROM tenants WHERE id = $1 FOR UPDATE", [tenantId])).rows[0];
    if (!before) throw new AppError(404, "NOT_FOUND", "المساحة غير موجودة.");
    const updated = await client.query(`UPDATE tenants SET status = COALESCE($2, status),
      plan = COALESCE($3, plan), updated_at = now() WHERE id = $1
      RETURNING id, name, kind, status, plan`, [tenantId, changes.status ?? null, changes.plan ?? null]);
    if (changes.status === "suspended") await client.query("UPDATE sessions SET revoked_at = now() WHERE tenant_id = $1 AND revoked_at IS NULL", [tenantId]);
    await writeAuditEvent(client, { actorUserId: ctx.userId, tenantId, action: "tenant.updated", targetType: "tenant",
      targetId: tenantId, metadata: { before, changes } });
    return { tenant: updated.rows[0] };
  });
}

export async function updateUserStatus(ctx: SessionContext, userId: string, disabled: boolean) {
  return withTransaction(async (client) => {
    await assertAdminInTransaction(client, ctx);
    if (userId === ctx.userId && disabled) throw new AppError(400, "SELF_DISABLE", "لا يمكنك تعطيل حساب الإدارة الذي تستخدمه الآن.");
    // Lock administrator records in a consistent order to serialize changes
    // that might otherwise disable the last active platform administrator.
    const admins = await client.query<{ id: string; disabled_at: Date | null }>(
      "SELECT id, disabled_at FROM users WHERE platform_role = 'super_admin' ORDER BY id FOR UPDATE");
    const target = (await client.query<{ id: string; disabled_at: Date | null; platform_role: PlatformRole }>(
      "SELECT id, disabled_at, platform_role FROM users WHERE id = $1 FOR UPDATE", [userId])).rows[0];
    if (!target) throw new AppError(404, "NOT_FOUND", "الحساب غير موجود.");
    if (disabled && target.platform_role === "super_admin" && !target.disabled_at
      && admins.rows.filter((admin) => !admin.disabled_at).length <= 1) {
      throw new AppError(409, "LAST_ADMIN", "يجب أن يبقى مدير منصة واحد نشط على الأقل.");
    }
    await client.query("UPDATE users SET disabled_at = CASE WHEN $2 THEN now() ELSE NULL END, updated_at = now() WHERE id = $1", [userId, disabled]);
    if (disabled) await client.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
    await writeAuditEvent(client, { actorUserId: ctx.userId, action: "user.status_changed", targetType: "user",
      targetId: userId, metadata: { wasDisabled: Boolean(target.disabled_at), disabled } });
    return { user: { id: userId, disabled } };
  });
}
