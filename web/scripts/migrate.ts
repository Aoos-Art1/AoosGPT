import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

class SetupError extends Error {}

async function main() {
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  const runtimeUrl = process.env.DATABASE_URL;
  if (!migrationUrl || !runtimeUrl) throw new SetupError("Set MIGRATION_DATABASE_URL and DATABASE_URL before running migrations.");
  let migration: URL;
  let runtime: URL;
  try { migration = new URL(migrationUrl); runtime = new URL(runtimeUrl); }
  catch { throw new SetupError("Database URLs are not valid."); }
  if (decodeURIComponent(runtime.username) !== "aoos_runtime" || !runtime.password) {
    throw new SetupError("DATABASE_URL must use aoos_runtime and a unique, nonempty password.");
  }
  if (decodeURIComponent(migration.username) === "aoos_runtime") throw new SetupError("Migration credentials must be separate from the runtime role.");
  if (migration.hostname !== runtime.hostname || (migration.port || "5432") !== (runtime.port || "5432")
    || migration.pathname !== runtime.pathname) throw new SetupError("Both URLs must target the same PostgreSQL host, port and database.");

  const client = new Client({ connectionString: migrationUrl, application_name: "aoosgpt-migrate" });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(731272541)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const directory = path.resolve("db/migrations");
    const files = (await readdir(directory)).filter((file) => /^\d+_[a-z0-9_-]+\.sql$/.test(file)).sort();
    for (const file of files) {
      const sql = await readFile(path.join(directory, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const applied = await client.query<{ checksum: string }>("SELECT checksum FROM schema_migrations WHERE version = $1", [file]);
      if (applied.rows[0]) {
        if (applied.rows[0].checksum !== checksum) throw new SetupError(`Applied migration changed: ${file}. Restore it and add a new migration.`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [file, checksum]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      console.log(`Applied ${file}`);
    }
    const role = (await client.query<{
      rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolreplication: boolean; unsafe_membership: boolean;
    }>(`SELECT r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication,
      EXISTS (SELECT 1 FROM pg_roles other_role WHERE other_role.oid <> r.oid
        AND pg_has_role(r.oid, other_role.oid, 'MEMBER')) AS unsafe_membership
      FROM pg_roles r WHERE r.rolname = 'aoos_runtime'`)).rows[0];
    if (!role || role.rolsuper || role.rolbypassrls || role.rolcreaterole || role.rolcreatedb
      || role.rolreplication || role.unsafe_membership) throw new SetupError("Existing aoos_runtime role has unsafe privileges. Correct it before starting the application.");
    // PostgreSQL role identifiers cannot be query parameters. The identifier is
    // a fixed constant; use pg's literal escaper, never shell interpolation.
    const password = decodeURIComponent(runtime.password);
    if (password.length < 24 || password.includes("\0")) {
      throw new SetupError("Use a unique runtime database password of at least 24 characters without NUL bytes.");
    }
    await client.query("SET password_encryption = 'scram-sha-256'");
    await client.query(`ALTER ROLE aoos_runtime LOGIN PASSWORD ${client.escapeLiteral(password)}`);
    console.log("Database migrations complete; restricted runtime login configured.");
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(731272541)"); } finally { await client.end(); }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof SetupError ? error.message : "Migration failed. Check database availability and migration-role privileges; no credentials were printed.");
  process.exitCode = 1;
});
