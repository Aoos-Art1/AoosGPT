import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter?: number;

  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function jsonError(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    error = new AppError(400, "INVALID_INPUT", "راجع صيغة البيانات ثم أعد المحاولة.");
  }
  if (error instanceof AppError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, {
      status: error.status,
      headers: {
        "Cache-Control": "no-store",
        ...(error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}),
      },
    });
  }
  // Never emit SQL, connection strings, tokens, or provider messages to clients.
  console.error("Request failed", { type: error instanceof Error ? error.name : "UnknownError" });
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "تعذّر إتمام الطلب. حاول مرة أخرى." } }, {
    status: 500, headers: { "Cache-Control": "no-store" },
  });
}

export function appOrigin(): string {
  const configured = process.env.APP_ORIGIN;
  if (!configured && process.env.NODE_ENV === "production") {
    throw new AppError(503, "CONFIGURATION_REQUIRED", "إعداد عنوان التطبيق غير مكتمل.");
  }
  let url: URL;
  try { url = new URL(configured || "http://localhost:3000"); }
  catch { throw new AppError(503, "CONFIGURATION_REQUIRED", "إعداد عنوان التطبيق غير صحيح."); }
  if (url.username || url.password || !["http:", "https:"].includes(url.protocol)
    || (process.env.NODE_ENV === "production" && url.protocol !== "https:")) {
    throw new AppError(503, "CONFIGURATION_REQUIRED", "يجب إعداد عنوان HTTPS موثوق للتطبيق.");
  }
  return url.origin;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  // All cookie-authenticated mutations require an exact, configured origin.
  // Host and forwarded-host headers are deliberately not a trust source.
  if (!origin || origin === "null" || origin !== appOrigin() || fetchSite === "cross-site") {
    throw new AppError(403, "INVALID_ORIGIN", "تعذّر التحقق من مصدر الطلب. افتح التطبيق وأعد المحاولة.");
  }
}

export async function readJson<T>(request: Request, schema: ZodType<T>, maxBytes = 64 * 1024): Promise<T> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "صيغة الطلب غير مدعومة.");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)) {
    throw new AppError(413, "REQUEST_TOO_LARGE", "حجم الطلب أكبر من المسموح.");
  }
  if (!request.body) throw new AppError(400, "INVALID_INPUT", "بيانات الطلب غير مكتملة.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AppError(413, "REQUEST_TOO_LARGE", "حجم الطلب أكبر من المسموح.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let input: unknown;
  try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new AppError(400, "INVALID_JSON", "تعذّر قراءة بيانات الطلب."); }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(400, "INVALID_INPUT", "راجع الحقول المطلوبة وصيغة البيانات ثم أعد المحاولة.");
  }
  return parsed.data;
}
