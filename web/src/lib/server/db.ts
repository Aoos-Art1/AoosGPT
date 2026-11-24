import "server-only";
import { Pool, type PoolClient } from "pg";
import type { TenantSession } from "@/lib/contracts";
import { AppError } from "./http";

const globalDatabase = globalThis as unknown as { aoosPool?: Pool };

export function getPool(): Pool {
  if (globalDatabase.aoosPool) return globalDatabase.aoosPool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new AppError(503, "DATABASE_NOT_CONFIGURED", "قاعدة البيانات لم تُهيّأ بعد.");
  let url: URL;
  try { url = new URL(connectionString); }
  catch { throw new AppError(503, "DATABASE_NOT_CONFIGURED", "إعداد قاعدة البيانات غير صحيح."); }
  // Accidental use of the migration/owner connection would defeat RLS.
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || decodeURIComponent(url.username) !== "aoos_runtime") {
    throw new AppError(503, "UNSAFE_DATABASE_ROLE", "يجب تشغيل التطبيق بحساب قاعدة البيانات محدود الصلاحيات.");
  }
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "aoosgpt-runtime",
  });
  // Idle connection failures emit both an Error and a Client. Neither is safe
  // to log: they can contain connection strings, credentials or socket state.
  pool.on("error", () => console.error("DATABASE_POOL_IDLE_ERROR"));
  globalDatabase.aoosPool = pool;
  return pool;
}

export async function assertRuntimeRole(client: PoolClient): Promise<void> {
  const result = await client.query<{
    role_name: string; rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean;
    rolcreatedb: boolean; rolreplication: boolean; owns_tables: boolean; owns_database: boolean; has_role_memberships: boolean;
  }>(`SELECT current_user AS role_name, r.rolsuper, r.rolbypassrls, r.rolcreaterole,
       r.rolcreatedb, r.rolreplication,
       EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public'
         AND tableowner = current_user) AS owns_tables,
       EXISTS (SELECT 1 FROM pg_database WHERE datname = current_database() AND datdba = r.oid) AS owns_database,
       EXISTS (SELECT 1 FROM pg_roles other_role WHERE other_role.oid <> r.oid
         AND pg_has_role(r.oid, other_role.oid, 'MEMBER')) AS has_role_memberships
     FROM pg_roles r WHERE r.rolname = current_user`);
  const role = result.rows[0];
  if (!role || role.role_name !== "aoos_runtime" || role.rolsuper || role.rolbypassrls || role.rolcreaterole
    || role.rolcreatedb || role.rolreplication || role.owns_tables || role.owns_database || role.has_role_memberships) {
    throw new AppError(503, "UNSAFE_DATABASE_ROLE", "إعداد صلاحيات قاعدة البيانات غير آمن.");
  }
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  let broken = false;
  try {
    await assertRuntimeRole(client);
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); }
    catch { broken = true; }
    throw error;
  } finally {
    client.release(broken);
  }
}

export async function withTenant<T>(ctx: TenantSession, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withTransaction(async (client) => {
    // Recheck inside the same transaction to reject revoked sessions, changed
    // memberships and suspended tenants even if a caller cached its context.
    const result = await client.query<{ role: TenantSession["tenantRole"] }>(`
      SELECT m.role FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN tenants t ON t.id = s.tenant_id
      JOIN memberships m ON m.tenant_id = s.tenant_id AND m.user_id = s.user_id
      WHERE s.id = $1 AND s.user_id = $2 AND s.tenant_id = $3
        AND s.portal IN ('individual','company') AND s.portal = t.kind
        AND s.revoked_at IS NULL AND s.expires_at > now()
        AND s.last_seen_at > now() - interval '24 hours'
        AND u.disabled_at IS NULL AND m.active AND t.status = 'active'`,
    [ctx.sessionId, ctx.userId, ctx.tenantId]);
    if (!result.rows[0]) throw new AppError(401, "SESSION_INVALID", "انتهت الجلسة أو تغيّرت صلاحياتك. سجّل الدخول مجددًا.");
    await client.query(`SELECT set_config('app.user_id', $1, true),
      set_config('app.tenant_id', $2, true), set_config('app.tenant_role', $3, true)`,
    [ctx.userId, ctx.tenantId, result.rows[0].role]);
    return fn(client);
  });
}
