import { AppError } from "@/lib/server/http";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SECONDS = 60;

function invalid(): never {
  throw new AppError(400, "AUDIO_FORMAT_INVALID", "يلزم تسجيل WAV صالح بصوت أحادي PCM بدقة 16 بت وتردد 16000 هرتز.");
}

/** Validate duration from PCM byte counts; browser-supplied duration is not trusted. */
export function validatePcmWav(bytes: Uint8Array): { durationSeconds: number; sampleRate: number; channels: number } {
  if (bytes.byteLength > MAX_BYTES) throw new AppError(413, "AUDIO_TOO_LARGE", "حجم التسجيل أكبر من الحد المسموح.");
  if (bytes.byteLength < 44) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (position: number): string => String.fromCharCode(...bytes.subarray(position, position + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || view.getUint32(4, true) + 8 !== bytes.byteLength) invalid();
  let position = 12;
  let formatSeen = false;
  let dataSeen = false;
  let dataLength = 0;
  while (position < bytes.byteLength) {
    if (position + 8 > bytes.byteLength) invalid();
    const name = tag(position);
    const length = view.getUint32(position + 4, true);
    const start = position + 8;
    const end = start + length;
    const paddedEnd = end + length % 2;
    if (end > bytes.byteLength || paddedEnd > bytes.byteLength) invalid();
    if (name === "fmt ") {
      if (formatSeen || length < 16) invalid();
      formatSeen = true;
      if (
        view.getUint16(start, true) !== 1 ||
        view.getUint16(start + 2, true) !== 1 ||
        view.getUint32(start + 4, true) !== 16_000 ||
        view.getUint32(start + 8, true) !== 32_000 ||
        view.getUint16(start + 12, true) !== 2 ||
        view.getUint16(start + 14, true) !== 16
      ) invalid();
    } else if (name === "data") {
      if (dataSeen || !formatSeen || length === 0 || length % 2 !== 0) invalid();
      dataSeen = true;
      dataLength = length;
    }
    position = paddedEnd;
  }
  if (!formatSeen || !dataSeen || position !== bytes.byteLength) invalid();
  const durationSeconds = dataLength / 32_000;
  if (durationSeconds > MAX_SECONDS) throw new AppError(413, "AUDIO_TOO_LONG", "التسجيل يجب ألا يتجاوز 60 ثانية.");
  return { durationSeconds, sampleRate: 16_000, channels: 1 };
}
