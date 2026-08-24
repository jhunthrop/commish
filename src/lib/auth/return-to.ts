/**
 * The one validator standing between an `?returnTo=` a visitor typed and `getSignInUrl`'s
 * `returnTo`, which the SDK seals into the callback's state and trusts completely once it comes
 * back (`dist/esm/authkit-callback-route.js:76`: `returnPathnameState ?? returnPathnameOption`
 * — the sealed state BEATS the callback's own `"/app"` fallback). The SDK's callback only ever
 * applies `.pathname` and `.search` from this value against OUR OWN request url, so a hostile
 * value could not actually leave our origin today. This validates anyway: a check that leans on
 * a dependency's internal behavior is a check that breaks silently the day that dependency
 * changes, and this is the one function in the product whose job is to be paranoid about it.
 *
 * Fail-closed, on purpose: anything this function does not affirmatively recognize as a plain,
 * same-origin path comes back `null`, never a "best effort" rewrite of the hostile input.
 *
 * The implementation leans on `URL` rather than hand-rolled string matching for the actual
 * decision, because `URL` parses a raw string the same way a browser does — including quietly
 * stripping the tab/newline/carriage-return characters browsers strip before further parsing,
 * which turns a shape as innocent-looking as `"/\t/evil.example"` into a protocol-relative
 * `"//evil.example"` the moment a browser (or `URL`) gets to it. A prefix check alone (`raw.
 * startsWith("/")`) would wave that one through; parsing against a fixed, fake origin and
 * comparing origins is what actually catches it. The leading-slash guard below still runs
 * first, both as the fast, cheap rejection for the common hostile shapes (an absolute URL, a
 * `scheme:` string) and as documentation of what a same-origin path looks like.
 */

/** Any origin at all — its only job is to be a stable comparison point `URL` can resolve
 *  `raw` against. Nothing about this value is meaningful beyond "not the same as raw's origin
 *  after parsing", so it is neither read from config nor derived from a real request. */
const RESOLUTION_ORIGIN = "https://safe-return-to.internal";

/** The auth routes themselves (Task 16 Step 1's third test). Signing in only to be handed
 *  straight back to a sign-in/callback/sign-out route is a loop, never a destination — refused
 *  by exact pathname, not by prefix, so a real product route that merely starts with the same
 *  letters (there are none today, but the check should not assume that stays true) is untouched. */
const AUTH_ROUTE_PATHS: ReadonlySet<string> = new Set(["/sign-in", "/sign-up", "/callback", "/sign-out", "/sign-in/problem"]);

/**
 * `raw` is what a caller read off `?returnTo=` — untrusted, possibly `null`, possibly anything
 * a browser's address bar or a hand-written query string can hold. Returns `raw` UNCHANGED when
 * it is a safe, same-origin path (never a reconstruction from the parsed URL's own parts, which
 * could normalize away something the caller is relying on), and `null` for everything else,
 * including every shape enumerated in this module's own test suite.
 */
export function safeReturnTo(raw: string | null): string | null {
  if (raw === null || raw.trim().length === 0) return null;
  // Anything that is not a plain, single-leading-slash path is refused here without needing the
  // `URL` parse below: an absolute URL ("https://…"), a bare scheme ("javascript:…", "http:/…"),
  // a protocol-relative value ("//…") and a backslash trick ("/\\…") all fail this immediately.
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw, RESOLUTION_ORIGIN);
  } catch {
    return null;
  }
  // The authoritative check: did parsing `raw` against a fixed origin land anywhere else? This is
  // what catches the shapes the prefix guard above cannot see coming, like the control-character
  // stripping browsers perform during URL parsing (`"/\t/evil.example"` parses to a DIFFERENT
  // origin, even though the raw string itself starts with a single "/").
  if (parsed.origin !== RESOLUTION_ORIGIN) return null;

  if (AUTH_ROUTE_PATHS.has(parsed.pathname)) return null;

  return raw;
}
