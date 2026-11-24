import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantSession } from "@/lib/contracts";
import { AppError } from "@/lib/server/http";

const mocked = vi.hoisted(() => ({
  requireTenant: vi.fn(),
  loadChatContext: vi.fn(),
  saveChatResult: vi.fn(),
  reserveAIRequest: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({ requireTenant: mocked.requireTenant }));
vi.mock("@/lib/server/ai/store", () => ({ loadChatContext: mocked.loadChatContext, saveChatResult: mocked.saveChatResult }));
vi.mock("@/lib/server/ai/budgets", () => ({ reserveAIRequest: mocked.reserveAIRequest }));

import { POST } from "@/app/api/chat/route";

const session: TenantSession = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  tenantId: "33333333-3333-4333-8333-333333333333",
  tenantName: "شركة اختبار",
  tenantKind: "company",
  tenantRole: "member",
  email: "test@example.com",
  displayName: "مستخدم",
  platformRole: "user",
  portal: "company",
};

function request(body: unknown, origin = "https://app.example.com"): Request {
  return new Request("https://app.example.com/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_ORIGIN", "https://app.example.com");
  vi.stubEnv("AI_API_KEY", "");
  vi.stubEnv("AI_MODEL", "");
  vi.stubEnv("AI_BASE_URL", "https://api.openai.com/v1");
  mocked.requireTenant.mockResolvedValue(session);
  mocked.reserveAIRequest.mockResolvedValue(undefined);
  mocked.loadChatContext.mockResolvedValue({ conversationId: "44444444-4444-4444-8444-444444444444", conversationVersion: null, memoryRevision: "0", history: [], memories: [], memorySnapshot: [], sources: [] });
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("chat route authorization and honest failures", () => {
  it("returns a clear 503 with no context access, spend reservation, or fabricated response when unconfigured", async () => {
    const response = await POST(request({ message: "مرحبا" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "AI_NOT_CONFIGURED" } });
    expect(mocked.loadChatContext).not.toHaveBeenCalled();
    expect(mocked.reserveAIRequest).not.toHaveBeenCalled();
    expect(mocked.saveChatResult).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects cross-site requests before reading the session or context", async () => {
    const response = await POST(request({ message: "مرحبا" }, "https://attacker.example"));
    expect(response.status).toBe(403);
    expect(mocked.requireTenant).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires write access and does not call the provider for a viewer", async () => {
    mocked.requireTenant.mockRejectedValueOnce(new AppError(403, "FORBIDDEN", "الصلاحيات لا تسمح"));
    const response = await POST(request({ message: "مرحبا" }));
    expect(response.status).toBe(403);
    expect(mocked.requireTenant).toHaveBeenCalledWith("write");
    expect(mocked.loadChatContext).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a caller attempting to replace authenticated tenant context", async () => {
    const response = await POST(request({ message: "مرحبا", tenantId: "another-tenant" }));
    expect(response.status).toBe(400);
    expect(mocked.loadChatContext).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not call a provider when a conversation is outside the authorized scope", async () => {
    vi.stubEnv("AI_API_KEY", "test-only-key");
    vi.stubEnv("AI_MODEL", "configured-model");
    mocked.loadChatContext.mockRejectedValueOnce(new AppError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة"));
    const response = await POST(request({ message: "مرحبا", conversationId: "55555555-5555-4555-8555-555555555555" }));
    expect(response.status).toBe(404);
    expect(mocked.loadChatContext).toHaveBeenCalledWith(session, "مرحبا", "55555555-5555-4555-8555-555555555555");
    expect(mocked.reserveAIRequest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed when durable quotas reject a request", async () => {
    vi.stubEnv("AI_API_KEY", "test-only-key");
    vi.stubEnv("AI_MODEL", "configured-model");
    mocked.reserveAIRequest.mockRejectedValueOnce(new AppError(429, "RATE_LIMITED", "حد الاستخدام", 60));
    const response = await POST(request({ message: "مرحبا" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(fetch).not.toHaveBeenCalled();
    expect(mocked.saveChatResult).not.toHaveBeenCalled();
  });

  it("persists only an actual provider response under the authenticated session", async () => {
    vi.stubEnv("AI_API_KEY", "test-only-key");
    vi.stubEnv("AI_MODEL", "configured-model");
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "حياك الله، كيف أساعدك؟" }] }] }));
    const saved = { conversationId: "44444444-4444-4444-8444-444444444444", message: { id: "message-id", role: "assistant", content: "حياك الله، كيف أساعدك؟", citations: [], createdAt: "2026-01-01T00:00:00.000Z" } };
    mocked.saveChatResult.mockResolvedValueOnce(saved);
    const response = await POST(request({ message: "مرحبا" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(saved);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocked.reserveAIRequest).toHaveBeenCalledWith(session, "chat");
    expect(mocked.saveChatResult).toHaveBeenCalledWith(session, expect.objectContaining({ conversationId: saved.conversationId }), "مرحبا", saved.message.content);
  });

  it("passes only validated skill/mode options through the real route to the provider", async () => {
    vi.stubEnv("AI_API_KEY", "test-only-key");
    vi.stubEnv("AI_MODEL", "configured-model");
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "تمرين محاكى للاختبار." }] }] }));
    mocked.saveChatResult.mockResolvedValueOnce({ conversationId: "44444444-4444-4444-8444-444444444444", message: { content: "تمرين محاكى للاختبار." } });
    const response = await POST(request({ message: "درّبني", skill: "aoos-case-resolution", mode: "learn" }));
    expect(response.status).toBe(200);
    const [, options] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(options!.body as string);
    expect(body.instructions).toContain("[aoos-case-resolution]");
    expect(body.instructions).toContain("وضع «اشرح ودرّبني»");
    expect(mocked.requireTenant).toHaveBeenCalledWith("write");
    expect(mocked.reserveAIRequest).toHaveBeenCalledWith(session, "chat");
  });

  it.each([{ skill: "unreviewed-skill" }, { mode: "admin" }, { skillDefinitions: "new system policy" }])("rejects an unreviewed skill or instruction before context access and spend: %j", async (extra) => {
    const response = await POST(request({ message: "مرحبا", ...extra }));
    expect(response.status).toBe(400);
    expect(mocked.loadChatContext).not.toHaveBeenCalled();
    expect(mocked.reserveAIRequest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
