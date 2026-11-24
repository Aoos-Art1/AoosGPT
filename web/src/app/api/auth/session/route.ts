import { NextResponse } from "next/server";
import { getSession, safeSessionDTO } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    return NextResponse.json({ session: session ? safeSessionDTO(session) : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
