import { NextResponse } from "next/server";
import { z } from "zod";
import { acceptInvitation, revokeSession, safeSessionDTO, setSessionCookie } from "@/lib/server/auth";
import { assertSameOrigin, jsonError, readJson } from "@/lib/server/http";
import { validPasswordLength } from "@/lib/server/password";
import { consumeRateLimit, rateLimitIdentity, requestSourceKey } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  name: z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f\u007f]*$/),
  password: z.string().refine(validPasswordLength),
}).strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await consumeRateLimit(`invite:source:${requestSourceKey(request)}`, 20, 900);
    const input = await readJson(request, schema, 4096);
    await consumeRateLimit(`invite:token:${rateLimitIdentity(input.token)}`, 5, 900);
    const result = await acceptInvitation(input);
    await revokeSession();
    await setSessionCookie(result.token, result.session.portal);
    return NextResponse.json({ session: safeSessionDTO(result.session), redirectTo: result.redirectTo }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
