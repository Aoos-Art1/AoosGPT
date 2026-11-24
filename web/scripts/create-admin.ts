import { existsSync } from "node:fs";
import { emitKeypressEvents } from "node:readline";
import { Client } from "pg";
import { hashPassword, validPasswordLength } from "../src/lib/server/password";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

class SetupError extends Error {}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function hiddenPassword(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) throw new SetupError("Use an interactive terminal or explicitly pass --password-stdin. Never pass a password as a command argument.");
  process.stdout.write(prompt);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      process.stdin.off("keypress", listener);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error); else resolve(value);
    };
    const listener = (text: string | undefined, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && ["c", "d"].includes(key.name || "")) return finish(new SetupError("Cancelled."));
      if (key.name === "return" || key.name === "enter") return finish();
      if (key.name === "backspace") { value = Array.from(value).slice(0, -1).join(""); return; }
      if (text && !key.ctrl && !/[\r\n\u0000-\u001f]/.test(text)) {
        value += text;
        if (Buffer.byteLength(value) > 512) finish(new SetupError("Password is too long."));
      }
    };
    process.stdin.on("keypress", listener);
  });
}

async function readPassword(): Promise<string> {
  if (process.argv.includes("--password-stdin")) {
    let value = "";
    for await (const chunk of process.stdin) {
      value += chunk.toString();
      if (Buffer.byteLength(value) > 1024) throw new SetupError("Password input is too long.");
    }
    return value.replace(/\r?\n$/, "");
  }
  const password = await hiddenPassword("New administrator password (hidden): ");
  const confirmation = await hiddenPassword("Confirm password (hidden): ");
  if (password !== confirmation) throw new SetupError("The passwords do not match.");
  return password;
}

async function main() {
  const email = option("--email")?.trim().toLowerCase();
  const displayName = option("--name")?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254
    || !displayName || displayName.length > 120 || /[\u0000-\u001f\u007f]/.test(displayName)) {
    throw new SetupError("Usage: npm run admin:create -- --email you@example.com --name 'Your name' [--password-stdin]");
  }
  if (process.argv.some((argument) => argument === "--password" || argument.startsWith("--password="))) {
    throw new SetupError("Do not pass passwords in command arguments. Use the hidden prompt or --password-stdin.");
  }
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  if (!connectionString) throw new SetupError("Set MIGRATION_DATABASE_URL and run db:migrate first.");
  const password = await readPassword();
  if (!validPasswordLength(password) || /[\r\n\0]/.test(password)) throw new SetupError("Choose a password with 15–128 characters and no line breaks.");
  const passwordHash = await hashPassword(password);
  const client = new Client({ connectionString, application_name: "aoosgpt-admin-bootstrap" });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(731272542)");
    const exists = await client.query("SELECT 1 FROM users WHERE platform_role = 'super_admin' LIMIT 1");
    if (exists.rowCount) throw new SetupError("A platform administrator already exists. This bootstrap command is one-time only.");
    const duplicate = await client.query("SELECT 1 FROM users WHERE email = $1", [email]);
    if (duplicate.rowCount) throw new SetupError("That email already belongs to an account; bootstrap never silently promotes existing users.");
    const result = await client.query<{ id: string }>(`INSERT INTO users (email, display_name, password_hash, platform_role)
      VALUES ($1, $2, $3, 'super_admin') RETURNING id`, [email, displayName, passwordHash]);
    await client.query(`INSERT INTO audit_events (actor_user_id, action, target_type, target_id, metadata)
      VALUES ($1, 'platform.admin_bootstrapped', 'user', $1, '{"source":"local-cli"}'::jsonb)`, [result.rows[0].id]);
    await client.query("COMMIT");
    console.log("تم إنشاء مدير المنصة. سجّل الدخول من /login/admin.");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { await client.end(); }
}

main().catch((error: unknown) => {
  console.error(error instanceof SetupError ? error.message : "Administrator bootstrap failed. Check migration setup and database access; no credentials were printed.");
  process.exitCode = 1;
});
