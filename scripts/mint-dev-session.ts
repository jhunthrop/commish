// Dev-only: creates a real WorkOS test user via the API, authenticates with password,
// and seals the session cookie exactly as authkit-nextjs does — so headless-browser
// screenshots and Playwright e2e can run authenticated without touching auth code.
// Run: dotenv -e .env.local -- tsx scripts/mint-dev-session.ts [outfile]
//
// The sealed cookie is a complete bearer credential, so it is NEVER printed: it is written to
// a 0600 file (argv[2], else $LAB_SESSION_FILE, else ./.lab-session.json — all gitignored) and
// only the path and the user id go to stdout. `mintLabSession` also refuses to run against
// anything but a WorkOS TEST key, because `createUser({ emailVerified: true })` against a
// production key silently plants a permanent, pre-verified account in the real directory.
import { chmodSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { envOrUndefined } from "@research/lib/env";
import { mintLabSession } from "./lib/lab-session";

const DEFAULT_OUT = ".lab-session.json";

async function main() {
  // `envOrUndefined`, not `??`: `.env.example` ships `LAB_SESSION_FILE=`/`LAB_EMAIL=`/
  // `LAB_PASSWORD=` as intentionally empty lines, which `??` alone would not treat as absent —
  // see `src/lib/env.ts`.
  const outPath = resolve(process.argv[2] ?? envOrUndefined("LAB_SESSION_FILE") ?? DEFAULT_OUT);
  const session = await mintLabSession({ email: envOrUndefined("LAB_EMAIL"), password: envOrUndefined("LAB_PASSWORD") });
  // The sealed cookie is a complete bearer credential, so it is NEVER printed: it goes to a
  // 0600 file (argv[2], else $LAB_SESSION_FILE, else ./.lab-session.json — all gitignored) and
  // only the path and the user id reach stdout.
  writeFileSync(outPath, JSON.stringify(session), { mode: 0o600 });
  // `mode` only applies when the file is created; chmod covers an existing, looser file.
  chmodSync(outPath, 0o600);
  console.log(`wrote session for ${session.userId} to ${outPath} (mode 0600)`);
}
main().catch((e) => { console.error(e?.rawData ?? e); process.exit(1); });
