import { NextResponse } from "next/server";
import { adminOverview, requireAdmin } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await adminOverview(await requireAdmin()), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
