import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, updateTenant } from "@/lib/server/auth";
import { assertSameOrigin, jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  status: z.enum(["active", "suspended"]).optional(),
  plan: z.enum(["free", "starter", "professional", "enterprise"]).optional(),
}).strict().refine((value) => value.status !== undefined || value.plan !== undefined);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const ctx = await requireAdmin();
    const id = z.string().uuid().parse((await context.params).id);
    const input = await readJson(request, schema, 2048);
    return NextResponse.json(await updateTenant(ctx, id, input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
