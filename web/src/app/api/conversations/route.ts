import { requireTenant } from "@/lib/server/auth";
import { withTenant } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { privateJson } from "@/lib/server/ai/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const session = await requireTenant("read");
    const conversations = await withTenant(session, async (client) => {
      const result = await client.query<{ id: string; title: string; updated_at: Date | string }>(
        "SELECT id, title, updated_at FROM conversations WHERE tenant_id = $1 AND user_id = $2 ORDER BY updated_at DESC, id DESC LIMIT 100",
        [session.tenantId, session.userId],
      );
      return result.rows.map((row) => ({ id: row.id, title: row.title, updatedAt: new Date(row.updated_at).toISOString() }));
    });
    return privateJson({ conversations });
  } catch (error) {
    return jsonError(error);
  }
}
