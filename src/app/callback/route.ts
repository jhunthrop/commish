import { headers } from "next/headers";
import { handleAuth } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";
import { getDb } from "@research/db/client";
import { syncUserFromWorkOS } from "@/lib/auth/user-sync";
import { firstForwardedFor } from "./forwarded-for";

const systemClock = { now: () => new Date().toISOString() };

/**
 * WorkOS AuthKit redirects here after hosted sign-in/sign-up. AuthKit sets the sealed
 * session cookie; we upsert our local profile row so teams/leagues have an FK target and
 * app-owned fields (experience tier, avatar) exist from the very first sign-in.
 *
 * This is also THE ONE PLACE `next/headers` is read for Task 7's device/IP signals (ruling 9: no
 * client beacon — `User-Agent`, `Accept-Language` and the request address are server-observed,
 * nothing more). They are handed to `syncUserFromWorkOS` through its `Deps.signals`, not read
 * inside `user-sync.ts` itself — that module has no business knowing it is inside a request, and
 * the seam is what lets its own tests fake this without a request at all.
 *
 * `returnPathname: "/app"` stays UNCHANGED (Task 16 Step 2): the sealed state a `?returnTo=` on
 * `/sign-in` produces already BEATS this fallback the moment there is one
 * (`returnPathnameState ?? returnPathnameOption`, `dist/esm/authkit-callback-route.js:76`), so
 * `/app` is exactly the right default for a sign-in with no intent, and churning a working
 * callback to prove this task was here would only make the diff worse.
 *
 * `onError` is the one thing this task adds. A failed callback — a denied consent, a stale or
 * replayed code, a token exchange that failed, `syncUserFromWorkOS` itself throwing — today falls
 * through to whatever AuthKit's own default error response renders. This redirects instead to
 * `/sign-in/problem`, a real page with the product's own chrome (Task 16 Step 4).
 *
 * It does NOT try to recover the visitor's original intent from the failed callback and forward
 * it along as `?returnTo=`. The SDK only unseals `returnPathname` from the PKCE cookie AFTER
 * confirming both `code` and `state` are present and the cookie matches (`getStateFromPKCECookie
 * Value`, called partway through the SDK's own try block) — which is exactly the branch that does
 * NOT run on the most common failures (a denied consent has no `code` at all; a state/cookie
 * mismatch is refused before the cookie is ever read). `onError`'s own signature
 * (`{ error, request }`) never exposes that unsealed value even on the rarer failures where the
 * SDK computed it internally before throwing. Reaching past that signature into the SDK's
 * internal PKCE module to recover it anyway would be exactly the kind of dependency-internals
 * reliance `safeReturnTo`'s own docblock (`@/lib/auth/return-to.ts`) argues against, for a
 * recovery this route cannot make reliable regardless. `/sign-in/problem` still accepts a
 * `returnTo` query param through `safeReturnTo`, so a future caller that DOES hold a real intent
 * can still link there with one — this route simply is not that caller.
 */
export const GET = handleAuth({
  returnPathname: "/app",
  onSuccess: async ({ user }) => {
    const requestHeaders = await headers();
    await syncUserFromWorkOS(
      {
        db: getDb(),
        clock: systemClock,
        via: "callback",
        signals: {
          userAgent: requestHeaders.get("user-agent"),
          acceptLanguage: requestHeaders.get("accept-language"),
          clientIp: firstForwardedFor(requestHeaders.get("x-forwarded-for")),
        },
      },
      user,
    );
  },
  onError: ({ request }) => NextResponse.redirect(new URL("/sign-in/problem", request.url)),
});
