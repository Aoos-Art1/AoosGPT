import { requireTenant } from "@/lib/server/auth";
import { assertSameOrigin, jsonError, readJson } from "@/lib/server/http";
import { getSpeechConfiguration } from "@/lib/server/ai/config";
import { reserveAIRequest } from "@/lib/server/ai/budgets";
import { synthesizeSpeech } from "@/lib/server/ai/provider";
import { speechSchema } from "@/lib/server/ai/schemas";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const session = await requireTenant("write");
    const input = await readJson(request, speechSchema, 12_000);
    getSpeechConfiguration();
    await reserveAIRequest(session, "speech");
    const audio = await synthesizeSpeech(input.text, request.signal);
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, no-store",
        "Content-Length": String(audio.byteLength),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
