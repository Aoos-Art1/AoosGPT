"use client";

export class ClientError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = "ClientError";
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...options.headers },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ClientError(payload?.error?.message || "تعذّر إكمال الطلب. أعد المحاولة بعد قليل.", response.status, payload?.error?.code);
  }
  return payload as T;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "حدث خطأ غير متوقع. أعد المحاولة.";
}

export const number = (value: number, digits = 0) => new Intl.NumberFormat("ar-SA", { maximumFractionDigits: digits }).format(value);
export const money = (value: number) => new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 2 }).format(value);
export const shortDate = (value: string) => new Intl.DateTimeFormat("ar-SA", { calendar: "gregory", day: "numeric", month: "short", timeZone: "Asia/Riyadh" }).format(new Date(value));

export function externalUrl(value?: string | null) {
  if (!value) return undefined;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}

export function downloadText(filename: string, content: string) {
  const blob = new Blob(["\uFEFF", content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
