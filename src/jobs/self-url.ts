import type { EnvRecord } from "./tick-auth";

const present = (value: string | undefined): value is string => value !== undefined && value !== "";

/**
 * Where this deployment reaches ITSELF for a self-wake (`self-wake.ts`, draft-room performance
 * round, item 3). `JOBS_SELF_URL` wins when set (a local `next start` on a chosen port, a
 * tunnel); on Vercel the production alias is the one origin with no deployment protection in
 * front of it, so production uses the project's production URL and any other environment its
 * own deployment URL (a protected preview refuses the wake and falls back to the cron, which is
 * the honest degradation); locally, the dev port.
 */
export function selfOrigin(env: EnvRecord = process.env): string {
  if (present(env.JOBS_SELF_URL)) return env.JOBS_SELF_URL.replace(/\/+$/, "");
  if (env.VERCEL_ENV === "production" && present(env.VERCEL_PROJECT_PRODUCTION_URL)) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (present(env.VERCEL_URL)) return `https://${env.VERCEL_URL}`;
  return `http://localhost:${present(env.PORT) ? env.PORT : "3000"}`;
}
