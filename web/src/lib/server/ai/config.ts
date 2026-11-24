import "server-only";

import type { Capabilities } from "@/lib/contracts";
import { AppError } from "@/lib/server/http";

export const AI_LIMITS = {
  messageCharacters: 8_000,
  historyMessages: 12,
  historyCharacters: 16_000,
  outputTokens: 1_200,
  outputCharacters: 20_000,
  chatTimeoutMs: 45_000,
  audioTimeoutMs: 30_000,
  audioBytes: 2 * 1024 * 1024,
  speechCharacters: 2_000,
  knowledgeCharacters: 50_000,
  knowledgeDocuments: 100,
  memoryCharacters: 500,
  memoryItems: 50,
  conversationMessages: 200,
} as const;

export interface OpenAIConfiguration {
  key: string;
  baseUrl: string;
  model: string;
}

/** Endpoint selection is exclusively deployment configuration, never user input. */
export function validateAIBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(503, "AI_CONFIGURATION_INVALID", "إعداد عنوان مزوّد الذكاء الاصطناعي غير صالح.");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !hostname.includes(".") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    /^\d+(?:\.\d+){3}$/.test(hostname) ||
    hostname.includes(":")
  ) {
    throw new AppError(503, "AI_CONFIGURATION_INVALID", "يلزم عنوان HTTPS عام وصالح لمزوّد الذكاء الاصطناعي.");
  }
  return url.toString().replace(/\/+$/, "");
}

function configuredValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function getOpenAIConfiguration(kind: "chat" | "transcription"): OpenAIConfiguration {
  const key = configuredValue("AI_API_KEY");
  const model = configuredValue(kind === "chat" ? "AI_MODEL" : "AI_TRANSCRIPTION_MODEL");
  if (!key || !model) {
    throw new AppError(
      503,
      kind === "chat" ? "AI_NOT_CONFIGURED" : "TRANSCRIPTION_NOT_CONFIGURED",
      kind === "chat"
        ? "المحادثة الذكية غير مفعّلة بعد. يحتاج مسؤول التشغيل إلى إعداد المزوّد والنموذج."
        : "تحويل الصوت إلى نص غير مفعّل بعد.",
    );
  }
  if (model.length > 150 || /[\r\n]/.test(model)) {
    throw new AppError(503, "AI_CONFIGURATION_INVALID", "إعداد نموذج الذكاء الاصطناعي غير صالح.");
  }
  return {
    key,
    model,
    baseUrl: validateAIBaseUrl(configuredValue("AI_BASE_URL") ?? "https://api.openai.com/v1"),
  };
}

export function getSpeechConfiguration(): { key: string; region: string; voice: string } {
  const key = configuredValue("AZURE_SPEECH_KEY");
  const region = configuredValue("AZURE_SPEECH_REGION");
  if (!key || !region || !/^[a-z][a-z0-9]{1,49}$/.test(region)) {
    throw new AppError(503, "SPEECH_NOT_CONFIGURED", "الصوت السعودي غير مفعّل بعد.");
  }
  return { key, region, voice: "ar-SA-HamedNeural" };
}

/** A configured capability is not a successful live-provider health check. */
export function getCapabilities(): Capabilities {
  const available = (check: () => unknown): boolean => {
    try {
      check();
      return true;
    } catch {
      return false;
    }
  };
  const speech = available(getSpeechConfiguration);
  return {
    chat: available(() => getOpenAIConfiguration("chat")),
    transcription: available(() => getOpenAIConfiguration("transcription")),
    speech,
    speechLocale: speech ? "ar-SA" : null,
  };
}
