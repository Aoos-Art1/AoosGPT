import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/http";
import { loadWorkspace } from "@/lib/server/workspace";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json(await loadWorkspace(await requireTenant()), {headers:{"Cache-Control":"private, no-store"}}); }
  catch(error) { return jsonError(error); }
}
