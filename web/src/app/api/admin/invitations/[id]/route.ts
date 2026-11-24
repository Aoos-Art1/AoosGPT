import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, revokeInvitation } from "@/lib/server/auth";
import { assertSameOrigin, jsonError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const ctx = await requireAdmin();
    const id = z.string().uuid().parse((await context.params).id);
    return NextResponse.json(await revokeInvitation(ctx, id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
