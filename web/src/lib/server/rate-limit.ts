import "server-only";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { withTransaction } from "./db";
import { AppError } from "./http";

export async function consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  if (!key || key.length > 300 || !Number.isSafeInteger(limit) || limit < 1
    || !Number.isSafeInteger(windowSeconds) || windowSeconds < 1) throw new Error("Invalid rate-limit configuration");
  // Commit the counter even for rejected requests. Throwing within the
  // transaction would roll back the very limit we are trying to enforce.
  const result = await withTransaction(async (client) => {
    const res = await client.query<{ hits: number; retry_after: number }>(`
      INSERT INTO rate_limits (key, hits, window_started_at) VALUES ($1, 1, now())
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE WHEN rate_limits.window_started_at <= now() - ($3 * interval '1 second')
          THEN 1 ELSE LEAST(rate_limits.hits + 1, $2 + 1) END,
        window_started_at = CASE WHEN rate_limits.window_started_at <= now() - ($3 * interval '1 second')
          THEN now() ELSE rate_limits.window_started_at END
      RETURNING hits, GREATEST(1, CEIL(EXTRACT(EPOCH FROM
        window_started_at + ($3 * interval '1 second') - now())))::int AS retry_after`,
    [key, limit, windowSeconds]);
    return res.rows[0];
  });
  if (result.hits > limit) throw new AppError(429, "RATE_LIMITED", "محاولات كثيرة خلال وقت قصير. انتظر قليلًا ثم أعد المحاولة.", result.retry_after);
}

export function rateLimitIdentity(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function requestSourceKey(request: Request): string {
  // The private app accepts exactly one IP from an ingress which OVERWRITES
  // this dedicated header. Next.js can synthesize X-Forwarded-For from its own
  // socket, so that standard header cannot establish trusted proxy traversal.
  const candidate = process.env.TRUST_PROXY_HEADERS === "true"
    ? request.headers.get("x-aoos-client-ip")?.trim()
    : undefined;
  const family = candidate && candidate.length <= 45 && !candidate.includes(",") && !candidate.includes("%")
    ? isIP(candidate) : 0;
  if (!candidate || !family) {
    if (process.env.NODE_ENV === "production") {
      throw new AppError(503, "PROXY_CONFIGURATION_REQUIRED", "إعداد حماية تسجيل الدخول غير مكتمل. تواصل مع مسؤول المنصة.");
    }
    return rateLimitIdentity("unavailable");
  }
  // Canonical IPv6 spelling prevents alternate equivalent forms from creating
  // distinct buckets. The address has already passed node:net validation.
  const address = family === 6 ? new URL(`http://[${candidate}]/`).hostname.slice(1, -1) : candidate;
  return rateLimitIdentity(address);
}
