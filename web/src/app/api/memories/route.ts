import { requireTenant } from "@/lib/server/auth";
import { withTenant } from "@/lib/server/db";
import { AppError, assertSameOrigin, jsonError, readJson } from "@/lib/server/http";
import { AI_LIMITS } from "@/lib/server/ai/config";
import { memorySchema, preferencesSchema, privateJson } from "@/lib/server/ai/schemas";
import { consumeRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MemoryRow = { id: string; content: string; created_at: Date | string };

function memoryDto(row: MemoryRow) {
  return { id: row.id, content: row.content, createdAt: new Date(row.created_at).toISOString() };
}

export async function GET(): Promise<Response> {
  try {
    const session = await requireTenant("read");
    const data = await withTenant(session, async (client) => {
      const preferences = await client.query<{ memory_enabled: boolean }>(
        "SELECT memory_enabled FROM preferences WHERE tenant_id = $1 AND user_id = $2", [session.tenantId, session.userId],
      );
      const result = await client.query<MemoryRow>(
        "SELECT id, content, created_at FROM memories WHERE tenant_id = $1 AND user_id = $2 ORDER BY created_at DESC, id DESC LIMIT 50", [session.tenantId, session.userId],
      );
      return { memories: result.rows.map(memoryDto), memoryEnabled: preferences.rows[0]?.memory_enabled === true };
    });
    return privateJson(data);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const session = await requireTenant("write");
    const input = await readJson(request, memorySchema, 4_000);
    await consumeRateLimit(`memory:${session.tenantId}:${session.userId}:minute`, 10, 60);
    const memory = await withTenant(session, async (client) => {
      // A preference-row lock serializes opt-in changes and memory insert limits.
      await client.query(
        "INSERT INTO preferences (tenant_id, user_id, memory_enabled) VALUES ($1, $2, false) ON CONFLICT (tenant_id, user_id) DO NOTHING",
        [session.tenantId, session.userId],
      );
      const preferences = await client.query<{ memory_enabled: boolean }>(
        "SELECT memory_enabled FROM preferences WHERE tenant_id = $1 AND user_id = $2 FOR UPDATE", [session.tenantId, session.userId],
      );
      if (preferences.rows[0]?.memory_enabled !== true) {
        throw new AppError(409, "MEMORY_DISABLED", "فعّل الذاكرة أولًا قبل حفظ معلومة. لا تُحفظ الذكريات تلقائيًا من المحادثة.");
      }
      const count = await client.query<{ count: string }>("SELECT count(*) FROM memories WHERE tenant_id = $1 AND user_id = $2", [session.tenantId, session.userId]);
      if (Number(count.rows[0].count) >= AI_LIMITS.memoryItems) throw new AppError(409, "MEMORY_LIMIT", "بلغت حد الذكريات المحفوظة. احذف معلومة قبل إضافة أخرى.");
      const result = await client.query<MemoryRow>(
        "INSERT INTO memories (tenant_id, user_id, content) VALUES ($1, $2, $3) RETURNING id, content, created_at", [session.tenantId, session.userId, input.content],
      );
      return memoryDto(result.rows[0]);
    });
    return privateJson({ memory }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const session = await requireTenant("write");
    const input = await readJson(request, preferencesSchema, 1_024);
    await withTenant(session, async (client) => {
      await client.query(
        `INSERT INTO preferences (tenant_id, user_id, memory_enabled) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET memory_enabled = EXCLUDED.memory_enabled`,
        [session.tenantId, session.userId, input.memoryEnabled],
      );
    });
    return privateJson({ memoryEnabled: input.memoryEnabled });
  } catch (error) {
    return jsonError(error);
  }
}
