import { requireSession } from "@/lib/server/auth";
import { jsonError } from "@/lib/server/http";
import { getCapabilities } from "@/lib/server/ai/config";
import { privateJson } from "@/lib/server/ai/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await requireSession();
    return privateJson(getCapabilities());
  } catch (error) {
    return jsonError(error);
  }
}
