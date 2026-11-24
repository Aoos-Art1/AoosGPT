import { requireTenant } from "@/lib/server/auth";
import { withTenant } from "@/lib/server/db";
import { AppError, assertSameOrigin, jsonError, readJson } from "@/lib/server/http";
import { AI_LIMITS } from "@/lib/server/ai/config";
import { chunkDocument } from "@/lib/server/ai/context";
import { knowledgeSchema, privateJson } from "@/lib/server/ai/schemas";
import { consumeRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DocumentRow = { id: string; title: string; source_url: string | null; created_at: Date | string; chunk_count: string };

function documentDto(row: DocumentRow) {
  return { id: row.id, title: row.title, sourceUrl: row.source_url, createdAt: new Date(row.created_at).toISOString(), chunkCount: Number(row.chunk_count) };
}

export async function GET(): Promise<Response> {
  try {
    const session = await requireTenant("read");
    const documents = await withTenant(session, async (client) => {
      const result = await client.query<DocumentRow>(
        `SELECT d.id, d.title, d.source_url, d.created_at, count(c.id) AS chunk_count
         FROM documents d LEFT JOIN document_chunks c ON c.document_id = d.id AND c.tenant_id = d.tenant_id
         WHERE d.tenant_id = $1 GROUP BY d.id, d.title, d.source_url, d.created_at
         ORDER BY d.created_at DESC, d.id DESC LIMIT 100`,
        [session.tenantId],
      );
      return result.rows.map(documentDto);
    });
    return privateJson({ documents });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const session = await requireTenant("manage");
    const input = await readJson(request, knowledgeSchema, 220_000);
    await consumeRateLimit(`knowledge:${session.tenantId}:day`, 30, 86_400);
    const chunks = chunkDocument(input.content);
    const document = await withTenant(session, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`knowledge:${session.tenantId}`]);
      const count = await client.query<{ count: string }>("SELECT count(*) FROM documents WHERE tenant_id = $1", [session.tenantId]);
      if (Number(count.rows[0].count) >= AI_LIMITS.knowledgeDocuments) throw new AppError(409, "KNOWLEDGE_LIMIT", "بلغت مساحة العمل حد المستندات. احذف مستندًا قبل إضافة آخر.");
      const result = await client.query<Omit<DocumentRow, "chunk_count">>(
        "INSERT INTO documents (tenant_id, owner_user_id, title, content, source_url) VALUES ($1, $2, $3, $4, $5) RETURNING id, title, source_url, created_at",
        [session.tenantId, session.userId, input.title, input.content, input.sourceUrl ?? null],
      );
      const row = result.rows[0];
      await client.query(
        "INSERT INTO document_chunks (tenant_id, document_id, content, chunk_index) SELECT $1, $2, content, ordinal::int - 1 FROM unnest($3::text[]) WITH ORDINALITY AS chunk(content, ordinal)",
        [session.tenantId, row.id, chunks],
      );
      return documentDto({ ...row, chunk_count: String(chunks.length) });
    });
    return privateJson({ document }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
