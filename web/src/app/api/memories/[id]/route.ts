import { requireTenant } from "@/lib/server/auth";
import { withTenant } from "@/lib/server/db";
import { AppError, assertSameOrigin, jsonError, readJson } from "@/lib/server/http";
import { memorySchema, privateJson, requireUuid } from "@/lib/server/ai/schemas";
import { consumeRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request);
    const session = await requireTenant("write");
    const id = requireUuid((await context.params).id);
    const input = await readJson(request, memorySchema, 4_000);
    await consumeRateLimit(`memory:${session.tenantId}:${session.userId}:minute`, 10, 60);
    const memory = await withTenant(session, async (client) => {
      const preferences = await client.query<{ memory_enabled: boolean }>(
        "SELECT memory_enabled FROM preferences WHERE tenant_id = $1 AND user_id = $2 FOR UPDATE", [session.tenantId, session.userId],
      );
      if (preferences.rows[0]?.memory_enabled !== true) throw new AppError(409, "MEMORY_DISABLED", "فعّل الذاكرة أولًا قبل تعديل معلومة محفوظة.");
      const result = await client.query<{ id: string; content: string; created_at: Date | string }>(
        "UPDATE memories SET content = $4 WHERE id = $1 AND tenant_id = $2 AND user_id = $3 RETURNING id, content, created_at",
        [id, session.tenantId, session.userId, input.content],
      );
      if (!result.rowCount) throw new AppError(404, "MEMORY_NOT_FOUND", "المعلومة المحفوظة غير موجودة.");
      const row = result.rows[0];
      return { id: row.id, content: row.content, createdAt: new Date(row.created_at).toISOString() };
    });
    return privateJson({ memory });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request);
    const session = await requireTenant("write");
    const id = requireUuid((await context.params).id);
    await withTenant(session, async (client) => {
      // Consistent preference -> memory lock order with create/edit/save.
      // The database trigger advances the context revision in this transaction.
      await client.query(
        "INSERT INTO preferences (tenant_id, user_id, memory_enabled) VALUES ($1, $2, false) ON CONFLICT (tenant_id, user_id) DO NOTHING",
        [session.tenantId, session.userId],
      );
      await client.query(
        "SELECT memory_revision FROM preferences WHERE tenant_id = $1 AND user_id = $2 FOR UPDATE",
        [session.tenantId, session.userId],
      );
      const result = await client.query(
        "DELETE FROM memories WHERE id = $1 AND tenant_id = $2 AND user_id = $3 RETURNING id", [id, session.tenantId, session.userId],
      );
      if (!result.rowCount) throw new AppError(404, "MEMORY_NOT_FOUND", "المعلومة المحفوظة غير موجودة.");
    });
    // No embedding, summary, provider thread, or cache copy of memory is created.
    return privateJson({ deleted: true });
  } catch (error) {
    return jsonError(error);
  }
}
