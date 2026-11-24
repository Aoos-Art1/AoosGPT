import { requireTenant } from "@/lib/server/auth";
import { AppError, assertSameOrigin, jsonError } from "@/lib/server/http";
import { AI_LIMITS, getOpenAIConfiguration } from "@/lib/server/ai/config";
import { reserveAIRequest } from "@/lib/server/ai/budgets";
import { readBoundedBytes } from "@/lib/server/ai/io";
import { transcribeAudio } from "@/lib/server/ai/provider";
import { privateJson } from "@/lib/server/ai/schemas";
import { validatePcmWav } from "@/lib/server/ai/wav";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const session = await requireTenant("write");
    getOpenAIConfiguration("transcription");
    const contentType = request.headers.get("content-type") ?? "";
    if (!/^multipart\/form-data\s*;/i.test(contentType)) {
      throw new AppError(415, "AUDIO_UPLOAD_INVALID", "أرسل التسجيل كملف صوتي في نموذج رفع.");
    }
    const maxBodyBytes = AI_LIMITS.audioBytes + 16_384;
    const declaredSize = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > maxBodyBytes) {
      throw new AppError(413, "AUDIO_TOO_LARGE", "حجم التسجيل أكبر من الحد المسموح.");
    }
    const body = await readBoundedBytes(request.body, maxBodyBytes, new AppError(413, "AUDIO_TOO_LARGE", "حجم التسجيل أكبر من الحد المسموح."));
    let form: FormData;
    try {
      form = await new Response(body, { headers: { "Content-Type": contentType } }).formData();
    } catch {
      throw new AppError(400, "AUDIO_UPLOAD_INVALID", "تعذّر قراءة ملف التسجيل.");
    }
    const file = form.get("audio");
    if (!(file instanceof File) || form.getAll("audio").length !== 1 || [...form.keys()].some((key) => key !== "audio")) {
      throw new AppError(400, "AUDIO_UPLOAD_INVALID", "أرفق ملف تسجيل واحدًا فقط.");
    }
    if (!["audio/wav", "audio/x-wav", "audio/wave"].includes(file.type)) {
      throw new AppError(415, "AUDIO_FORMAT_INVALID", "التسجيل يجب أن يكون بصيغة WAV.");
    }
    const audio = new Uint8Array(await file.arrayBuffer());
    validatePcmWav(audio);
    await reserveAIRequest(session, "transcription");
    const text = await transcribeAudio(audio, request.signal);
    return privateJson({ text });
  } catch (error) {
    return jsonError(error);
  }
}
