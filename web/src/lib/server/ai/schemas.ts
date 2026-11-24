import { z } from "zod";
import { ASSISTANT_MODES, ASSISTANT_SKILL_IDS } from "@/lib/assistant-skills";
import { AppError } from "@/lib/server/http";

const text = (maximum: number) => z.string().trim().min(1).max(maximum).refine((value) => !value.includes("\0"), "النص يحتوي على محارف غير صالحة.");

export const chatSchema = z.object({
  message: text(8_000),
  conversationId: z.uuid().optional(),
  skill: z.enum(["auto", ...ASSISTANT_SKILL_IDS]).optional(),
  mode: z.enum(ASSISTANT_MODES).optional(),
}).strict();

export const knowledgeSchema = z.object({
  title: text(160),
  content: text(50_000),
  sourceUrl: z.url().max(2_048).refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "رابط المصدر يجب أن يستخدم HTTPS.").optional(),
}).strict();

export const memorySchema = z.object({ content: text(500) }).strict();
export const preferencesSchema = z.object({ memoryEnabled: z.boolean() }).strict();
export const speechSchema = z.object({
  text: text(2_000).regex(/^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]*$/u, "النص يحتوي على محارف غير صالحة للصوت."),
}).strict();

export function requireUuid(value: string): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new AppError(400, "INVALID_ID", "المعرّف غير صالح.");
  return parsed.data;
}

export function privateJson(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}
