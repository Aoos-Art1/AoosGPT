import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { getPool } from "@/lib/server/db";

const databaseGlobal = globalThis as unknown as { aoosPool?: Pool };

beforeEach(() => {
  // Pool construction is lazy; this test never attempts a network connection.
  vi.stubEnv("DATABASE_URL", "postgresql://aoos_runtime:synthetic-test-password-only@127.0.0.1:1/unused");
  delete databaseGlobal.aoosPool;
});

afterEach(async () => {
  await databaseGlobal.aoosPool?.end();
  delete databaseGlobal.aoosPool;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("database pool background failures", () => {
  it("handles idle errors without crashing or logging the Error, client or credentials", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const pool = getPool();
    expect(getPool()).toBe(pool);
    expect(pool.listenerCount("error")).toBe(1);
    const credentials = "synthetic-sensitive-value";
    const error = Object.assign(new Error(`Connection failed with ${credentials}`), {
      code: "ECONNRESET", connectionString: `postgresql://user:${credentials}@example.test/db`,
    });
    const client = { connectionParameters: { password: credentials }, secret: credentials };
    expect(() => pool.emit("error", error, client)).not.toThrow();
    expect(log.mock.calls).toEqual([["DATABASE_POOL_IDLE_ERROR"]]);
    expect(JSON.stringify(log.mock.calls)).not.toContain(credentials);
  });
});
