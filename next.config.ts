import type { NextConfig } from "next";

/**
 * The cross-origin destinations this app's own forms are allowed to reach, and there are two of
 * them because signing out is a THREE-hop redirect chain, not one.
 *
 * `AppHeader`'s Sign out control is a real `<form action="/sign-out" method="post">`, and
 * `signOut()` (`@workos-inc/authkit-nextjs`) answers it with a redirect. Chromium enforces
 * `form-action` across the WHOLE chain, not just the first hop, so a bare `form-action 'self'`
 * blocked it: the local sealed cookie cleared, the IdP session survived, and the next sign-in
 * silently resumed the old identity. A sign-out that does not sign you out.
 *
 * The chain, observed rather than assumed (`e2e/season.spec.ts` walks it):
 *
 *   1. `POST /sign-out`                       — 'self'
 *   2. `https://api.workos.com/.../logout`    — WORKOS_API_ORIGIN, `DEFAULT_HOSTNAME` in
 *                                               `@workos-inc/node`, which nothing here overrides
 *   3. `https://<tenant>.authkit.app/api/logout` — WORKOS_AUTHKIT_DOMAIN, the hosted AuthKit
 *                                               domain, per-environment and therefore a wildcard
 *   4. back to this app's own home            — 'self' again
 *
 * Allowing only the second of those was the first fix and was still not enough; the third hop is
 * where it kept failing. A deployment that puts AuthKit on a CUSTOM domain has to add that
 * domain here too.
 *
 * NOT allowlisted, deliberately: `https://error.workos.com`. Hop 3 lands there instead of hop 4
 * when a WorkOS environment has no app homepage URL configured — a dashboard misconfiguration,
 * not a destination this product ever means to send anyone to, and encoding it here would make
 * the policy quietly bless one.
 */
const WORKOS_API_ORIGIN = "https://api.workos.com";
const WORKOS_AUTHKIT_DOMAIN = "https://*.authkit.app";

/**
 * The Content-Security-Policy this app serves on every response.
 *
 * `img-src 'self' https: data:` is the control this branch actually needed: it introduced three
 * third-party `<img>` sinks (`components/ui/avatar.tsx`, `chat-room/components/message-list.tsx`,
 * `chat-room/components/gif-picker.tsx`) whose sources are a WorkOS CDN url, a Giphy rendition
 * url and a Giphy preview url — none of them hosts this app controls. One `img-src` makes all
 * three safe by construction rather than by three separately hand-written checks, and the
 * `https:` scheme keyword is deliberate: naming the hosts would be a fourth allowlist to keep in
 * sync with the two provider seams, and `parseAvatarRef` plus `chatGifSchema` already enforce
 * https at the two write boundaries.
 *
 * `'unsafe-inline'` in `script-src` is NOT a shortcut, it is what Next 15 requires here: the App
 * Router serves its hydration bootstrap and its flight payload as inline `<script>` elements,
 * and the nonce-based alternative needs the nonce threaded through middleware into every
 * response — a change to the auth middleware this fix wave has no mandate to make. The honest
 * consequence: this CSP does not defend against injected inline script. It defends against
 * everything else in the list, and the product has no `dangerouslySetInnerHTML` anywhere and no
 * XSS sink the whole-branch review could find. A nonce-based `script-src` is Plan D's.
 *
 * `'unsafe-eval'` is added in DEVELOPMENT ONLY. `headers()` applies to `next dev` too, and the
 * dev server's webpack `eval-source-map` devtool serves every module wrapped in `eval()`, which
 * a production-shaped `script-src` refuses — the page boots to a blank screen and a wall of CSP
 * violations. Scoping it to `NODE_ENV === "development"` is the standard Next.js shape for this
 * and keeps the shipped policy free of it; `next build` never sets that value.
 *
 * `style-src 'unsafe-inline'` covers Tailwind v4's injected style element and React's inline
 * `style` attributes. `connect-src 'self'` is what the SSE stream and every API call need, and
 * nothing else. `frame-ancestors 'none'` (plus the legacy `X-Frame-Options` below for browsers
 * that predate it) is what stops this app being framed for clickjacking.
 */
export function contentSecurityPolicy(nodeEnv: string | undefined = process.env.NODE_ENV): string {
  const developmentOnlyScriptSources = nodeEnv === "development" ? " 'unsafe-eval'" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${developmentOnlyScriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${WORKOS_API_ORIGIN} ${WORKOS_AUTHKIT_DOMAIN}`,
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Every security header, in one exported list so `next.config.test.ts` can assert on exactly
 * what `headers()` returns rather than on a hand-copied lookalike that could drift. A weakened
 * policy has to redden that test.
 */
export function securityHeaders(nodeEnv?: string): readonly { readonly key: string; readonly value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(nodeEnv) },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
  ];
}

const nextConfig: NextConfig = {
  // The dev overlay bubble sits exactly where the draft room's dock puts its
  // "you're up in N picks" line; errors still surface in the terminal and console.
  devIndicators: false,
  // A `next dev` process can be running against this same checkout at the same time as an
  // e2e `next build`/`next start` (both default to `.next`); `next dev` keeps writing HMR
  // chunks into it, which corrupts the production build's asset manifest out from under a
  // `next start` that shares the directory. `NEXT_DIST_DIR` (unset by default, so `next dev`
  // is untouched) lets `playwright.config.ts` point its build/start at an isolated `.next-e2e`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  /**
   * The curated coaches file is read from disk at request time (`src/capsules/facts/depth-reads.ts`)
   * by the team page and by the capsule sweep the job tick runs. Nothing imports it, so the
   * serverless bundle's file tracing left it out and production threw ENOENT on both
   * (2026-09-08, /app/teams/DEN). Named for every route rather than the two known readers, so the
   * next surface that reads it does not repeat the outage.
   */
  outputFileTracingIncludes: {
    "/**/*": ["./data/play-callers/**/*"],
  },
  /**
   * Applied to EVERY response, including `/reviews` and `/browse` — the two unauthenticated
   * pages, which are exactly the ones a stranger reaches first. `Referrer-Policy` matters here
   * specifically: `/reviews` renders third-party avatar images, and without it the viewer's page
   * url travels to whatever host `users.avatar_url` names.
   */
  async headers() {
    return [{ source: "/:path*", headers: [...securityHeaders()] }];
  },
};

export default nextConfig;
