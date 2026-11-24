import "server-only";

import type { TenantSession } from "@/lib/contracts";
import { consumeRateLimit } from "@/lib/server/rate-limit";

type Operation = "chat" | "transcription" | "speech";

/** Hard request ceilings combine with bounded input/output to cap possible usage.
 * Shared database counters, not process-local state, enforce limits across instances.
 * Reservations intentionally remain consumed on failures and client cancellation.
 */
export async function reserveAIRequest(session: TenantSession, operation: Operation): Promise<void> {
  const scope = `ai:${operation}:${session.tenantId}`;
  await consumeRateLimit(`${scope}:user:${session.userId}:minute`, operation === "chat" ? 10 : 6, 60);
  await consumeRateLimit(`${scope}:tenant:minute`, operation === "chat" ? 30 : 15, 60);
  await consumeRateLimit(`${scope}:user:${session.userId}:day`, operation === "chat" ? 100 : 40, 86_400);
  await consumeRateLimit(`${scope}:tenant:day`, operation === "chat" ? 500 : 150, 86_400);
}
