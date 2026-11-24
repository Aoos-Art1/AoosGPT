import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/server/http";
import { validatePcmWav } from "@/lib/server/ai/wav";

function wav(seconds = 1): Uint8Array<ArrayBuffer> {
  const dataLength = Math.round(seconds * 16_000) * 2;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, text: string) => [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  tag(0, "RIFF"); view.setUint32(4, 36 + dataLength, true); tag(8, "WAVE");
  tag(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true); view.setUint32(28, 32_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, "data"); view.setUint32(40, dataLength, true);
  return bytes;
}

describe("server-derived PCM recording limits", () => {
  it("accepts a normal 16 kHz mono PCM recording and the exact 60-second boundary", () => {
    expect(validatePcmWav(wav())).toEqual({ durationSeconds: 1, sampleRate: 16_000, channels: 1 });
    expect(validatePcmWav(wav(60)).durationSeconds).toBe(60);
  });

  it("rejects even one extra sample beyond 60 seconds", () => {
    expect(() => validatePcmWav(wav(60 + 1 / 16_000))).toThrowError(expect.objectContaining({ code: "AUDIO_TOO_LONG" }));
  });

  it("rejects truncated files and forged RIFF length", () => {
    expect(() => validatePcmWav(wav().subarray(0, 100))).toThrowError(AppError);
    const bytes = wav();
    new DataView(bytes.buffer).setUint32(4, bytes.length - 9, true);
    expect(() => validatePcmWav(bytes)).toThrowError(AppError);
  });

  it.each([
    [20, 3], // float audio instead of PCM
    [22, 2], // stereo
    [24, 48_000], // wrong rate
    [28, 64_000], // false byte rate
    [32, 4], // wrong frame alignment
    [34, 8], // wrong bit depth
  ])("rejects misleading format field at offset %i", (offset, value) => {
    const bytes = wav();
    const view = new DataView(bytes.buffer);
    if ([24, 28].includes(offset)) view.setUint32(offset, value, true);
    else view.setUint16(offset, value, true);
    expect(() => validatePcmWav(bytes)).toThrowError(AppError);
  });

  it("rejects forged data sizes, empty audio, non-WAV data, and oversized uploads", () => {
    const bytes = wav();
    new DataView(bytes.buffer).setUint32(40, 0xffff_ffff, true);
    expect(() => validatePcmWav(bytes)).toThrowError(AppError);
    expect(() => validatePcmWav(wav(0))).toThrowError(AppError);
    expect(() => validatePcmWav(new Uint8Array(44))).toThrowError(AppError);
    expect(() => validatePcmWav(new Uint8Array(2 * 1024 * 1024 + 1))).toThrowError(expect.objectContaining({ status: 413 }));
  });

  it("rejects duplicate data chunks that could bypass a duration check", () => {
    const original = wav(31);
    const secondData = original.subarray(36);
    const combined = new Uint8Array(original.length + secondData.length);
    combined.set(original); combined.set(secondData, original.length);
    new DataView(combined.buffer).setUint32(4, combined.length - 8, true);
    expect(() => validatePcmWav(combined)).toThrowError(AppError);
  });

  it("handles typed-array views correctly without reading outside the uploaded file", () => {
    const original = wav();
    const buffer = new Uint8Array(original.length + 10);
    buffer.set(original, 5);
    expect(validatePcmWav(buffer.subarray(5, 5 + original.length)).durationSeconds).toBe(1);
  });
});
