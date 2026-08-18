// Dev-only: creates a real WorkOS test user via the API, authenticates with password,
// and seals the session cookie exactly as authkit-nextjs does — so headless-browser
// screenshots and (later) Playwright e2e can run authenticated without touching auth code.
// Run: dotenv -e .env.local -- tsx scripts/mint-dev-session.ts
import { WorkOS } from "@workos-inc/node";
import { sealData } from "iron-session";

const EMAIL = process.env.LAB_EMAIL ?? `draft-lab+${Date.now()}@example.com`;
const PASSWORD = process.env.LAB_PASSWORD ?? `Lab-${Math.random().toString(36).slice(2)}-${Date.now()}!x`;

async function main() {
  const workos = new WorkOS(process.env.WORKOS_API_KEY!);
  const clientId = process.env.WORKOS_CLIENT_ID!;
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
    { password: process.env.WORKOS_COOKIE_PASSWORD!, ttl: 0 },
  );
  console.log(JSON.stringify({ userId: user.id, email: EMAIL, cookie: sealed }));
}
main().catch((e) => { console.error(e?.rawData ?? e); process.exit(1); });
