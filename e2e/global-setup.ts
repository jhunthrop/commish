import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type FullConfig } from "@playwright/test";
import { mintLabSession, SESSION_COOKIE_NAME } from "../scripts/lib/lab-session";

export const AUTH_DIR = resolve(process.cwd(), "e2e/.auth");
export const MANAGER_A_STATE = resolve(AUTH_DIR, "manager-a.json");
export const MANAGER_B_STATE = resolve(AUTH_DIR, "manager-b.json");

function storageState(baseURL: string, cookie: string): string {
  const { hostname } = new URL(baseURL);
  return JSON.stringify({
    cookies: [
      {
        name: SESSION_COOKIE_NAME,
        value: cookie,
        domain: hostname,
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
      },
    ],
    origins: [],
  });
}

/**
 * Two real managers, one seeded season, no bypass.
 *
 * The order matters and each step earns its place:
 *
 * 1. **Mint** two WorkOS test-directory sessions. This throws with a named variable if the
 *    WorkOS test credentials are absent — a loud stop, never a silently skipped suite.
 * 2. **Warm** each session by loading `/app` once. That is what makes `getCurrentUser()` write
 *    the local `users` row, and step 3 has a foreign key onto it. Doing it through the real
 *    page rather than a direct insert is the whole point: if identity sync is broken, the e2e
 *    suite should fail here rather than paper over it.
 * 3. **Seed** with manager A's id as `DEV_SEED_CLAIM_USER_ID`, so A owns team 1 and the
 *    commissioner's chair in the seeded season league and can actually score a week.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3100";

  const [a, b] = await Promise.all([mintLabSession(), mintLabSession()]);

  mkdirSync(AUTH_DIR, { recursive: true });
  // Bearer credentials on disk: same 0600 treatment the mint script gives its own output.
  writeFileSync(MANAGER_A_STATE, storageState(baseURL, a.cookie), { mode: 0o600 });
  writeFileSync(MANAGER_B_STATE, storageState(baseURL, b.cookie), { mode: 0o600 });

  const browser = await chromium.launch();
  try {
    for (const state of [MANAGER_A_STATE, MANAGER_B_STATE]) {
      const context = await browser.newContext({ storageState: state, baseURL });
      const page = await context.newPage();
      const response = await page.goto("/app", { waitUntil: "domcontentloaded" });
      if (response === null || response.status() >= 400) {
        throw new Error(`Session warm-up failed for ${state}: /app answered ${response?.status() ?? "no response"}.`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  // `-v` rather than an inherited env var: `npm run seed` runs under `dotenv -e .env.local`,
  // and `.env.local` sets DEV_SEED_CLAIM_USER_ID itself. `-v` is the spelling this repo
  // already uses for exactly this override (see the `db:migrate:test` script).
  execFileSync(
    "npx",
    ["dotenv", "-e", ".env.local", "-v", `DEV_SEED_CLAIM_USER_ID=${a.userId}`, "--", "tsx", "src/data/seed/index.ts"],
    { stdio: "inherit", cwd: resolve(AUTH_DIR, "../..") },
  );
}
