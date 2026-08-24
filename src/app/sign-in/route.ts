import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { safeReturnTo } from "@/lib/auth/return-to";

/**
 * Sends the user to WorkOS's hosted sign-in, carrying the visitor's own intent when there is one
 * worth trusting (`safeReturnTo`, `@/lib/auth/return-to.ts`) — Task 16. `getSignInUrl({ returnTo
 * })` seals it into the callback's state, which BEATS the callback's own `returnPathname: "/app"`
 * fallback once it comes back (`dist/esm/authkit-callback-route.js:76`), so this is the one place
 * a `?returnTo=` a visitor arrived with actually reaches the SDK. An intent that does not pass
 * `safeReturnTo` is dropped, never forwarded as-is — the person still signs in, just without it.
 * Configured as the sign-in endpoint in the WorkOS dashboard.
 */
export async function GET(request: Request) {
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));
  redirect(await getSignInUrl(returnTo === null ? {} : { returnTo }));
}
