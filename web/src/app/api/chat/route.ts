import { requireTenant } from "@/lib/server/auth";
import { assertSameOrigin, jsonError, readJson } from "@/lib/server/http";
import { getOpenAIConfiguration } from "@/lib/server/ai/config";
import { reserveAIRequest } from "@/lib/server/ai/budgets";
import { generateChat } from "@/lib/server/ai/provider";
import { chatSchema, privateJson } from "@/lib/server/ai/schemas";
import { loadChatContext, saveChatResult } from "@/lib/server/ai/store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const session = await requireTenant("write");
    const input = await readJson(request, chatSchema, 40_000);
    getOpenAIConfiguration("chat");
    const context = await loadChatContext(session, input.message, input.conversationId);
    await reserveAIRequest(session, "chat");
    const text = await generateChat({ ...context, message: input.message, skill: input.skill, mode: input.mode, signal: request.signal });
    const saved = await saveChatResult(session, context, input.message, text);
    return privateJson(saved);
  } catch (error) {
    return jsonError(error);
  }
}
