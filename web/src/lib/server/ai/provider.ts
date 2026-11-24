import "server-only";

import { z } from "zod";
import { AppError } from "@/lib/server/http";
import { AI_LIMITS, getOpenAIConfiguration, getSpeechConfiguration } from "./config";
import { ASSISTANT_INSTRUCTIONS, buildContextMessage, type ContextMessage, type RetrievedSource } from "./context";
import { assertProviderResponse, providerFailure, readBoundedBytes, readProviderJson } from "./io";

const responseSchema = z.object({
  status: z.string().optional(),
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({
      type: z.string(),
      text: z.string().optional(),
      refusal: z.string().optional(),
    })).optional(),
  })),
});

export async function generateChat(input: {
  message: string;
  history: ContextMessage[];
  sources: RetrievedSource[];
  memories: string[];
  signal: AbortSignal;
}): Promise<string> {
  const configuration = getOpenAIConfiguration("chat");
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(AI_LIMITS.chatTimeoutMs)]);
  const context = buildContextMessage(input.sources, input.memories);
  const messages: ContextMessage[] = [
    ...(context ? [context] : []),
    ...input.history,
    { role: "user", content: input.message },
  ];
  try {
    const response = await fetch(`${configuration.baseUrl}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${configuration.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: configuration.model,
        instructions: ASSISTANT_INSTRUCTIONS,
        input: messages,
        store: false,
        stream: false,
        max_output_tokens: AI_LIMITS.outputTokens,
      }),
      signal,
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) await response.body?.cancel();
    assertProviderResponse(response);
    const parsed = responseSchema.safeParse(await readProviderJson(response));
    if (!parsed.success || (parsed.data.status && !["completed", "incomplete"].includes(parsed.data.status))) {
      throw new AppError(502, "AI_RESPONSE_INVALID", "لم يُرجع المزوّد إجابة مكتملة وصالحة.");
    }
    const text = parsed.data.output
      .filter((output) => output.type === "message")
      .flatMap((output) => output.content ?? [])
      .map((content) => content.type === "output_text" ? content.text ?? "" : content.type === "refusal" ? content.refusal ?? "" : "")
      .join("\n")
      .trim();
    if (!text || text.length > AI_LIMITS.outputCharacters) {
      throw new AppError(502, "AI_RESPONSE_INVALID", "لم يُرجع المزوّد إجابة قابلة للعرض.");
    }
    return parsed.data.status === "incomplete"
      ? `${text}\n\n— توقف الرد عند حدّ الطول المسموح. اطلب متابعة الجزء المطلوب إذا لزم.`
      : text;
  } catch (error) {
    throw providerFailure(error, signal);
  }
}

export async function transcribeAudio(audio: Uint8Array<ArrayBuffer>, requestSignal: AbortSignal): Promise<string> {
  const configuration = getOpenAIConfiguration("transcription");
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(AI_LIMITS.audioTimeoutMs)]);
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/wav" }), "recording.wav");
  form.append("model", configuration.model);
  // Language hints differ between provider models. Automatic detection avoids
  // advertising incompatible parameters for a configured transcription model.
  form.append("response_format", "json");
  try {
    const response = await fetch(`${configuration.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${configuration.key}` },
      body: form,
      signal,
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) await response.body?.cancel();
    assertProviderResponse(response);
    const result = z.object({ text: z.string().trim().min(1).max(AI_LIMITS.messageCharacters) }).safeParse(await readProviderJson(response));
    if (!result.success) throw new AppError(502, "TRANSCRIPTION_INVALID", "لم يتضح الكلام في التسجيل أو تجاوز النص الحد المسموح. حاول تسجيل مقطع أقصر.");
    return result.data.text;
  } catch (error) {
    throw providerFailure(error, signal);
  }
}

export function escapeSsml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character]!);
}

export async function synthesizeSpeech(text: string, requestSignal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const configuration = getSpeechConfiguration();
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(AI_LIMITS.audioTimeoutMs)]);
  try {
    const response = await fetch(`https://${configuration.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": configuration.key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "AoosGPT",
      },
      body: `<speak version="1.0" xml:lang="ar-SA"><voice name="${configuration.voice}">${escapeSsml(text)}</voice></speak>`,
      signal,
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) await response.body?.cancel();
    assertProviderResponse(response);
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("audio/")) {
      await response.body?.cancel();
      throw new AppError(502, "SPEECH_INVALID", "لم يُرجع المزوّد ملفًا صوتيًا صالحًا.");
    }
    const audio = await readBoundedBytes(response.body, 5 * 1024 * 1024, new AppError(502, "SPEECH_TOO_LARGE", "تجاوز الصوت الناتج الحد المسموح."));
    if (audio.byteLength < 32) throw new AppError(502, "SPEECH_INVALID", "لم يُرجع المزوّد ملفًا صوتيًا صالحًا.");
    return audio;
  } catch (error) {
    throw providerFailure(error, signal);
  }
}
