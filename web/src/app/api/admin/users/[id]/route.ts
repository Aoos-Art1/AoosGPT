import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, updateUserStatus } from "@/lib/server/auth";
import { assertSameOrigin, jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const ctx = await requireAdmin();
    const id = z.string().uuid().parse((await context.params).id);
    const input = await readJson(request, z.object({ disabled: z.boolean() }).strict(), 1024);
    return NextResponse.json(await updateUserStatus(ctx, id, input.disabled), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
