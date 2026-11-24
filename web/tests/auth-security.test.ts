import { readFile } from "node:fs/promises";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { SessionContext } from "@/lib/contracts";

const state = vi.hoisted(() => ({
  db: null as PGlite | null,
  cookies: new Map<string, string>(),
  setCookie: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (key: string) => state.cookies.has(key) ? { value: state.cookies.get(key) } : undefined,
    set: (key: string, value: string, options: { maxAge?: number }) => {
      state.setCookie(key, value, options);
      if (options.maxAge === 0) state.cookies.delete(key); else state.cookies.set(key, value);
    },
  }),
}));

// Only the transport adapter is replaced: auth SQL and PostgreSQL policies run
// against the actual migration under the restricted application role.
vi.mock("@/lib/server/db", () => ({
  withTransaction: async <T>(fn: (client: PoolClient) => Promise<T>): Promise<T> => {
    if (!state.db) throw new Error("Test database not initialized");
    return state.db.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE aoos_runtime");
      const client = { query: async (sql: string, values?: unknown[]) => {
        const result = await tx.query(sql, values);
        return { ...result, rowCount: result.rows.length || result.affectedRows || 0 };
      } } as unknown as PoolClient;
      return fn(client);
    });
  },
}));

import {
  acceptInvitation, adminOverview, createInvitation, getSession, listAdminTenants, listAdminUsers, listInvitations, login, requireAdmin,
  requireTenant, revokeSession, sessionCookieName, setSessionCookie, tokenDigest,
  updateTenant, updateUserStatus, revokeInvitation,
} from "@/lib/server/auth";
import { AppError, assertSameOrigin, jsonError, readJson } from "@/lib/server/http";
import { hashPassword, validPasswordLength, verifyPassword } from "@/lib/server/password";
import { consumeRateLimit, requestSourceKey } from "@/lib/server/rate-limit";
import { DELETE as revokeInvitationRoute } from "@/app/api/admin/invitations/[id]/route";
import { GET as adminUsersRoute } from "@/app/api/admin/users/route";
import { GET as adminTenantsRoute } from "@/app/api/admin/tenants/route";
import { GET as adminInvitationsRoute } from "@/app/api/admin/invitations/route";

const PASSWORD = "test-only password phrase 2026";
const A = "10000000-0000-4000-8000-000000000001";
const PEER = "10000000-0000-4000-8000-000000000002";
const B = "10000000-0000-4000-8000-000000000003";
const ADMIN = "10000000-0000-4000-8000-000000000004";
const TA = "20000000-0000-4000-8000-000000000001";
const TB = "20000000-0000-4000-8000-000000000002";
const CA = "30000000-0000-4000-8000-000000000001";
const CP = "30000000-0000-4000-8000-000000000002";
const CB = "30000000-0000-4000-8000-000000000003";
const DA = "40000000-0000-4000-8000-000000000001";
const DB = "40000000-0000-4000-8000-000000000002";
let passwordHash: string;

function database(): PGlite {
  if (!state.db) throw new Error("Test database not initialized");
  return state.db;
}

async function asTenant<T>(tenant: string | null, user: string = A, role = "owner", fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return database().transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE aoos_runtime");
    if (tenant) await tx.query(`SELECT set_config('app.tenant_id', $1, true),
      set_config('app.user_id', $2, true), set_config('app.tenant_role', $3, true)`, [tenant, user, role]);
    return fn(tx);
  });
}

async function loginAs(email = "a@example.test", portal: "company" | "admin" = "company") {
  const result = await login({ email, password: PASSWORD, portal });
  if ("requiresTenantSelection" in result) throw new Error("Expected a single tenant");
  return result;
}

beforeAll(async () => {
  state.db = new PGlite();
  await database().exec(await readFile(new URL("../db/migrations/001_initial.sql", import.meta.url), "utf8"));
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  vi.stubEnv("APP_ORIGIN", "https://app.example.test");
  state.cookies.clear();
  state.setCookie.mockClear();
  await database().exec("TRUNCATE users, tenants, rate_limits, audit_events CASCADE");
  for (const [id, email, role] of [[A, "a@example.test", "user"], [PEER, "peer@example.test", "user"],
    [B, "b@example.test", "user"], [ADMIN, "admin@example.test", "super_admin"]]) {
    await database().query("INSERT INTO users (id,email,display_name,password_hash,platform_role) VALUES ($1,$2,$2,$3,$4)", [id, email, passwordHash, role]);
  }
  await database().query("INSERT INTO tenants (id,name,kind) VALUES ($1,'Tenant A','company'),($2,'Tenant B','company')", [TA, TB]);
  await database().query("INSERT INTO memberships (tenant_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'member'),($4,$5,'owner')", [TA, A, PEER, TB, B]);
  await database().query("INSERT INTO profiles (tenant_id,name) VALUES ($1,'Profile A'),($2,'Profile B')", [TA, TB]);
  await database().query("INSERT INTO employees (tenant_id,name,nationality) VALUES ($1,'Employee A','saudi'),($2,'Employee B','other')", [TA, TB]);
  await database().query("INSERT INTO tasks (tenant_id,title) VALUES ($1,'Task A'),($2,'Task B')", [TA, TB]);
  for (const [tenant, user, conversation] of [[TA, A, CA], [TA, PEER, CP], [TB, B, CB]]) {
    await database().query("INSERT INTO conversations (id,tenant_id,user_id,title) VALUES ($1,$2,$3,'Private conversation')", [conversation, tenant, user]);
    await database().query("INSERT INTO messages (tenant_id,user_id,conversation_id,role,content) VALUES ($1,$2,$3,'user','Private message')", [tenant, user, conversation]);
    await database().query("INSERT INTO letters (tenant_id,user_id,title) VALUES ($1,$2,'Private letter')", [tenant, user]);
    await database().query("INSERT INTO memories (tenant_id,user_id,content) VALUES ($1,$2,'Private memory')", [tenant, user]);
    await database().query("INSERT INTO preferences (tenant_id,user_id) VALUES ($1,$2)", [tenant, user]);
  }
  await database().query("INSERT INTO documents (id,tenant_id,owner_user_id,title,content) VALUES ($1,$2,$3,'Document A','A'),($4,$5,$6,'Document B','B')", [DA, TA, A, DB, TB, B]);
  await database().query("INSERT INTO document_chunks (tenant_id,document_id,content,chunk_index) VALUES ($1,$2,'Chunk A',0),($3,$4,'Chunk B',0)", [TA, DA, TB, DB]);
});

afterEach(() => vi.unstubAllEnvs());
afterAll(async () => { await state.db?.close(); });

describe("PostgreSQL tenant and private-user isolation", () => {
  const tables = ["profiles", "employees", "tasks", "letters", "conversations", "messages", "documents", "document_chunks", "memories", "preferences"];

  it("enables and forces RLS on every business table", async () => {
    const result = await database().query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1::text[])", [tables]);
    expect(result.rows).toHaveLength(tables.length);
    for (const row of result.rows) expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("filters all tables to the active tenant and keeps peer conversations, messages, letters, memories and preferences private", async () => {
    await asTenant(TA, A, "owner", async (tx) => {
      for (const table of tables) {
        const result = await tx.query<{ tenant_id: string; user_id?: string }>(`SELECT * FROM ${table}`);
        expect(result.rows, table).toHaveLength(1);
        expect(result.rows[0].tenant_id).toBe(TA);
        if (result.rows[0].user_id) expect(result.rows[0].user_id).toBe(A);
      }
      expect((await tx.query("SELECT id FROM conversations WHERE id = $1", [CB])).rows).toEqual([]);
      expect((await tx.query("UPDATE conversations SET title = 'stolen' WHERE id = $1 RETURNING id", [CB])).rows).toEqual([]);
      expect((await tx.query("DELETE FROM documents WHERE id = $1 RETURNING id", [DB])).rows).toEqual([]);
    });
  });

  it("denies reads with missing context and clears local context after both commit and rollback", async () => {
    await asTenant(TA, A, "owner", async (tx) => { expect((await tx.query("SELECT * FROM documents")).rows).toHaveLength(1); });
    await asTenant(null, A, "owner", async (tx) => {
      for (const table of tables) expect((await tx.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0);
    });
    await expect(asTenant(TA, A, "owner", async () => { throw new Error("rollback fixture"); })).rejects.toThrow("rollback fixture");
    await asTenant(null, A, "owner", async (tx) => { expect((await tx.query("SELECT * FROM documents")).rows).toHaveLength(0); });
  });

  it("rejects cross-tenant insertion and tenant reassignment", async () => {
    await expect(asTenant(TA, A, "owner", (tx) => tx.query("INSERT INTO tasks (tenant_id,title) VALUES ($1,'illegal')", [TB])))
      .rejects.toMatchObject({ code: "42501" });
    await expect(asTenant(TA, A, "owner", (tx) => tx.query("UPDATE tasks SET tenant_id = $1 WHERE tenant_id = $2", [TB, TA])))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("rejects cross-tenant document parents and another user's conversation parent", async () => {
    await expect(asTenant(TA, A, "owner", (tx) => tx.query("INSERT INTO document_chunks (tenant_id,document_id,content,chunk_index) VALUES ($1,$2,'illegal',1)", [TA, DB])))
      .rejects.toMatchObject({ code: "23503" });
    await expect(asTenant(TA, A, "owner", (tx) => tx.query("INSERT INTO messages (tenant_id,user_id,conversation_id,role,content) VALUES ($1,$2,$3,'user','illegal')", [TA, A, CP])))
      .rejects.toMatchObject({ code: "23503" });
  });

  it("allows members to read company knowledge, restricts its mutation, and prevents viewer writes", async () => {
    await asTenant(TA, PEER, "member", async (tx) => {
      expect((await tx.query("SELECT * FROM documents")).rows).toHaveLength(1);
      expect((await tx.query("UPDATE documents SET content = 'illegal' RETURNING id")).rows).toHaveLength(0);
    });
    await expect(asTenant(TA, PEER, "member", (tx) => tx.query("INSERT INTO documents (tenant_id,owner_user_id,title,content) VALUES ($1,$2,'illegal','illegal')", [TA, PEER])))
      .rejects.toMatchObject({ code: "42501" });
    await expect(asTenant(TA, PEER, "viewer", (tx) => tx.query("INSERT INTO tasks (tenant_id,title) VALUES ($1,'illegal')", [TA])))
      .rejects.toMatchObject({ code: "42501" });
  });

  it("prevents runtime role escalation, RLS removal, truncation and audit deletion", async () => {
    const commands = [
      "UPDATE users SET platform_role = 'super_admin' WHERE email = 'a@example.test'",
      "ALTER TABLE documents DISABLE ROW LEVEL SECURITY", "TRUNCATE tasks", "DELETE FROM audit_events",
      "INSERT INTO users (email,display_name,password_hash,platform_role) VALUES ('rogue@example.test','Rogue','hash','super_admin')",
    ];
    for (const sql of commands) await expect(asTenant(TA, A, "owner", (tx) => tx.query(sql))).rejects.toMatchObject({ code: "42501" });
  });
});

describe("passwords, sessions, admin boundaries and invitations", () => {
  it("uses slow salted verifiers and rejects short, huge and malformed password inputs", async () => {
    expect(passwordHash).toMatch(/^scrypt\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
    expect(await verifyPassword(PASSWORD, passwordHash)).toBe(true);
    expect(await verifyPassword("an incorrect password", passwordHash)).toBe(false);
    expect(await verifyPassword(PASSWORD, "scrypt$999999999$8$1$bad$bad")).toBe(false);
    expect(validPasswordLength("short")).toBe(false);
    expect(validPasswordLength("س".repeat(129))).toBe(false);
    expect(validPasswordLength("عبارة مرور عربية طويلة وآمنة")).toBe(true);
  });

  it("stores only opaque-token hashes and never grants admin from a requested portal", async () => {
    const authenticated = await loginAs();
    expect(authenticated.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await database().query<{ token_hash: string }>("SELECT token_hash FROM sessions WHERE id = $1", [authenticated.session.sessionId]);
    expect(stored.rows[0].token_hash).toBe(tokenDigest(authenticated.token));
    expect(JSON.stringify(authenticated.session)).not.toContain(authenticated.token);
    await expect(login({ email: "a@example.test", password: PASSWORD, portal: "admin" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await setSessionCookie(authenticated.token, "company");
    await expect(requireAdmin()).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
  });

  it("immediately rejects server-revoked, expired, idle and disabled sessions", async () => {
    const authenticated = await loginAs();
    await setSessionCookie(authenticated.token, "company");
    expect((await getSession())?.userId).toBe(A);
    await revokeSession();
    state.cookies.set(sessionCookieName(), authenticated.token); // replay a copied cookie
    expect(await getSession()).toBeNull();
    const second = await loginAs();
    state.cookies.set(sessionCookieName(), second.token);
    await database().query("UPDATE sessions SET created_at = now() - interval '2 days', expires_at = now() - interval '1 second' WHERE id = $1", [second.session.sessionId]);
    expect(await getSession()).toBeNull();
    const third = await loginAs();
    state.cookies.set(sessionCookieName(), third.token);
    await database().query("UPDATE sessions SET last_seen_at = now() - interval '25 hours' WHERE id = $1", [third.session.sessionId]);
    expect(await getSession()).toBeNull();
    const fourth = await loginAs();
    state.cookies.set(sessionCookieName(), fourth.token);
    await database().query("UPDATE users SET disabled_at = now() WHERE id = $1", [A]);
    expect(await getSession()).toBeNull();
  });

  it("rechecks current membership roles and access on every request", async () => {
    const authenticated = await loginAs();
    state.cookies.set(sessionCookieName(), authenticated.token);
    expect((await requireTenant("manage")).tenantId).toBe(TA);
    await database().query("UPDATE memberships SET role = 'viewer' WHERE tenant_id = $1 AND user_id = $2", [TA, A]);
    await expect(requireTenant("write")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await database().query("UPDATE memberships SET active = false WHERE tenant_id = $1 AND user_id = $2", [TA, A]);
    expect(await getSession()).toBeNull();
  });

  it("suspends tenant access, revokes user sessions and records admin operations", async () => {
    const admin = await loginAs("admin@example.test", "admin");
    const user = await loginAs();
    await updateTenant(admin.session, TA, { status: "suspended", plan: "professional" });
    state.cookies.set(sessionCookieName(), user.token);
    expect(await getSession()).toBeNull();
    await updateUserStatus(admin.session, B, true);
    const overview = await adminOverview(admin.session);
    expect(overview.users.find((candidate) => candidate.id === B)?.disabled).toBe(true);
    expect((await database().query("SELECT * FROM audit_events WHERE action IN ('tenant.updated','user.status_changed')")).rows).toHaveLength(2);
    await expect(updateUserStatus(admin.session, ADMIN, true)).rejects.toMatchObject({ code: "SELF_DISABLE" });
  });

  it("does not let a tenant session call platform admin operations", async () => {
    const user = await loginAs();
    const forged = { ...user.session, platformRole: "super_admin", portal: "admin" } as SessionContext;
    await expect(adminOverview(forged)).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
  });

  it("accepts an invitation only once and creates only an ordinary platform user", async () => {
    const admin = await loginAs("admin@example.test", "admin");
    const invitation = await createInvitation(admin.session, { email: "new@example.test", name: "New user", tenantName: "New tenant", kind: "individual", role: "owner" });
    const token = new URL(invitation.inviteUrl).searchParams.get("token")!;
    const input = { token, name: "New user", password: PASSWORD };
    const accepted = await acceptInvitation(input);
    expect(accepted.session).toMatchObject({ platformRole: "user", tenantKind: "individual", tenantRole: "owner" });
    await expect(acceptInvitation(input)).rejects.toMatchObject({ code: "INVALID_INVITATION" });
    await expect(revokeInvitation(admin.session, invitation.invitation.id)).rejects.toMatchObject({ status: 409, code: "INVITATION_NOT_PENDING" });
    expect((await listInvitations(admin.session)).invitations[0].status).toBe("used");
    expect((await database().query("SELECT memory_enabled FROM preferences WHERE tenant_id = $1", [accepted.session.tenantId])).rows).toEqual([{ memory_enabled: false }]);
  });

  it("lists invitations without tokens and atomically revokes pending invitations with an audit event", async () => {
    const admin = await loginAs("admin@example.test", "admin");
    const invitation = await createInvitation(admin.session, {
      email: "revoked@example.test", name: "Invitee", kind: "company", role: "member", tenantId: TA,
    });
    const token = new URL(invitation.inviteUrl).searchParams.get("token")!;
    const before = await listInvitations(admin.session);
    expect(before.invitations).toEqual([expect.objectContaining({
      id: invitation.invitation.id, email: "revoked@example.test", tenantId: TA,
      tenantName: "Tenant A", kind: "company", role: "member", status: "pending",
    })]);
    expect(JSON.stringify(before)).not.toContain(token);
    expect(JSON.stringify(before)).not.toContain(tokenDigest(token));
    expect(await revokeInvitation(admin.session, invitation.invitation.id)).toEqual({ revoked: true });
    expect((await listInvitations(admin.session)).invitations[0].status).toBe("revoked");
    await expect(acceptInvitation({ token, name: "Invitee", password: PASSWORD })).rejects.toMatchObject({ code: "INVALID_INVITATION" });
    await expect(revokeInvitation(admin.session, invitation.invitation.id)).rejects.toMatchObject({ status: 409 });
    await expect(revokeInvitation(admin.session, "90000000-0000-4000-8000-000000000001")).rejects.toMatchObject({ status: 404 });
    const audit = await database().query<{ actor_user_id: string; target_id: string }>(
      "SELECT actor_user_id, target_id FROM audit_events WHERE action = 'invitation.revoked'");
    expect(audit.rows).toEqual([{ actor_user_id: ADMIN, target_id: invitation.invitation.id }]);
  });

  it("rejects invitation listing and revocation from a tenant session with HTTP 403", async () => {
    const admin = await loginAs("admin@example.test", "admin");
    const invitation = await createInvitation(admin.session, {
      email: "pending@example.test", name: "Invitee", kind: "company", role: "member", tenantId: TA,
    });
    const user = await loginAs();
    state.cookies.set(sessionCookieName(), user.token);
    const response = await revokeInvitationRoute(new Request("https://app.example.test/api/admin/invitations/example", {
      method: "DELETE", headers: { Origin: "https://app.example.test" },
    }), { params: Promise.resolve({ id: invitation.invitation.id }) });
    expect(response.status).toBe(403);
    await expect(listInvitations(user.session)).rejects.toMatchObject({ status: 403 });
    await expect(revokeInvitation({ ...user.session, portal: "admin", platformRole: "super_admin" }, invitation.invitation.id))
      .rejects.toMatchObject({ status: 403 });
    expect((await listInvitations(admin.session)).invitations[0].status).toBe("pending");
  });

  it("returns 409 for an expired invitation and revalidates the admin session before revoking", async () => {
    const admin = await loginAs("admin@example.test", "admin");
    const invitation = await createInvitation(admin.session, {
      email: "expired@example.test", name: "Invitee", kind: "company", role: "member", tenantId: TA,
    });
    await database().query(`UPDATE invitations SET created_at = now() - interval '8 days',
      expires_at = now() - interval '1 second' WHERE id = $1`, [invitation.invitation.id]);
    expect((await listInvitations(admin.session)).invitations[0].status).toBe("expired");
    await expect(revokeInvitation(admin.session, invitation.invitation.id)).rejects.toMatchObject({ status: 409 });
    await database().query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [admin.session.sessionId]);
    await expect(revokeInvitation(admin.session, invitation.invitation.id)).rejects.toMatchObject({ status: 403 });
  });

  it("requires an existing account's password and never resets it through an invitation", async () => {
    const admin = await loginAs("admin@example.test", "admin");
    const invitation = await createInvitation(admin.session, { email: "a@example.test", name: "A", tenantName: "Second company", kind: "company", role: "owner" });
    const token = new URL(invitation.inviteUrl).searchParams.get("token")!;
    await expect(acceptInvitation({ token, name: "Changed name", password: "another long password 2026" })).rejects.toMatchObject({ code: "INVITATION_ACCOUNT_CHECK" });
    await acceptInvitation({ token, name: "Changed name", password: PASSWORD });
    const user = (await database().query<{ password_hash: string; display_name: string }>("SELECT password_hash,display_name FROM users WHERE id = $1", [A])).rows[0];
    expect(user.password_hash).toBe(passwordHash);
    expect(user.display_name).toBe("a@example.test");
    const selection = await login({ email: "a@example.test", password: PASSWORD, portal: "company" });
    expect(selection).toMatchObject({ requiresTenantSelection: true });
  });

  it("sets production cookies with host scope, HttpOnly, Secure and explicit SameSite", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await setSessionCookie("test-token", "admin");
    expect(state.setCookie).toHaveBeenCalledWith("__Host-aoos_session", "test-token", expect.objectContaining({
      httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 28_800,
    }));
    expect(state.setCookie.mock.calls[0][2]).not.toHaveProperty("domain");
  });
});

describe("bounded administrator pagination and literal search", () => {
  it("keeps every record beyond the former 500-row cutoff reachable while global statistics stay complete", async () => {
    const admin = await loginAs("admin@example.test", "admin");
    await database().query(`INSERT INTO users (email, display_name, password_hash)
      SELECT 'bulk-' || lpad(n::text, 3, '0') || '@example.test', 'Bulk user ' || n::text, $1
      FROM generate_series(1, 520) n`, [passwordHash]);
    await database().query(`INSERT INTO tenants (name, kind, status)
      SELECT 'Bulk tenant ' || n::text, 'company', CASE WHEN n % 2 = 0 THEN 'active' ELSE 'suspended' END
      FROM generate_series(1, 520) n`);
    await database().query(`INSERT INTO invitations (token_hash, email, name, tenant_id, role, invited_by, expires_at)
      SELECT lpad(to_hex(n), 64, '0'), 'bulk-invite-' || n::text || '@example.test', 'Bulk invite ' || n::text,
        $1, 'member', $2, now() + interval '7 days' FROM generate_series(1, 520) n`, [TA, ADMIN]);

    const firstUsers = await listAdminUsers(admin.session, { limit: 100 });
    const lastUsers = await listAdminUsers(admin.session, { page: 6, limit: 100 });
    expect(firstUsers.users).toHaveLength(100);
    expect(lastUsers.users).toHaveLength(24);
    expect(lastUsers.pagination).toEqual({ page: 6, limit: 100, total: 524, totalPages: 6 });
    const firstIds = new Set(firstUsers.users.map((user) => user.id));
    expect(lastUsers.users.some((user) => firstIds.has(user.id))).toBe(false);
    expect((await listAdminUsers(admin.session, { page: 6, limit: 100 })).users.map((user) => user.id))
      .toEqual(lastUsers.users.map((user) => user.id));

    const lastTenants = await listAdminTenants(admin.session, { page: 6, limit: 100 });
    expect(lastTenants.tenants).toHaveLength(22);
    expect(lastTenants.pagination).toEqual({ page: 6, limit: 100, total: 522, totalPages: 6 });
    const lastInvitations = await listInvitations(admin.session, { page: 6, limit: 100 });
    expect(lastInvitations.invitations).toHaveLength(20);
    expect(lastInvitations.pagination).toEqual({ page: 6, limit: 100, total: 520, totalPages: 6 });

    const filtered = await listAdminUsers(admin.session, { search: "bulk-", limit: 1 });
    expect(filtered.users).toHaveLength(1);
    expect(filtered.pagination.total).toBe(520);
    const overview = await adminOverview(admin.session);
    expect(overview.users).toHaveLength(25);
    expect(overview.tenants).toHaveLength(25);
    expect(overview.pagination.users).toEqual({ page: 1, limit: 25, total: 524, totalPages: 21 });
    expect(overview.pagination.tenants).toEqual({ page: 1, limit: 25, total: 522, totalPages: 21 });
    expect(overview.stats).toEqual({ users: 524, tenants: 522, activeTenants: 262, pendingInvitations: 520 });
  });

  it("searches metadata case-insensitively and treats percent, underscore, backslash and escape characters literally", async () => {
    const admin = await loginAs("admin@example.test", "admin");
    const literal = "Needle 100%_\\path!";
    await database().query("UPDATE users SET display_name = $1 WHERE id = $2", [literal, A]);
    await database().query("UPDATE users SET display_name = 'Needle 100XYpath' WHERE id = $1", [PEER]);
    await database().query("UPDATE tenants SET name = $1 WHERE id = $2", [literal, TA]);
    await database().query("UPDATE tenants SET name = 'Needle 100XYpath' WHERE id = $1", [TB]);
    const exact = await createInvitation(admin.session, {
      email: "literal@example.test", name: literal, kind: "company", role: "member", tenantId: TA,
    });
    await createInvitation(admin.session, {
      email: "near-match@example.test", name: "Needle 100XYpath", kind: "company", role: "member", tenantId: TB,
    });
    for (const search of ["100%_", "\\", "!"]) {
      const users = await listAdminUsers(admin.session, { search });
      expect(users.users.map((user) => user.id)).toEqual([A]);
      expect(users.pagination.total).toBe(1);
      expect((await listAdminTenants(admin.session, { search })).tenants.map((tenant) => tenant.id)).toEqual([TA]);
      expect((await listInvitations(admin.session, { search })).invitations.map((invitation) => invitation.id))
        .toEqual([exact.invitation.id]);
    }
    expect((await listAdminUsers(admin.session, { search: "A@EXAMPLE.TEST" })).users.map((user) => user.id)).toEqual([A]);
    expect((await listInvitations(admin.session, { search: "  LITERAL@EXAMPLE.TEST  " })).invitations).toHaveLength(1);
    const noMatch = await listAdminUsers(admin.session, { search: "' OR TRUE --" });
    expect(noMatch).toEqual({ users: [], pagination: { page: 1, limit: 25, total: 0, totalPages: 0 } });
    const beyond = await listAdminTenants(admin.session, { page: 5, limit: 1 });
    expect(beyond).toEqual({ tenants: [], pagination: { page: 5, limit: 1, total: 2, totalPages: 2 } });
  });

  it("enforces bounded HTTP query parameters and checks administration access before parsing them", async () => {
    const admin = await loginAs("admin@example.test", "admin");
    state.cookies.set(sessionCookieName(), admin.token);
    for (const query of ["page=0", "page=1.5", "page=1000001", "limit=0", "limit=101",
      "limit=1&limit=2", "unknown=1", `search=${"x".repeat(121)}`]) {
      const response = await adminUsersRoute(new Request(`https://app.example.test/api/admin/users?${query}`));
      expect(response.status, query).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
    }
    const response = await adminUsersRoute(new Request("https://app.example.test/api/admin/users?page=2&limit=2"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ pagination: { page: 2, limit: 2, total: 4, totalPages: 2 } });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const tenantResponse = await adminTenantsRoute(new Request("https://app.example.test/api/admin/tenants?search=Tenant%20B&limit=1"));
    expect(await tenantResponse.json()).toMatchObject({ tenants: [{ id: TB }], pagination: { total: 1 } });
    const inviteResponse = await adminInvitationsRoute(new Request("https://app.example.test/api/admin/invitations?page=2&limit=1"));
    expect(await inviteResponse.json()).toEqual({ invitations: [], pagination: { page: 2, limit: 1, total: 0, totalPages: 0 } });

    const user = await loginAs();
    state.cookies.set(sessionCookieName(), user.token);
    for (const route of [adminUsersRoute, adminTenantsRoute, adminInvitationsRoute]) {
      expect((await route(new Request("https://app.example.test/api/admin/users?limit=999"))).status).toBe(403);
    }
    await expect(listAdminUsers(user.session)).rejects.toMatchObject({ status: 403 });
    await expect(listAdminTenants(user.session)).rejects.toMatchObject({ status: 403 });
  });
});

describe("request protections and durable throttling", () => {
  it("fails production authentication closed unless one valid source IP comes from the configured proxy", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRUST_PROXY_HEADERS", "false");
    const request = (value?: string, forwardedFor?: string, realIp?: string) => new Request("https://app.example.test", {
      headers: { ...(value ? { "X-Aoos-Client-IP": value } : {}),
        ...(forwardedFor ? { "X-Forwarded-For": forwardedFor } : {}), ...(realIp ? { "X-Real-IP": realIp } : {}) },
    });
    expect(() => requestSourceKey(request("203.0.113.10"))).toThrow(expect.objectContaining({ status: 503, code: "PROXY_CONFIGURATION_REQUIRED" }));
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");
    for (const value of [undefined, "not-an-ip", "203.0.113.10, 203.0.113.11", "203.0.113.10:443", "[2001:db8::1]", "fe80::1%eth0"]) {
      expect(() => requestSourceKey(request(value))).toThrow(expect.objectContaining({ status: 503, code: "PROXY_CONFIGURATION_REQUIRED" }));
    }
    // Next.js may supply an ordinary XFF even when no ingress was traversed.
    // That synthesized header must not satisfy the dedicated-header check.
    expect(() => requestSourceKey(request(undefined, "127.0.0.1", "203.0.113.10")))
      .toThrow(expect.objectContaining({ status: 503, code: "PROXY_CONFIGURATION_REQUIRED" }));
    expect(requestSourceKey(request("203.0.113.10", "198.51.100.99, 192.0.2.1", "192.0.2.2")))
      .toBe(requestSourceKey(request("203.0.113.10")));
    expect(requestSourceKey(request("203.0.113.10"))).not.toBe(requestSourceKey(request("203.0.113.11")));
    expect(requestSourceKey(request("2001:db8::1"))).toBe(requestSourceKey(request("2001:0db8:0:0:0:0:0:1")));
  });

  it("uses the conservative development fallback without trusting arbitrary forwarded headers", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("TRUST_PROXY_HEADERS", "false");
    const plain = requestSourceKey(new Request("http://localhost:3000"));
    expect(requestSourceKey(new Request("http://localhost:3000", { headers: { "X-Aoos-Client-IP": "203.0.113.1" } }))).toBe(plain);
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");
    expect(requestSourceKey(new Request("http://localhost:3000", { headers: { "X-Aoos-Client-IP": "203.0.113.1, 203.0.113.2" } }))).toBe(plain);
    expect(requestSourceKey(new Request("http://localhost:3000", { headers: { "X-Forwarded-For": "203.0.113.1" } }))).toBe(plain);
  });

  it("requires an exact trusted Origin independently of spoofable Host headers", () => {
    for (const origin of [undefined, "null", "https://app.example.test.evil.test", "https://evil.test"]) {
      const headers: Record<string, string> = { Host: "app.example.test", "X-Forwarded-Host": "app.example.test" };
      if (origin) headers.Origin = origin;
      expect(() => assertSameOrigin(new Request("https://app.example.test/api/auth/login", { method: "POST", headers }))).toThrow(AppError);
    }
    expect(() => assertSameOrigin(new Request("https://app.example.test/api/auth/login", { method: "POST", headers: { Origin: "https://app.example.test" } }))).not.toThrow();
  });

  it("rejects unknown privilege fields, oversized streaming bodies and non-JSON requests", async () => {
    const schema = z.object({ name: z.string() }).strict();
    const request = (body: string, type = "application/json") => new Request("https://app.example.test", { method: "POST", headers: { "Content-Type": type }, body });
    await expect(readJson(request('{"name":"A","platformRole":"super_admin"}'), schema)).rejects.toMatchObject({ status: 400 });
    await expect(readJson(request(JSON.stringify({ name: "A".repeat(200) })), schema, 64)).rejects.toMatchObject({ status: 413 });
    await expect(readJson(request('{"name":"A"}', "text/plain"), schema)).rejects.toMatchObject({ status: 415 });
  });

  it("commits rejected rate-limit attempts and resumes only after the window expires", async () => {
    await consumeRateLimit("test:login", 2, 60);
    await consumeRateLimit("test:login", 2, 60);
    await expect(consumeRateLimit("test:login", 2, 60)).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect((await database().query<{ hits: number }>("SELECT hits FROM rate_limits WHERE key = 'test:login'")).rows[0].hits).toBe(3);
    await expect(consumeRateLimit("test:login", 2, 60)).rejects.toMatchObject({ status: 429 });
    await database().query("UPDATE rate_limits SET window_started_at = now() - interval '61 seconds'");
    await expect(consumeRateLimit("test:login", 2, 60)).resolves.toBeUndefined();
  });

  it("returns validation errors as 400 and redacts unexpected errors", async () => {
    const invalid = z.string().uuid().safeParse("invalid");
    if (invalid.success) throw new Error("Expected validation error");
    const response = jsonError(invalid.error);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const hidden = jsonError(new Error("postgresql://sensitive-credential@example.test/database"));
    expect(JSON.stringify(await hidden.json())).not.toContain("sensitive");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("sensitive");
    spy.mockRestore();
  });
});
