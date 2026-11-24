import "server-only";

import { AppError } from "@/lib/server/http";

export async function readBoundedBytes(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  error: AppError,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw error;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let position = 0;
  for (const chunk of chunks) {
    result.set(chunk, position);
    position += chunk.byteLength;
  }
  return result;
}

export async function readProviderJson(response: Response): Promise<unknown> {
  const bytes = await readBoundedBytes(response.body, 512 * 1024, new AppError(502, "AI_RESPONSE_TOO_LARGE", "ردّ مزوّد الذكاء الاصطناعي تجاوز الحد المسموح."));
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, "AI_RESPONSE_INVALID", "تعذّر قراءة ردّ مزوّد الذكاء الاصطناعي.");
  }
}

export function assertProviderResponse(response: Response): void {
  if (response.ok) return;
  if ([401, 403, 404].includes(response.status)) {
    throw new AppError(503, "AI_PROVIDER_UNAVAILABLE", "المزوّد أو النموذج غير متاح بالإعدادات الحالية. يرجى مراجعة مسؤول التشغيل.");
  }
  if (response.status === 429) {
    throw new AppError(429, "AI_PROVIDER_LIMIT", "وصل مزوّد الخدمة إلى حد الاستخدام. حاول لاحقًا.");
  }
  throw new AppError(502, "AI_PROVIDER_ERROR", "تعذّر إكمال الطلب لدى مزوّد الخدمة. حاول لاحقًا.");
}

export function providerFailure(error: unknown, signal: AbortSignal): AppError {
  if (error instanceof AppError) return error;
  if (signal.aborted) return new AppError(504, "AI_TIMEOUT", "انتهت مهلة الطلب أو تم إلغاؤه. يمكنك المحاولة مجددًا.");
  return new AppError(502, "AI_CONNECTION_FAILED", "تعذّر الاتصال بمزوّد الخدمة. حاول لاحقًا.");
}
