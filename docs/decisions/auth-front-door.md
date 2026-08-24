# Decision: the auth front door

**Date:** 2026-08-24 · **Phase 3.6, whole-site addendum (Task 22 Step 3)** · Spec: `.superpowers/sdd/2026-08-23-phase3p6-addendum-whole-site/`

## Why there is no sign-in page, and never will be

Commish has no credential form, anywhere, and this is a standing rule, not a gap (A1, addendum
ruling 28). The constraint is not the SDK — it is that a credential form we own is a credential
form we are responsible for, forever, in a product that is about to take money. Staying out
keeps everything AuthKit already does (MFA, OAuth, password reset, breach detection, bot
defense) without us re-implementing any of it, and costs exactly one thing: the hosted screen
is not our pixels. The dashboard runbook at the bottom of this doc is how we get most of the
pixels back, in the dashboard, where that decision belongs.

What "sign in" is instead, in this product: **an entry point, an intent, and an arrival** —
never a form. `SignInLink` renders the entry point, `?returnTo=` carries the intent,
`/callback` is the arrival, and everything between them is WorkOS's hosted screen.

## The code-side levers the installed SDK exposes

The complete list, each read from the file and line that actually pulls it. Nothing else in
`src` imports `@workos-inc/authkit-nextjs` for identity — `getCurrentUser()` /
`requireCurrentUser()` (`src/lib/auth/current-user.ts`) is the one server-side identity seam.

| Lever | Where it is pulled | What it does for us |
|---|---|---|
| `getSignInUrl({ returnTo? })` | `src/app/sign-in/route.ts:16` | Builds the hosted sign-in URL; a validated `returnTo` is sealed into the OAuth `state`. |
| `getSignUpUrl({ returnTo? })` | `src/app/sign-up/route.ts:12` | The identical shape over the sign-up screen hint. |
| `handleAuth({ returnPathname, onSuccess, onError })` | `src/app/callback/route.ts:46-64` | The arrival. `returnPathname: "/app"` is the no-intent fallback (line 47); `onSuccess` upserts our local profile row via `syncUserFromWorkOS` (lines 48-63); `onError` redirects every failed callback to `/sign-in/problem` (line 64), never a raw SDK error page. |
| `signOut({ returnTo })` | `src/app/sign-out/route.ts:15-17` | Ends the session. `returnTo` must be **absolute** (the hosted logout endpoint rejects a relative value — that route's docblock, lines 6-13, records how this was learned); derived from the request's own origin, never an env var. |
| `authkit(request)` + `handleAuthkitProxy` | `src/middleware.ts:37-43` | The session middleware on every non-static request. Pages under `/app` redirect to hosted sign-in via `authorizationUrl`; API/SSE routes never redirect — they return JSON 401s themselves. The single page exemption is `/app/join/[code]` (`PUBLIC_APP_PAGES`, `src/middleware.ts:21`), anchored, one segment, GET only. |
| `SignInLink` | `src/components/app-shell/sign-in-link.tsx:24-31` | THE one way any surface renders "sign in" (F6). Builds `/sign-in?returnTo=<encoded intent>` or plain `/sign-in`; six hand-written links and three copy-pasted headers died at its birth. |
| `fetchWithSessionWatch` / `SESSION_LOST_EVENT` / `onSessionLost` | `src/components/app-shell/session-watch.ts:46, :15, :57` | Not an SDK lever — our one seam over the SDK's 401s. Wraps `fetch` once; on a 401 carrying our own `{ ok: false }` envelope it emits `SESSION_LOST_EVENT` with `{ write }` (line 50) and hands the response back unchanged. All five rooms' `deps.tsx` `fetchJson` are one-line delegates to it. |
| `SessionNotice` | `src/components/app-shell/session-notice.tsx:41-88` | The consumer of the seam, placed by chrome (F13): `TopBar` renders it under `AppShell`, `RoomRail` renders `variant="room"` beside `ConnectionBanner`, `PublicBar` never. |

## State beats option, with its source line

`getSignInUrl({ returnTo })` seals the intent into the callback's OAuth `state`, and the SDK's
callback prefers that sealed value over the route's own `returnPathname` option:
`returnPathnameState ?? returnPathnameOption` — `dist/esm/authkit-callback-route.js:76` in the
installed package, quoted in both `src/lib/auth/return-to.ts:3-5` and
`src/app/callback/route.ts:21-25` so the next reader does not have to go find it. This fact is
why `callback/route.ts` keeps `returnPathname: "/app"` untouched: `/app` is exactly right for a
sign-in with no intent, and the sealed state wins the moment there is one.

## `safeReturnTo`: the refusal list, and why it is paranoid about a solved problem

`safeReturnTo` (`src/lib/auth/return-to.ts:43-65`) is the only validator between a `?returnTo=`
a visitor typed and `getSignInUrl`. It is fail-closed: anything not affirmatively recognized as
a plain same-origin path returns `null`, never a best-effort rewrite.

Refused, each enumerated as a test in `return-to.test.ts`: protocol-relative (`//evil.example`),
absolute URLs (`https://evil.example/x`), bare schemes (`javascript:alert(1)`, `http:/evil`),
the backslash trick (`/\evil.example`), the control-character bypass (`"/\t/evil.example"` —
browsers and `URL` strip tab/CR/LF during parsing, so a naive `startsWith("/")` waves it
through; the real check is origin equality after parsing against a fixed origin,
`return-to.ts:52-60`), empty and null, and the auth routes themselves (`AUTH_ROUTE_PATHS`,
`return-to.ts:34` — a loop is not a destination).

Why validate at all, when the SDK already prevents the open redirect? The SDK's callback only
ever applies `.pathname` and `.search` of the sealed value to our own request URL, so
`//evil.example` cannot leave our origin today (addendum ruling 29). We refuse it anyway,
because the alternative is a security property that lives in a dependency's implementation
detail and breaks silently on upgrade. The counter-risk — the validator itself becoming the bug
— is why it is thirty lines with a refusal list rather than a URL parser of our own.

One recorded exemption: `SessionNotice` passes `usePathname()` to `SignInLink` unvalidated
(`session-notice.tsx:49-54`) — the router's own current-path state has no foreign origin to
smuggle. The comment at that line forbids copying the exemption to any caller whose intent
comes from anywhere else.

## The session-expiry escalation rule

Escalation is by **what failed, not by what died** (addendum ruling 32). The discriminator is
`SessionLostDetail.write` (`session-watch.ts:18-23`): anything but a GET is a write.

- A **background read**'s 401 (the notices poll, a score refresh) renders the quiet strip: "You
  are signed out. Sign in to pick up where you left off." No focus steal, no interruption.
- A **user-initiated write**'s 401 escalates to a `Modal` (`session-notice.tsx:56-64`), because
  the person just pressed something and it did not happen. The one sentence it is allowed about
  state is the true one: "Nothing you typed was sent." Never "saved", never a guess. Closing
  the modal returns to the strip — the session is still gone and the component does not
  un-know it.

This is wrong only if strips are missed so often that people keep working into a dead session —
which the escalation is designed to catch at their next write.

## The WorkOS dashboard runbook

Everything below is a **dashboard** operation, not code (D18: the hosted screen is not
code-configurable in the installed SDK, and a settings file in this repo that changes nothing
would be a lie). Each step is performed and verified in the live dashboard.

> **Control names are to be read off the dashboard, not trusted from this document.** WorkOS
> renames and moves dashboard controls between visits; the *intent* of each step below is
> stable, the label is whatever the dashboard says today. Verify each step by running the real
> flow (`/sign-in` from the product) after saving it.

1. **Branding — logo.** Upload the Commish wordmark in the AuthKit branding section. Verify:
   the hosted screen shows our mark, not the WorkOS default.
2. **Branding — colors.** Set the brand/button color to the product accent and the page
   background to `#0B0C0F` (the v2 dark surface token, `src/design/tokens.ts`). Verify: the
   hosted screen's background is visually continuous with the product's own dark chrome when
   clicked into from the front door.
3. **Branding — appearance.** Select the dark appearance so the hosted screen matches the
   flagship theme. (The hosted screen has one appearance; dark is the flagship ruling. A
   visitor in light theme crosses a dark screen and returns — accepted.)
4. **Authentication methods.** Enable exactly the methods the front door promises — "Sign in
   with email. That is the whole signup." — email plus whichever OAuth providers the founder
   wants live. Disable anything that would put a method on the hosted screen the product's own
   copy never mentions. Verify: the hosted screen's method list matches the promise.
5. **Redirect URI.** Register the callback for each environment: `http://localhost:3000/callback`
   (dev), and the production origin's `/callback` when it exists. The e2e/dev walk of this
   closeout observed the dev value live in the outgoing `redirect_uri`. Verify: a full
   round-trip lands on `/callback` and then the intent (or `/app`).
6. **Sign-in endpoint.** Point the app's sign-in endpoint at our `/sign-in` route —
   `src/app/sign-in/route.ts:12`'s docblock records that this route is the configured endpoint.
   This is what makes every WorkOS-initiated sign-in (e.g. after sign-out) flow through
   `safeReturnTo` rather than around it.
7. **App homepage URL.** Must be set so hosted logout can return; `sign-out/route.ts` passes an
   absolute `returnTo` for the same reason (that route's docblock records the failure shape:
   a relative value ends sign-out on a WorkOS error screen).
8. **Custom auth domain — `auth.commish.ly` — FOUNDER-GATED.** Needs DNS control and the plan
   tier that includes it (addendum controller ruling 3). Until the founder acts, the hosted
   screen lives on the WorkOS domain; the first-timer walk (A16 Step 7) confirmed our own
   chrome never says "WorkOS", so the domain is the one remaining place the seam shows.

## What this doc deliberately does not cover

Session storage, token refresh, MFA enrolment flows, breach detection — all WorkOS-side, none
surfaced in-product yet. The account-operations gaps a persona hit (change email, sessions,
sign-out-everywhere, deletion, MFA visibility) are backlog rows 2, 4, 5 and 6 in
`docs/research/2026-08-23-backend-gaps-backlog.md`, not silent omissions.
