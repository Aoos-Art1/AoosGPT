import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";
import type { TenantSession } from "@/lib/contracts";

const scopedDatabase = vi.hoisted(() => ({ withTenant: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ withTenant: scopedDatabase.withTenant }));

import { loadChatContext, loadConversationMessages, saveChatResult } from "@/lib/server/ai/store";

let database: PGlite;
const tenantA = "11111111-1111-4111-8111-111111111111";
const tenantB = "22222222-2222-4222-8222-222222222222";
const userA = "33333333-3333-4333-8333-333333333333";
const userB = "44444444-4444-4444-8444-444444444444";
const documentA = "55555555-5555-4555-8555-555555555555";
const documentB = "66666666-6666-4666-8666-666666666666";

const session: TenantSession = {
  sessionId: "77777777-7777-4777-8777-777777777777", userId: userA, tenantId: tenantA,
  tenantName: "شركة ألف", tenantKind: "company", tenantRole: "member", email: "test@example.com", displayName: "مستخدم", platformRole: "user", portal: "company",
};

beforeAll(async () => {
  database = new PGlite();
  await database.exec(`
    CREATE ROLE aoos_runtime NOLOGIN;
    CREATE TABLE documents (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, title text NOT NULL, content text NOT NULL, source_url text, UNIQUE(tenant_id,id));
    CREATE TABLE document_chunks (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, tenant_id uuid NOT NULL, document_id uuid NOT NULL, content text NOT NULL, chunk_index integer,
      FOREIGN KEY (tenant_id,document_id) REFERENCES documents(tenant_id,id) ON DELETE CASCADE);
    CREATE TABLE memberships (tenant_id uuid NOT NULL, user_id uuid NOT NULL, PRIMARY KEY (tenant_id,user_id));
    CREATE TABLE preferences (tenant_id uuid, user_id uuid, memory_enabled boolean DEFAULT false, PRIMARY KEY(tenant_id,user_id));
    CREATE TABLE memories (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, tenant_id uuid, user_id uuid, content text, created_at timestamptz DEFAULT now());
    CREATE TABLE conversations (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, tenant_id uuid, user_id uuid, title text, updated_at timestamptz DEFAULT now());
    CREATE TABLE messages (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, tenant_id uuid, user_id uuid, conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE, role text, content text, citations jsonb DEFAULT '[]'::jsonb, created_at timestamptz DEFAULT now());
  `);
  await database.exec(await readFile(new URL("../db/migrations/002_memory_context_boundary.sql", import.meta.url), "utf8"));
  await database.exec(await readFile(new URL("../db/migrations/003_message_sequence.sql", import.meta.url), "utf8"));
  // This suite exercises real SQL and explicit application scoping even without
  // RLS. Authentication and the complete migration's RLS have their own suite.
  scopedDatabase.withTenant.mockImplementation(async (_session: TenantSession, operation: (client: PoolClient) => Promise<unknown>) => {
    return database.transaction(async (transaction) => operation({
      query: async (sql: string, parameters?: unknown[]) => {
        const result = await transaction.query(sql, parameters);
        return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
      },
    } as unknown as PoolClient));
  });
});

beforeEach(async () => {
  await database.exec("TRUNCATE messages, conversations, document_chunks, documents, memories, preferences, memberships CASCADE");
  await database.query("INSERT INTO memberships (tenant_id,user_id) VALUES ($1,$2),($1,$3),($4,$2)", [tenantA, userA, userB, tenantB]);
  await database.query("INSERT INTO documents (id,tenant_id,title,content,source_url) VALUES ($1,$2,'مرجع ألف','إجراء الشركة ألف: مرجع داخلي.','https://example.com/a'),($3,$4,'مرجع باء','إجراء الشركة باء: سر جهة أخرى.','https://example.com/b')", [documentA, tenantA, documentB, tenantB]);
  await database.query("INSERT INTO document_chunks (tenant_id,document_id,content,chunk_index) SELECT tenant_id,id,content,0 FROM documents");
  await database.query("INSERT INTO preferences (tenant_id,user_id,memory_enabled) VALUES ($1,$2,true),($1,$3,true),($4,$2,true)", [tenantA, userA, userB, tenantB]);
  await database.query("INSERT INTO memories (tenant_id,user_id,content) VALUES ($1,$2,'تفضيل المستخدم الحالي'),($1,$3,'سر مستخدم آخر'),($4,$2,'سر جهة أخرى')", [tenantA, userA, userB, tenantB]);
});

afterAll(async () => { await database?.close(); });

describe("real SQL retrieval and persistence", () => {
  it("returns only tenant-authorized chunks and the current user's tenant-specific memories", async () => {
    const context = await loadChatContext(session, "ما إجراء الشركة؟");
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].title).toBe("مرجع ألف");
    expect(context.sources[0].url).toBe("https://example.com/a");
    expect(context.memories).toEqual(["تفضيل المستخدم الحالي"]);
    expect(JSON.stringify(context)).not.toContain("سر");
  });

  it("stops retrieving a deleted document and ignores saved memory when disabled", async () => {
    await database.query("DELETE FROM documents WHERE id = $1", [documentA]);
    await database.query("UPDATE preferences SET memory_enabled = false WHERE tenant_id = $1 AND user_id = $2", [tenantA, userA]);
    const context = await loadChatContext(session, "إجراء الشركة");
    expect(context.sources).toEqual([]);
    expect(context.memories).toEqual([]);
  });

  it("persists ordered user/assistant turns atomically and retrieves them only for their owner", async () => {
    const context = await loadChatContext(session, "إجراء الشركة");
    const saved = await saveChatResult(session, context, "إجراء الشركة", "الإجابة من المرجع [S1]");
    expect(saved.message.citations).toHaveLength(1);
    expect(saved.message.citations[0].reference).toBe("S1");
    const restored = await loadChatContext(session, "متابعة", saved.conversationId);
    expect(restored.history).toEqual([{ role: "user", content: "إجراء الشركة" }, { role: "assistant", content: "الإجابة من المرجع [S1]" }]);
    await expect(loadChatContext({ ...session, userId: userB }, "متابعة", saved.conversationId)).rejects.toMatchObject({ status: 404 });
    await expect(loadChatContext({ ...session, tenantId: tenantB }, "متابعة", saved.conversationId)).rejects.toMatchObject({ status: 404 });
  });

  it("rejects a concurrent stale conversation response without persisting half a turn", async () => {
    const initial = await loadChatContext(session, "مرحبا");
    const saved = await saveChatResult(session, initial, "مرحبا", "أهلًا");
    const first = await loadChatContext(session, "الأول", saved.conversationId);
    const second = await loadChatContext(session, "الثاني", saved.conversationId);
    await saveChatResult(session, first, "الأول", "جواب الأول");
    await expect(saveChatResult(session, second, "الثاني", "جواب الثاني")).rejects.toMatchObject({ code: "CONVERSATION_CHANGED" });
    const messages = await database.query<{ count: number }>("SELECT count(*)::int AS count FROM messages WHERE conversation_id = $1", [saved.conversationId]);
    expect(messages.rows[0].count).toBe(4);
  });

  it("does not reintroduce deleted memory through a pending generated answer", async () => {
    const context = await loadChatContext(session, "مرحبا");
    await database.query("DELETE FROM memories WHERE tenant_id = $1 AND user_id = $2", [tenantA, userA]);
    await expect(saveChatResult(session, context, "مرحبا", "تفضيل المستخدم الحالي")).rejects.toMatchObject({ code: "MEMORY_CHANGED" });
    const messages = await database.query<{ count: number }>("SELECT count(*)::int AS count FROM messages");
    expect(messages.rows[0].count).toBe(0);
  });

  it("excludes memory echoed in a previous answer after deletion while keeping display history", async () => {
    const initial = await loadChatContext(session, "تذكر تفضيلي");
    const saved = await saveChatResult(session, initial, "تذكر تفضيلي", "تفضيل المستخدم الحالي");
    const beforeDeletion = await loadChatContext(session, "متابعة", saved.conversationId);
    expect(beforeDeletion.history.some((entry) => entry.content === "تفضيل المستخدم الحالي")).toBe(true);

    await database.query("DELETE FROM memories WHERE tenant_id = $1 AND user_id = $2", [tenantA, userA]);
    const afterDeletion = await loadChatContext(session, "متابعة", saved.conversationId);
    expect(afterDeletion.history).toEqual([]);
    expect(afterDeletion.memories).toEqual([]);
    expect(afterDeletion.memoryRevision).not.toBe(beforeDeletion.memoryRevision);

    const displayed = await loadConversationMessages(session, saved.conversationId);
    expect(displayed.map((row) => row.content)).toEqual(["تذكر تفضيلي", "تفضيل المستخدم الحالي"]);
    await saveChatResult(session, afterDeletion, "متابعة", "سياق جديد");
    const next = await loadChatContext(session, "ثم ماذا؟", saved.conversationId);
    expect(next.history.map((entry) => entry.content)).toEqual(["متابعة", "سياق جديد"]);
  });

  it("starts fresh context on disable and does not revive old history when re-enabled", async () => {
    const initial = await loadChatContext(session, "تذكر تفضيلي");
    const saved = await saveChatResult(session, initial, "تذكر تفضيلي", "تفضيل المستخدم الحالي");
    await database.query("UPDATE preferences SET memory_enabled = false WHERE tenant_id = $1 AND user_id = $2", [tenantA, userA]);
    const disabled = await loadChatContext(session, "متابعة", saved.conversationId);
    expect(disabled.history).toEqual([]);
    expect(disabled.memories).toEqual([]);

    await database.query("UPDATE preferences SET memory_enabled = true WHERE tenant_id = $1 AND user_id = $2", [tenantA, userA]);
    const enabledAgain = await loadChatContext(session, "متابعة", saved.conversationId);
    expect(enabledAgain.history).toEqual([]);
    expect(enabledAgain.memoryRevision).not.toBe(disabled.memoryRevision);
  });

  it("rejects a pending history-only answer after a boundary change", async () => {
    await database.query("DELETE FROM memories WHERE tenant_id = $1 AND user_id = $2", [tenantA, userA]);
    const initial = await loadChatContext(session, "معلومة في المحادثة");
    const saved = await saveChatResult(session, initial, "معلومة في المحادثة", "معلومة أعادها رد سابق");
    const pending = await loadChatContext(session, "متابعة", saved.conversationId);
    expect(pending.memorySnapshot).toEqual([]);
    expect(pending.history).toHaveLength(2);
    await database.query("UPDATE preferences SET memory_enabled = false WHERE tenant_id = $1 AND user_id = $2", [tenantA, userA]);
    await expect(saveChatResult(session, pending, "متابعة", "إجابة بالسياق السابق")).rejects.toMatchObject({ code: "MEMORY_CHANGED" });
    const messages = await database.query<{ count: number }>("SELECT count(*)::int AS count FROM messages WHERE conversation_id = $1", [saved.conversationId]);
    expect(messages.rows[0].count).toBe(2);
  });

  it("advances the boundary atomically on create/edit/delete, without changing unrelated users", async () => {
    const before = await loadChatContext(session, "مرحبا");
    const otherBefore = await loadChatContext({ ...session, userId: userB }, "مرحبا");
    const created = await database.query<{ id: string }>("INSERT INTO memories (tenant_id,user_id,content) VALUES ($1,$2,'جديدة') RETURNING id", [tenantA, userA]);
    const afterCreate = await loadChatContext(session, "مرحبا");
    expect(BigInt(afterCreate.memoryRevision)).toBe(BigInt(before.memoryRevision) + 1n);
    await database.query("UPDATE memories SET content = 'معدّلة' WHERE id = $1", [created.rows[0].id]);
    const afterEdit = await loadChatContext(session, "مرحبا");
    expect(BigInt(afterEdit.memoryRevision)).toBe(BigInt(afterCreate.memoryRevision) + 1n);
    await database.query("DELETE FROM memories WHERE id = $1", [created.rows[0].id]);
    const afterDelete = await loadChatContext(session, "مرحبا");
    expect(BigInt(afterDelete.memoryRevision)).toBe(BigInt(afterEdit.memoryRevision) + 1n);
    expect((await loadChatContext({ ...session, userId: userB }, "مرحبا")).memoryRevision).toBe(otherBefore.memoryRevision);
  });

  it("preserves exact turn order in model and displayed history when every timestamp is identical", async () => {
    const initial = await loadChatContext(session, "طلب أول");
    const first = await saveChatResult(session, initial, "طلب أول", "جواب أول");
    const followUp = await loadChatContext(session, "طلب ثان", first.conversationId);
    await saveChatResult(session, followUp, "طلب ثان", "جواب ثان");
    await database.query("UPDATE messages SET created_at='2026-01-01T00:00:00Z' WHERE conversation_id=$1", [first.conversationId]);
    // Deliberately put the first user's UUID after its assistant UUID. The old
    // created_at/id ordering deterministically reverses this pair.
    await database.query("UPDATE messages SET id='ffffffff-ffff-4fff-8fff-ffffffffffff' WHERE conversation_id=$1 AND content='طلب أول'", [first.conversationId]);
    await database.query("UPDATE messages SET id='00000000-0000-4000-8000-000000000001' WHERE conversation_id=$1 AND content='جواب أول'", [first.conversationId]);
    const expected = ["طلب أول", "جواب أول", "طلب ثان", "جواب ثان"];
    const model = await loadChatContext(session, "متابعة", first.conversationId);
    expect(model.history.map((entry) => entry.content)).toEqual(expected);
    const displayed = await loadConversationMessages(session, first.conversationId);
    expect(displayed.map((entry) => entry.content)).toEqual(expected);
    expect(new Set(displayed.map((entry) => entry.createdAt)).size).toBe(1);
    await expect(loadConversationMessages({ ...session, userId: userB }, first.conversationId)).rejects.toMatchObject({ status: 404 });
  });
});
