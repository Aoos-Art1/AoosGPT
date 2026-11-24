import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ChatMessage, TenantSession } from "@/lib/contracts";
import { withTenant } from "@/lib/server/db";
import { assertRecordCapacity } from "@/lib/server/capacity";
import { AppError } from "@/lib/server/http";
import { AI_LIMITS } from "./config";
import { citationsInAnswer, lexicalTerms, removeUnknownReferences, type ContextMessage, type RetrievedSource } from "./context";

export interface ChatContext {
  conversationId: string;
  conversationVersion: string | null;
  memoryRevision: string;
  history: ContextMessage[];
  memories: string[];
  memorySnapshot: Array<{ id: string; content: string }>;
  sources: RetrievedSource[];
}

function isoDate(value: Date | string): string {
  return new Date(value).toISOString();
}

export function toChatMessage(row: { id: string; role: "user" | "assistant"; content: string; citations: ChatMessage["citations"]; created_at: Date | string }): ChatMessage {
  return { id: row.id, role: row.role, content: row.content, citations: row.citations ?? [], createdAt: isoDate(row.created_at) };
}

export async function loadConversationMessages(session: TenantSession, conversationId: string): Promise<ChatMessage[]> {
  return withTenant(session, async (client) => {
    const exists = await client.query(
      "SELECT id FROM conversations WHERE id = $1 AND tenant_id = $2 AND user_id = $3",
      [conversationId, session.tenantId, session.userId],
    );
    if (!exists.rowCount) throw new AppError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة.");
    const result = await client.query<Parameters<typeof toChatMessage>[0]>(
      "SELECT id, role, content, citations, created_at FROM messages WHERE conversation_id = $1 AND tenant_id = $2 AND user_id = $3 ORDER BY sequence_no ASC LIMIT 200",
      [conversationId, session.tenantId, session.userId],
    );
    return result.rows.map(toChatMessage);
  });
}

async function retrieveSources(client: PoolClient, session: TenantSession, message: string): Promise<RetrievedSource[]> {
  const terms = lexicalTerms(message);
  if (!terms.length) return [];
  // Explicit tenant filters remain in both sides of the join, in addition to RLS.
  // This is ranked lexical substring retrieval, intentionally no embedding claims.
  const result = await client.query<{
    id: string; content: string; title: string; source_url: string | null;
  }>(`WITH candidates AS (
    SELECT c.id, c.content, d.title, d.source_url,
      (SELECT count(*) FROM unnest($2::text[]) AS term
       WHERE strpos(lower(translate(regexp_replace(c.content || ' ' || d.title, '[ًٌٍَُِّْـٰ]', '', 'g'), 'أإآى', 'اااي')), term) > 0) AS score
    FROM document_chunks c
    JOIN documents d ON d.id = c.document_id AND d.tenant_id = c.tenant_id
    WHERE c.tenant_id = $1 AND d.tenant_id = $1
  ) SELECT id, content, title, source_url FROM candidates
    WHERE score > 0 ORDER BY score DESC, id LIMIT 6`, [session.tenantId, terms]);
  return result.rows.map((row, index) => ({
    id: row.id,
    reference: `S${index + 1}`,
    title: row.title,
    content: row.content,
    excerpt: row.content.slice(0, 300),
    ...(row.source_url ? { url: row.source_url } : {}),
  }));
}

export async function loadChatContext(session: TenantSession, message: string, conversationId?: string): Promise<ChatContext> {
  return withTenant(session, async (client) => {
    // Materialize the boundary row before reading history. All mutations and
    // persistence lock this same row first, including when memory is disabled.
    await client.query(
      "INSERT INTO preferences (tenant_id, user_id, memory_enabled) VALUES ($1, $2, false) ON CONFLICT (tenant_id, user_id) DO NOTHING",
      [session.tenantId, session.userId],
    );
    const preferences = await client.query<{ memory_enabled: boolean; memory_revision: string }>(
      "SELECT memory_enabled, memory_revision::text AS memory_revision FROM preferences WHERE tenant_id = $1 AND user_id = $2 FOR SHARE",
      [session.tenantId, session.userId],
    );
    const preference = preferences.rows[0];
    if (!preference) throw new AppError(409, "MEMORY_CHANGED", "تعذّر تثبيت إعدادات سياق المحادثة. أعد المحاولة.");
    let conversationVersion: string | null = null;
    let history: ContextMessage[] = [];
    if (conversationId) {
      const conversation = await client.query<{ version: string; message_count: string }>(
        `SELECT c.updated_at::text AS version,
          (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id AND m.tenant_id = $2 AND m.user_id = $3) AS message_count
         FROM conversations c WHERE c.id = $1 AND c.tenant_id = $2 AND c.user_id = $3`,
        [conversationId, session.tenantId, session.userId],
      );
      if (!conversation.rows.length) throw new AppError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة.");
      if (Number(conversation.rows[0].message_count) >= AI_LIMITS.conversationMessages) {
        throw new AppError(409, "CONVERSATION_LIMIT", "بلغت المحادثة حد الرسائل. ابدأ محادثة جديدة للمتابعة.");
      }
      conversationVersion = conversation.rows[0].version;
      const previous = await client.query<{ role: "user" | "assistant"; content: string }>(
        "SELECT role, content FROM messages WHERE conversation_id = $1 AND tenant_id = $2 AND user_id = $3 AND memory_context_revision = $4::bigint ORDER BY sequence_no DESC LIMIT $5",
        [conversationId, session.tenantId, session.userId, preference.memory_revision, AI_LIMITS.historyMessages],
      );
      let remaining = AI_LIMITS.historyCharacters;
      history = previous.rows.map((row) => {
        const content = row.content.slice(0, Math.max(0, remaining));
        remaining -= content.length;
        return { role: row.role, content };
      }).filter((row) => row.content.length > 0).reverse();
    }
    let memorySnapshot: Array<{ id: string; content: string }> = [];
    if (preference.memory_enabled === true) {
      const saved = await client.query<{ id: string; content: string }>(
        "SELECT id, content FROM memories WHERE tenant_id = $1 AND user_id = $2 ORDER BY created_at DESC, id DESC LIMIT 12",
        [session.tenantId, session.userId],
      );
      memorySnapshot = saved.rows;
    }
    return {
      conversationId: conversationId ?? randomUUID(),
      conversationVersion,
      memoryRevision: preference.memory_revision,
      history,
      memories: memorySnapshot.map((row) => row.content),
      memorySnapshot,
      sources: await retrieveSources(client, session, message),
    };
  });
}

export async function saveChatResult(
  session: TenantSession,
  context: ChatContext,
  userMessage: string,
  assistantText: string,
): Promise<{ conversationId: string; message: ChatMessage }> {
  return withTenant(session, async (client) => {
    // A direct-memory snapshot alone is insufficient: history can repeat an
    // older memory. Revision changes invalidate EVERY pending answer instead.
    // The shared preference lock stays held until both messages are committed.
    const preferences = await client.query<{ memory_enabled: boolean; memory_revision: string }>(
      "SELECT memory_enabled, memory_revision::text AS memory_revision FROM preferences WHERE tenant_id = $1 AND user_id = $2 FOR SHARE", [session.tenantId, session.userId],
    );
    const preference = preferences.rows[0];
    if (!preference || preference.memory_revision !== context.memoryRevision) {
      throw new AppError(409, "MEMORY_CHANGED", "تغيّرت الذاكرة أثناء إعداد الإجابة، لذلك بدأ سياق جديد ولم تُحفظ الإجابة أو تُعرض. أعد إرسال طلبك.");
    }
    if (context.memorySnapshot.length) {
      // An upstream request cannot be recalled, but a revoked/edited memory
      // must not reappear in a newly delivered or persisted assistant answer.
      const current = preference.memory_enabled === true
        ? await client.query<{ id: string; content: string }>(
          "SELECT id, content FROM memories WHERE tenant_id = $1 AND user_id = $2 AND id = ANY($3::uuid[]) ORDER BY id FOR SHARE",
          [session.tenantId, session.userId, context.memorySnapshot.map((memory) => memory.id)],
        )
        : { rows: [] };
      const values = new Map(current.rows.map((memory) => [memory.id, memory.content]));
      if (context.memorySnapshot.some((memory) => values.get(memory.id) !== memory.content)) {
        throw new AppError(409, "MEMORY_CHANGED", "تغيّرت الذاكرة أثناء إعداد الإجابة، لذلك لم تُحفظ الإجابة أو تُعرض. أعد إرسال طلبك لاستخدام الإعدادات الحالية.");
      }
    }
    if (context.conversationVersion === null) {
      await assertRecordCapacity(client, session, "conversations");
      await client.query(
        "INSERT INTO conversations (id, tenant_id, user_id, title) VALUES ($1, $2, $3, $4)",
        [context.conversationId, session.tenantId, session.userId, userMessage.replace(/\s+/g, " ").slice(0, 90)],
      );
    } else {
      const updated = await client.query(
        "UPDATE conversations SET updated_at = clock_timestamp() WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND updated_at = $4::timestamptz RETURNING id",
        [context.conversationId, session.tenantId, session.userId, context.conversationVersion],
      );
      if (!updated.rowCount) throw new AppError(409, "CONVERSATION_CHANGED", "تغيّرت المحادثة أثناء إعداد الإجابة. حدّثها ثم أعد المحاولة.");
    }
    const content = removeUnknownReferences(assistantText, context.sources);
    const citations = citationsInAnswer(content, context.sources);
    await client.query(
      "INSERT INTO messages (tenant_id, user_id, conversation_id, role, content, memory_context_revision, created_at) VALUES ($1, $2, $3, 'user', $4, $5::bigint, clock_timestamp())",
      [session.tenantId, session.userId, context.conversationId, userMessage, context.memoryRevision],
    );
    const saved = await client.query<Parameters<typeof toChatMessage>[0]>(
      "INSERT INTO messages (tenant_id, user_id, conversation_id, role, content, citations, memory_context_revision, created_at) VALUES ($1, $2, $3, 'assistant', $4, $5::jsonb, $6::bigint, clock_timestamp()) RETURNING id, role, content, citations, created_at",
      [session.tenantId, session.userId, context.conversationId, content, JSON.stringify(citations), context.memoryRevision],
    );
    return { conversationId: context.conversationId, message: toChatMessage(saved.rows[0]) };
  });
}
