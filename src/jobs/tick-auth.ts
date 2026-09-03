// THE TICK ROUTE'S GATE — bearer-token auth for the machine endpoint Vercel Cron calls. No
// session, no cookie: one shared secret in env, compared in constant time.
import { createHash, timingSafeEqual } from "node:crypto";

/** A plain env record, NOT `NodeJS.ProcessEnv`: Next augments ProcessEnv with a required
 *  `NODE_ENV`, which would force every test to fake one. `process.env` still assigns. */
export type EnvRecord = Readonly<Record<string, string | undefined>>;

/**
 * Startup validation for the Vercel path: the tick route calls this before touching anything
 * else, so a deployment missing `CRON_SECRET` refuses EVERY request loudly (500, logged) rather
 * than ever running unauthenticated. Never read anywhere else; never interpolated into an error.
 */
export function cronSecretFromEnv(env: EnvRecord = process.env): string {
  const secret = env.CRON_SECRET;
  if (secret === undefined || secret.length === 0) {
    throw new Error("CRON_SECRET is not set. The job tick route refuses to run unauthenticated.");
  }
  return secret;
}

/**
 * `Authorization: Bearer <CRON_SECRET>` (the header shape Vercel Cron sends when the project sets
 * `CRON_SECRET`), compared via `timingSafeEqual` over SHA-256 digests: hashing first gives both
 * sides one fixed length, so neither the comparison nor a length mismatch leaks how much of the
 * secret a probe got right.
 */
export function isAuthorizedTick(authorizationHeader: string | null, secret: string): boolean {
  if (authorizationHeader === null) return false;
  const match = /^Bearer (.+)$/.exec(authorizationHeader);
  if (match === null) return false;
  const presented = createHash("sha256").update(match[1]!).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(presented, expected);
}
