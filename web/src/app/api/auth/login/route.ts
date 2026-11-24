import { NextResponse } from "next/server";
import { z } from "zod";
import { login, revokeSession, safeSessionDTO, setSessionCookie } from "@/lib/server/auth";
import { assertSameOrigin, jsonError, readJson } from "@/lib/server/http";
import { consumeRateLimit, rateLimitIdentity, requestSourceKey } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(512).refine((value) => Buffer.byteLength(value, "utf8") <= 512),
  portal: z.enum(["individual", "company", "admin"]),
  tenantId: z.string().uuid().optional(),
}).strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await consumeRateLimit(`login:source:${requestSourceKey(request)}`, 30, 900);
    const input = await readJson(request, schema, 4096);
    await consumeRateLimit(`login:account:${rateLimitIdentity(input.email)}`, 8, 900);
    const result = await login(input);
    if ("requiresTenantSelection" in result) return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    // Replace any prior browser session only after authentication succeeds.
    await revokeSession();
    await setSessionCookie(result.token, result.session.portal);
    return NextResponse.json({ session: safeSessionDTO(result.session), redirectTo: result.redirectTo }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
