import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

describe("durable message sequence migration", () => {
  it("backfills equal timestamps as a restricted owner and lets runtime allocate without reseeding", async () => {
    const database = new PGlite();
    try {
      const migrations = await Promise.all(["001_initial.sql", "002_memory_context_boundary.sql", "003_message_sequence.sql"].map((name) => readFile(new URL(`../db/migrations/${name}`, import.meta.url), "utf8")));
      await database.exec(migrations[0]);
      const tenant = "11111111-1111-4111-8111-111111111111";
      const user = "22222222-2222-4222-8222-222222222222";
      const conversation = "33333333-3333-4333-8333-333333333333";
      await database.query("INSERT INTO users (id,email,display_name,password_hash) VALUES ($1,'sequence@example.com','مستخدم','not-a-real-password-hash')", [user]);
      await database.query("INSERT INTO tenants (id,name,kind) VALUES ($1,'جهة اختبار','company')", [tenant]);
      await database.query("INSERT INTO memberships (tenant_id,user_id,role) VALUES ($1,$2,'owner')", [tenant, user]);
      await database.query("INSERT INTO conversations (id,tenant_id,user_id,title) VALUES ($1,$2,$3,'سجل قديم')", [conversation, tenant, user]);
      await database.query(`INSERT INTO messages (id,tenant_id,user_id,conversation_id,role,content,created_at) VALUES
        ('ffffffff-ffff-4fff-8fff-ffffffffffff',$1,$2,$3,'user','طلب قديم','2026-01-01T00:00:00Z'),
        ('00000000-0000-4000-8000-000000000001',$1,$2,$3,'assistant','جواب قديم','2026-01-01T00:00:00Z')`, [tenant, user, conversation]);
      await database.exec(`
        CREATE ROLE sequence_migration_owner NOSUPERUSER NOBYPASSRLS NOLOGIN;
        GRANT USAGE, CREATE ON SCHEMA public TO sequence_migration_owner;
        DO $$ DECLARE item record; BEGIN
          FOR item IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
            EXECUTE format('ALTER TABLE public.%I OWNER TO sequence_migration_owner',item.tablename);
          END LOOP;
        END $$;
        SET ROLE sequence_migration_owner;
      `);
      for (const migration of migrations.slice(1)) {
        await database.transaction(async (transaction) => { await transaction.exec(migration); });
      }
      await database.exec("RESET ROLE");
      const legacy = await database.query<{ role: string; sequence_no: string }>("SELECT role,sequence_no::text AS sequence_no FROM messages ORDER BY sequence_no");
      expect(legacy.rows).toEqual([{ role: "user", sequence_no: "1" }, { role: "assistant", sequence_no: "2" }]);
      const protection = await database.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.messages'::regclass");
      expect(protection.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      const identity = await database.query<{ attidentity: string; attnotnull: boolean }>("SELECT attidentity,attnotnull FROM pg_attribute WHERE attrelid='public.messages'::regclass AND attname='sequence_no'");
      expect(identity.rows[0]).toEqual({ attidentity: "a", attnotnull: true });
      const sequence = await database.query<{ name: string }>("SELECT pg_get_serial_sequence('public.messages','sequence_no') AS name");

      await database.exec("SET ROLE aoos_runtime");
      const inserted = await database.transaction(async (transaction) => {
        await transaction.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.tenant_role','owner',true)", [tenant, user]);
        const first = await transaction.query<{ sequence_no: string }>("INSERT INTO messages (tenant_id,user_id,conversation_id,role,content,created_at) VALUES ($1,$2,$3,'user','طلب جديد','2026-01-01T00:00:00Z') RETURNING sequence_no::text AS sequence_no", [tenant, user, conversation]);
        const second = await transaction.query<{ sequence_no: string }>("INSERT INTO messages (tenant_id,user_id,conversation_id,role,content,created_at) VALUES ($1,$2,$3,'assistant','جواب جديد','2026-01-01T00:00:00Z') RETURNING sequence_no::text AS sequence_no", [tenant, user, conversation]);
        return [first.rows[0].sequence_no, second.rows[0].sequence_no];
      });
      expect(inserted).toEqual(["3", "4"]);
      await expect(database.query("SELECT setval($1::regclass,1,false)", [sequence.rows[0].name])).rejects.toMatchObject({ code: "42501" });
      await expect(database.query("INSERT INTO messages (sequence_no,tenant_id,user_id,conversation_id,role,content) VALUES (999,$1,$2,$3,'user','forged order')", [tenant, user, conversation])).rejects.toMatchObject({ code: "428C9" });

      // These attacks run with valid ownership context. Permission denial must
      // come from the protected column, rather than from missing RLS settings.
      await expect(database.transaction(async (transaction) => {
        await transaction.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.tenant_role','owner',true)", [tenant, user]);
        return transaction.query("INSERT INTO messages (sequence_no,tenant_id,user_id,conversation_id,role,content) OVERRIDING SYSTEM VALUE VALUES (999,$1,$2,$3,'user','forged order')", [tenant, user, conversation]);
      })).rejects.toMatchObject({ code: "42501" });
      await expect(database.transaction(async (transaction) => {
        await transaction.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.tenant_role','owner',true)", [tenant, user]);
        return transaction.query("UPDATE messages SET sequence_no=DEFAULT WHERE sequence_no=3 RETURNING sequence_no");
      })).rejects.toMatchObject({ code: "42501" });

      const ordinaryCrud = await database.transaction(async (transaction) => {
        await transaction.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.tenant_role','owner',true)", [tenant, user]);
        const updated = await transaction.query<{ content: string; sequence_no: string }>("UPDATE messages SET content='نص معدّل' WHERE sequence_no=3 RETURNING content,sequence_no::text AS sequence_no");
        const read = await transaction.query<{ content: string; sequence_no: string }>("SELECT content,sequence_no::text AS sequence_no FROM messages WHERE sequence_no=3");
        const removed = await transaction.query<{ sequence_no: string }>("DELETE FROM messages WHERE sequence_no=4 RETURNING sequence_no::text AS sequence_no");
        return { updated: updated.rows, read: read.rows, removed: removed.rows };
      });
      expect(ordinaryCrud).toEqual({
        updated: [{ content: "نص معدّل", sequence_no: "3" }],
        read: [{ content: "نص معدّل", sequence_no: "3" }],
        removed: [{ sequence_no: "4" }],
      });
      await database.exec("RESET ROLE");
    } finally {
      await database.close();
    }
  });

  it("starts at one on an empty installation", async () => {
    const database = new PGlite();
    try {
      await database.exec(`
        CREATE ROLE aoos_runtime NOLOGIN;
        CREATE TABLE messages (
          id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
          tenant_id uuid, user_id uuid, conversation_id uuid,
          role text, content text, citations jsonb DEFAULT '[]'::jsonb,
          memory_context_revision bigint DEFAULT 0, created_at timestamptz DEFAULT now()
        );
      `);
      await database.transaction(async (transaction) => {
        await transaction.exec(await readFile(new URL("../db/migrations/003_message_sequence.sql", import.meta.url), "utf8"));
      });
      const result = await database.query<{ sequence_no: string }>("INSERT INTO messages (role) VALUES ('user') RETURNING sequence_no::text AS sequence_no");
      expect(result.rows[0].sequence_no).toBe("1");
    } finally {
      await database.close();
    }
  });
});
