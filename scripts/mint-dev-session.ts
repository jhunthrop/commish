// Dev-only: creates a real WorkOS test user via the API, authenticates with password,
// and seals the session cookie exactly as authkit-nextjs does — so headless-browser
// screenshots and (later) Playwright e2e can run authenticated without touching auth code.
// Run: dotenv -e .env.local -- tsx scripts/mint-dev-session.ts [outfile]
//
// The sealed cookie is a complete bearer credential, so it is NEVER printed: it is written to
// a 0600 file (argv[2], else $LAB_SESSION_FILE, else ./.lab-session.json — all gitignored) and
// only the path and the user id go to stdout. The script also refuses to run against anything
// but a WorkOS TEST key, because `createUser({ emailVerified: true })` against a production key
// silently plants a permanent, pre-verified account in the real directory.
import { randomBytes } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { WorkOS } from "@workos-inc/node";
import { sealData } from "iron-session";

const TEST_KEY_PREFIX = "sk_test_";
const DEFAULT_OUT = ".lab-session.json";

const EMAIL = process.env.LAB_EMAIL ?? `draft-lab+${Date.now()}@example.com`;
// CSPRNG, not Math.random: this password authenticates a real (test-directory) account.
const PASSWORD = process.env.LAB_PASSWORD ?? `Lab-${randomBytes(24).toString("base64url")}-1!x`;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set — run under \`dotenv -e .env.local\`.`);
  return value;
}

async function main() {
  const apiKey = requiredEnv("WORKOS_API_KEY");
  if (!apiKey.startsWith(TEST_KEY_PREFIX)) {
    throw new Error(
      `Refusing to run: WORKOS_API_KEY is not a test key (expected a "${TEST_KEY_PREFIX}" prefix). This script creates a permanent, pre-verified user in whatever directory the key names.`,
    );
  }
  const clientId = requiredEnv("WORKOS_CLIENT_ID");
  const cookiePassword = requiredEnv("WORKOS_COOKIE_PASSWORD");
  const outPath = resolve(process.argv[2] ?? process.env.LAB_SESSION_FILE ?? DEFAULT_OUT);

  const workos = new WorkOS(apiKey);
  const user = await workos.userManagement.createUser({
    email: EMAIL,
    password: PASSWORD,
    emailVerified: true,
    firstName: "Draft",
    lastName: "Lab",
  });
  const auth = await workos.userManagement.authenticateWithPassword({
    clientId,
    email: EMAIL,
    password: PASSWORD,
  });
  const sealed = await sealData(
    { accessToken: auth.accessToken, refreshToken: auth.refreshToken, user: auth.user },
    { password: cookiePassword, ttl: 0 },
  );

  writeFileSync(outPath, JSON.stringify({ userId: user.id, email: EMAIL, cookie: sealed }), { mode: 0o600 });
  // `mode` only applies when the file is created; chmod covers an existing, looser file.
  chmodSync(outPath, 0o600);
  console.log(`wrote session for ${user.id} to ${outPath} (mode 0600)`);
}
main().catch((e) => { console.error(e?.rawData ?? e); process.exit(1); });
