import { NextResponse } from "next/server";
import { z } from "zod";
import { createInvitation, listInvitations, readAdminListOptions, requireAdmin } from "@/lib/server/auth";
import { assertSameOrigin, jsonError, readJson } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f\u007f]*$/),
  tenantName: z.string().trim().min(1).max(160).regex(/^[^\u0000-\u001f\u007f]*$/).optional(),
  kind: z.enum(["individual", "company"]),
  role: z.enum(["owner", "admin", "member", "viewer"]),
  tenantId: z.string().uuid().optional(),
}).strict().refine((input) => Boolean(input.tenantId || (input.tenantName && input.role === "owner")));

export async function GET(request: Request) {
  try {
    const ctx = await requireAdmin();
    return NextResponse.json(await listInvitations(ctx, readAdminListOptions(request)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = await requireAdmin();
    await consumeRateLimit(`admin:invite:${ctx.userId}`, 40, 3600);
    const input = await readJson(request, schema, 4096);
    return NextResponse.json(await createInvitation(ctx, input), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
