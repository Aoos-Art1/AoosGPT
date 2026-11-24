import { NextResponse } from "next/server";
import { listAdminUsers, readAdminListOptions, requireAdmin } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await requireAdmin();
    return NextResponse.json(await listAdminUsers(ctx, readAdminListOptions(request)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
