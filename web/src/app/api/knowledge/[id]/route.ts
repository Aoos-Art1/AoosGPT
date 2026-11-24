import { requireTenant } from "@/lib/server/auth";
import { withTenant } from "@/lib/server/db";
import { AppError, assertSameOrigin, jsonError } from "@/lib/server/http";
import { privateJson, requireUuid } from "@/lib/server/ai/schemas";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request);
    const session = await requireTenant("manage");
    const id = requireUuid((await context.params).id);
    await withTenant(session, async (client) => {
      const result = await client.query("DELETE FROM documents WHERE id = $1 AND tenant_id = $2 RETURNING id", [id, session.tenantId]);
      if (!result.rowCount) throw new AppError(404, "DOCUMENT_NOT_FOUND", "المستند غير موجود.");
    });
    return privateJson({ deleted: true });
  } catch (error) {
    return jsonError(error);
  }
}
