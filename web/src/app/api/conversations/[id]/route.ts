import { requireTenant } from "@/lib/server/auth";
import { withTenant } from "@/lib/server/db";
import { AppError, assertSameOrigin, jsonError } from "@/lib/server/http";
import { privateJson, requireUuid } from "@/lib/server/ai/schemas";
import { loadConversationMessages } from "@/lib/server/ai/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const session = await requireTenant("read");
    const id = requireUuid((await context.params).id);
    const messages = await loadConversationMessages(session, id);
    return privateJson({ messages });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const session = await requireTenant("write");
    const id = requireUuid((await context.params).id);
    await withTenant(session, async (client) => {
      const result = await client.query(
        "DELETE FROM conversations WHERE id = $1 AND tenant_id = $2 AND user_id = $3 RETURNING id",
        [id, session.tenantId, session.userId],
      );
      if (!result.rowCount) throw new AppError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة.");
    });
    return privateJson({ deleted: true });
  } catch (error) {
    return jsonError(error);
  }
}
