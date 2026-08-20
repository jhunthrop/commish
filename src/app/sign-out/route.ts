import { signOut } from "@workos-inc/authkit-nextjs";

/**
 * Ends the WorkOS session and clears the sealed cookie, then redirects home.
 *
 * `returnTo` must be ABSOLUTE. WorkOS's hosted logout endpoint rejects a relative `return_to`
 * and bounces the browser to its own "app homepage url not found" error page instead of back
 * here — a sign-out that ends on a WorkOS error screen. It was `"/"` until the e2e sign-out step
 * followed the whole redirect chain for the first time and watched where it actually landed.
 *
 * Derived from the incoming request's own origin rather than an environment variable, so dev,
 * the e2e build (a different port on purpose, see `playwright.config.ts`) and production each
 * return to themselves with no fourth value to keep in sync.
 */
export async function POST(request: Request) {
  const { origin } = new URL(request.url);
  await signOut({ returnTo: `${origin}/` });
}
