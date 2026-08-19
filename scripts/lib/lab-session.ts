// Dev/test-only. Creates a real WorkOS TEST-directory user, authenticates with a password, and
// seals the session exactly as authkit-nextjs does — the one authentication seam the browser
// lab and the e2e suite share. There is deliberately no "dev auth bypass" anywhere in this
// repo: a sealed real session exercises the real middleware, the real callback and the real
// `getCurrentUser()` path, and a bypass would exercise none of them.
import { randomBytes } from "node:crypto";
import { WorkOS } from "@workos-inc/node";
import { sealData } from "iron-session";

/** The cookie authkit-nextjs reads. Named once so the lab and the e2e suite cannot drift. */
export const SESSION_COOKIE_NAME = "wos-session";

const TEST_KEY_PREFIX = "sk_test_";

export interface LabSession {
  readonly userId: string;
  readonly email: string;
  /** A complete bearer credential. Never log it, never print it, never commit it. */
  readonly cookie: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set — run under \`dotenv -e .env.local\`, or set it in the environment.`);
  }
  return value;
}

/**
 * Refuses anything but a WorkOS TEST key: `createUser({ emailVerified: true })` against a
 * production key silently plants a permanent, pre-verified account in the real directory.
 */
export async function mintLabSession(options: { readonly email?: string; readonly password?: string } = {}): Promise<LabSession> {
  const apiKey = requiredEnv("WORKOS_API_KEY");
  if (!apiKey.startsWith(TEST_KEY_PREFIX)) {
    throw new Error(
      `Refusing to run: WORKOS_API_KEY is not a test key (expected a "${TEST_KEY_PREFIX}" prefix). This creates a permanent, pre-verified user in whatever directory the key names.`,
    );
  }
  const clientId = requiredEnv("WORKOS_CLIENT_ID");
  const cookiePassword = requiredEnv("WORKOS_COOKIE_PASSWORD");

  // NOT @example.com: this WorkOS test environment has an SSO connection configured against
  // that domain, so `authenticateWithPassword` fails with `sso_required` for any address on
  // it. `.test` is the RFC 2606 domain reserved for exactly this — never routable, never real.
  const email = options.email ?? `commish-lab+${Date.now()}-${randomBytes(4).toString("hex")}@commish-lab.test`;
  // CSPRNG, not Math.random: this password authenticates a real (test-directory) account.
  const password = options.password ?? `Lab-${randomBytes(24).toString("base64url")}-1!x`;

  const workos = new WorkOS(apiKey);
  const user = await workos.userManagement.createUser({
    email,
    password,
    emailVerified: true,
    firstName: "Commish",
    lastName: "Lab",
  });
  const auth = await workos.userManagement.authenticateWithPassword({ clientId, email, password });
  const cookie = await sealData(
    { accessToken: auth.accessToken, refreshToken: auth.refreshToken, user: auth.user },
    { password: cookiePassword, ttl: 0 },
  );

  return { userId: user.id, email, cookie };
}
