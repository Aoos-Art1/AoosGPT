import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

describe("memory boundary upgrade under a restricted migration owner", () => {
  it("invalidates legacy model history and restores FORCE RLS without requiring BYPASSRLS", async () => {
    const database = new PGlite();
    try {
      const first = await readFile(new URL("../db/migrations/001_initial.sql", import.meta.url), "utf8");
      const second = await readFile(new URL("../db/migrations/002_memory_context_boundary.sql", import.meta.url), "utf8");
      await database.exec(first);
      const user = "11111111-1111-4111-8111-111111111111";
      const tenant = "22222222-2222-4222-8222-222222222222";
      const conversation = "33333333-3333-4333-8333-333333333333";
      await database.query("INSERT INTO users (id,email,display_name,password_hash) VALUES ($1,'migration-test@example.com','مستخدم','not-a-real-password-hash')", [user]);
      await database.query("INSERT INTO tenants (id,name,kind) VALUES ($1,'جهة اختبار','company')", [tenant]);
      await database.query("INSERT INTO memberships (tenant_id,user_id,role) VALUES ($1,$2,'owner')", [tenant, user]);
      await database.query("INSERT INTO conversations (id,tenant_id,user_id,title) VALUES ($1,$2,$3,'سجل قديم')", [conversation, tenant, user]);
      await database.query("INSERT INTO messages (tenant_id,user_id,conversation_id,role,content) VALUES ($1,$2,$3,'assistant','رد قديم يكرر ذاكرة محذوفة')", [tenant, user, conversation]);
      // Deliberately no preference row: the migration must backfill from the
      // conversation table as well as update any already-existing preferences.
      await database.exec(`
        CREATE ROLE audit_migration_owner NOSUPERUSER NOBYPASSRLS NOLOGIN;
        GRANT USAGE, CREATE ON SCHEMA public TO audit_migration_owner;
        DO $$ DECLARE item record; BEGIN
          FOR item IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
            EXECUTE format('ALTER TABLE public.%I OWNER TO audit_migration_owner', item.tablename);
          END LOOP;
        END $$;
        SET ROLE audit_migration_owner;
      `);
      await database.transaction(async (transaction) => { await transaction.exec(second); });
      await database.exec("RESET ROLE");
      const preferences = await database.query<{ memory_revision: string }>("SELECT memory_revision::text AS memory_revision FROM preferences WHERE tenant_id=$1 AND user_id=$2", [tenant, user]);
      expect(preferences.rows[0]?.memory_revision).toBe("1");
      const replayable = await database.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM messages m JOIN preferences p ON p.tenant_id=m.tenant_id AND p.user_id=m.user_id WHERE m.memory_context_revision=p.memory_revision",
      );
      expect(replayable.rows[0].count).toBe(0);
      const protection = await database.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('preferences','conversations') AND relnamespace='public'::regnamespace",
      );
      expect(protection.rows).toHaveLength(2);
      expect(protection.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
      const displayed = await database.query<{ count: number }>("SELECT count(*)::int AS count FROM messages");
      expect(displayed.rows[0].count).toBe(1);
    } finally {
      await database.close();
    }
  });
});
