import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantSession } from "@/lib/contracts";

const database = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ withTenant: (_session: unknown, operation: (client: { query: typeof database.query }) => Promise<unknown>) => operation({ query: database.query }) }));
vi.mock("@/lib/server/capacity", () => ({ assertRecordCapacity: vi.fn().mockResolvedValue(undefined) }));

import { loadChatContext, saveChatResult, type ChatContext } from "@/lib/server/ai/store";

const session: TenantSession = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  tenantId: "33333333-3333-4333-8333-333333333333",
  tenantName: "شركة اختبار", tenantKind: "company", tenantRole: "member", email: "test@example.com", displayName: "مستخدم", platformRole: "user", portal: "company",
};

const memory = { id: "55555555-5555-4555-8555-555555555555", content: "معلومة شخصية أريد حذفها" };
const context: ChatContext = {
  conversationId: "44444444-4444-4444-8444-444444444444", conversationVersion: null, memoryRevision: "0", history: [], memories: [memory.content], memorySnapshot: [memory], sources: [],
};

beforeEach(() => vi.resetAllMocks());

describe("explicit memory lifecycle during generation", () => {
  it("does not read any saved memory when consent is absent", async () => {
    database.query.mockResolvedValueOnce({ rows: [] });
    database.query.mockResolvedValueOnce({ rows: [{ memory_enabled: false, memory_revision: "0" }] });
    const result = await loadChatContext(session, "هل");
    expect(result.memories).toEqual([]);
    expect(result.memorySnapshot).toEqual([]);
    expect(database.query.mock.calls.some(([sql]) => /FROM memories\b/.test(sql as string))).toBe(false);
  });

  it("does not read memory when the explicit preference is false", async () => {
    database.query.mockResolvedValueOnce({ rows: [] });
    database.query.mockResolvedValueOnce({ rows: [{ memory_enabled: false, memory_revision: "0" }] });
    const result = await loadChatContext(session, "هل");
    expect(result.memories).toEqual([]);
    expect(database.query.mock.calls.some(([sql]) => /FROM memories\b/.test(sql as string))).toBe(false);
  });

  it("discards an in-flight answer before persistence if the user switches memory off", async () => {
    database.query.mockResolvedValueOnce({ rows: [{ memory_enabled: false, memory_revision: "1" }] });
    await expect(saveChatResult(session, context, "سؤالي", `إجابة تتضمن ${memory.content}`)).rejects.toMatchObject({ status: 409, code: "MEMORY_CHANGED" });
    expect(database.query.mock.calls.some(([sql]) => /INSERT INTO (messages|conversations)/.test(sql as string))).toBe(false);
  });

  it.each([
    { rows: [] },
    { rows: [{ ...memory, content: "معلومة معدّلة" }] },
  ])("discards pending content after a used memory is deleted or edited", async ({ rows }) => {
    database.query.mockResolvedValueOnce({ rows: [{ memory_enabled: true, memory_revision: "0" }] });
    database.query.mockResolvedValueOnce({ rows });
    await expect(saveChatResult(session, context, "سؤالي", "إجابة قديمة")).rejects.toMatchObject({ code: "MEMORY_CHANGED" });
    expect(database.query.mock.calls.some(([sql]) => /INSERT INTO (messages|conversations)/.test(sql as string))).toBe(false);
  });

  it("persists when all actually used memories remain consented and unchanged", async () => {
    database.query.mockResolvedValueOnce({ rows: [{ memory_enabled: true, memory_revision: "0" }] });
    database.query.mockResolvedValueOnce({ rows: [memory] });
    database.query.mockResolvedValueOnce({ rows: [] });
    database.query.mockResolvedValueOnce({ rows: [] });
    database.query.mockResolvedValueOnce({ rows: [{ id: "assistant-id", role: "assistant", content: "إجابة", citations: [], created_at: "2026-01-01T00:00:00Z" }] });
    const result = await saveChatResult(session, context, "سؤالي", "إجابة");
    expect(result.message.content).toBe("إجابة");
    expect(database.query.mock.calls.some(([sql]) => /FOR SHARE/.test(sql as string))).toBe(true);
  });

  it("rejects stale history context even when no direct saved memory was loaded", async () => {
    database.query.mockResolvedValueOnce({ rows: [{ memory_enabled: false, memory_revision: "1" }] });
    const historyOnly = { ...context, memorySnapshot: [], memories: [], history: [{ role: "assistant" as const, content: memory.content }] };
    await expect(saveChatResult(session, historyOnly, "متابعة", "إجابة قديمة")).rejects.toMatchObject({ code: "MEMORY_CHANGED" });
    expect(database.query.mock.calls.some(([sql]) => /INSERT INTO (messages|conversations)/.test(sql as string))).toBe(false);
  });
});
