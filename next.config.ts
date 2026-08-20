import type { NextConfig } from "next";

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
 * `style-src 'unsafe-inline'` covers Tailwind v4's injected style element and React's inline
 * `style` attributes. `connect-src 'self'` is what the SSE stream and every API call need, and
 * nothing else. `frame-ancestors 'none'` (plus the legacy `X-Frame-Options` below for browsers
 * that predate it) is what stops this app being framed for clickjacking on a real-money product.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

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
   * Applied to EVERY response, including `/reviews` and `/browse` — the two unauthenticated
   * pages, which are exactly the ones a stranger reaches first. `Referrer-Policy` matters here
   * specifically: `/reviews` renders third-party avatar images, and without it the viewer's page
   * url travels to whatever host `users.avatar_url` names.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
