# Link-integrity audit, 2026-09-04

Founder report: "we have numerous links across the apps that don't work - for example, the
invite link doesn't work from a created league page." Context: six major surface rebuilds in
the previous 48 hours (front door, league room, mock drafts, league rail, quilt roster, plus
page deletions), each of which could strand hrefs pointing at moved or retired routes and
anchors. This audit ran in two layers - a static source sweep that is now a permanent gate,
and a dynamic crawl plus explicit flow probes against a live dev server - and fixed what it
found. Branch: `worktree-link-audit` (not merged).

## Priority zero: the invite link from a created league page

**Root cause.** `WaitingRoom`'s "Invite someone" links (two of them: the filling hero and
`RoomRoster`) target `/app/leagues/[leagueId]#invite-managers`. That anchor's only home was
inside `RoomShell`'s rail - an `<aside>` styled `hidden ... xl:flex`, i.e. rendered but
`display:none` below 1280px. Below that width the click changed the hash and nothing else: the
browser had nothing visible to scroll to, and the `InvitePanel` (the only place a commissioner
can mint the invite URL) was unreachable entirely. This is the same defect class as the
previously fixed `/app#create-league` fragment (a hash nothing answers), with a CSS twist.

**Why no test caught it.** The e2e suite's Desktop Chrome viewport is exactly 1280 wide - the
one width at which the rail is just barely on screen - so `league-lifecycle.spec.ts` drove the
whole invite chain successfully forever.

**The chain, verified end to end (live, dev server).** `InvitePanel` -> `POST
/api/leagues/[leagueId]/invites` mints `{ code, path: /app/join/CODE, url: origin+path }` ->
`/app/join/[code]` is served by `src/app/app/(public)/join/[code]/page.tsx` (route group adds
no segment) -> `middleware.ts` exempts exactly `GET /app/join/<one-segment>` from the auth
redirect -> signed out, the landing renders the league terms with a sign-in verb riding the
invite's own intent; signed in, `JoinForm` posts `/api/invites/[code]/accept` and pushes to
the league. Every step of that was healthy; only the door to the panel was broken.

**Fix** (`cb0f6a3`): `useRailVisible` (SSR-safe matchMedia-after-mount, the
`usePrefersReducedMotion` idiom, one constant `RAIL_QUERY` = min-width 1280px) decides where
the ONE `#invite-managers` block mounts: the rail at xl, inline under the waiting stage below
it - never both, so the id stays unique and the native anchor jump always lands on a visible
element. A load arriving with the fragment gets a `scrollIntoView` once the right instance
mounts (the `StartOrJoinDisclosure` idiom). Regression tests: component
(`room-shell.test.tsx`: anchor placement per breakpoint, uniqueness, non-commissioner) and
route-level e2e (`e2e/invite-anchor.spec.ts`: the full chain at 1200px wide, including the
minted URL landing for a signed-out stranger).

## Layer 1 - the static sweep (permanent gate)

`src/integrity/link-integrity.source.test.ts` (`5b05bc5`). Inventories and checks, every run:

| Inventory | Count |
| --- | --- |
| Source files swept (src/**, .ts + .tsx, tests excluded) | 872 |
| Routes served (page.tsx + route.ts, groups dropped) | 97 (34 pages, 63 API) |
| Literal anchor ids (id= and anchorId=) | 18 |
| Unique link targets extracted | 256 |
| - internal absolute paths | 241 |
| - fragment-only hrefs | 5 |
| - other (prose-shaped, skipped by filters) | 10 |

Extraction: `href=`/`intent=` attributes, `router.push/replace/prefetch`, `redirect()`,
`pushState()` third arguments, PLUS every bare absolute-path literal (catches hrefs built in
plain returns - `action-href.ts`, contract `path` fields). Template segments that are one
whole `${...}` normalize to a wildcard and match dynamic route segments. Fragments are
validated against the id pool. Unresolvable targets must carry a `MANUAL_AUDIT` entry with a
reason; allowlist entries that stop occurring in source fail the sweep.

Broken, by category (all resolved):

1. **Fragment link with a lost anchor (1, fixed).** `/app/profile#notifications-heading`
   (waiting-room checklist "See what you will hear about"). The anchor's original home was
   `NotificationSummary`'s hand-rolled section heading; the Task 18 retone onto `Panel`
   dropped the id without moving it, so the link opened the profile at the top pointing at
   nothing. Restored as a wrapper id on the profile page (the `#invite-managers` idiom).
   Verified landing in-view in the live probe.
2. **Anchor declared through a prop (1, extractor taught).** `#trades-to-answer` is real at
   runtime - `TradeInbox` renders `<section id={anchorId}>` from `anchorId="trades-to-answer"`
   at the call site. `anchorId=` now counts as an id declaration.
3. **Route-prefix guards misread as links (2, allowlisted with reasons).**
   `admin-console-nav.tsx` `/app/admin` (a startsWith render guard) and `rail-nav.tsx`
   `/app/drafts` (an active-state prefix in `also`) - prefixes over served subtrees, never
   hrefs.
4. **External API path suffixes (2 files, allowlisted with reasons).**
   `src/stats/tank01/config.ts` and `src/projections/odds/snapshot.ts` join their literals
   onto vendor base URLs.
5. **Manual-audit entries (4, each hand-verified).** `room-shell.tsx`'s drawer pushState
   (`${base}/${next.surface}` - every surface is a served sub-route), the wallet's two
   same-file anchor constants, and `term-link.tsx`'s `#term-${term}` (both sides template the
   same GLOSSARY keys).

Every other one of the 241 internal targets resolves to a served route or public file. There
are no `next.config.ts` / `vercel.json` redirects to add to the inventory.

## Layer 2 - the dynamic crawl and flow probes

`scripts/link-crawl.ts` (keeper dev tool, documented header): BFS from `/` and `/app`,
same-origin, cap 150 pages, records HTTP status, the app's own not-found panel, console
errors, and dead fragment clicks (click with no navigation, no DOM mutation, no scroll -
flagged for judgment, not auto-failed).

- **Signed-in crawl** (lab session, 1440px): 17 pages reachable from the lab user's world,
  all 200, no not-found panels. Findings: (a) a dead-fragment flag on `/app`'s checklist link
  that a manual probe showed to be a dev-mode timing artifact - the click navigates and lands
  the target in view (fix verified); (b) a React "unique key" console error on `/browse`
  (judgment item 2 below).
- **Signed-out crawl** (public surface): 12 pages, all public routes 200. `/app` hands the
  visitor to WorkOS sign-in (the middleware doing its job; the crawl records the external
  hop as a non-200). The `/browse` "start your own league" click logs a dev-only "Failed to
  fetch RSC payload for /app#create-league. Falling back to browser navigation" - the
  fallback IS the navigation, and it lands on hosted sign-in exactly as the code comments
  promise; not a defect. CSP report-only warnings are WorkOS environmental noise.
- **Explicit flow probes** (all passing after fixes):
  - Invite chain at 1440 AND 1200px (priority zero, above).
  - Mock drafts: "Mint a link" -> draft room -> share panel -> the share link opens for a
    second page. **Found and fixed here:** the panel rendered `MockShareInfo.path` - a bare
    `/app/mock-drafts/CODE` - as the copyable "Share link", the exact C-01 defect the invite
    panel fixed on 2026-08-27. The snapshot route now mints `url` from the request origin
    (`originFor` extracted to `@/lib/api/origin` on gaining its second consumer) and the panel
    shows it (`6e07fbe`). Verified live: `http://localhost:3210/app/mock-drafts/GY4NPUP7`.
  - Debrief: "Full debrief" links to `/app/drafts/[draftId]` (served; statically verified);
    RUN IT BACK / open-lobby are covered end to end by `e2e/mock-draft.spec.ts` (solo mock ->
    results -> run it back), which also now asserts the share link's absolute form.
  - League room drawer deep links `/app/leagues/[id]/{players,standings,trades,activity}`:
    all 200, no not-found panel. Drawer chip/URL/back behavior is covered by
    `room-shell.test.tsx` (routeSync, space//, esc) and the existing room-journey e2e specs.
  - Rail: rows land on their league; the "+" (`/app#create-league`) opens the create
    disclosure in view (the previously fixed hashchange listener holds).
  - Front door signed out: row -> join sheet -> the verb is `SignInLink` riding intent
    `/join/[leagueId]/hold`; the hold page renders signed out, claims the 10-minute hold, and
    puts sign-in on it.
  - Wallet: 200; the `#wallet-deposit`/`#wallet-identity` controls are absent while money is
    dark (their anchors verified in source).
  - Admin (lab user granted admin in dev db for the probe, revoked after): all seven console
    pages 200 with the console nav's seven links present and correct.
  - Footer/public pages: `/legal/terms`, `/legal/privacy`, `/support`, `/league-rules`
    ("How it works"), `/reviews`, `/browse` all 200 in the crawl.

## Fixes and commits

| Commit | Fix |
| --- | --- |
| `cb0f6a3` | Invite anchor mounts where the viewport can see it (`useRailVisible`); component + 1200px e2e regression tests |
| `5b05bc5` | The link-integrity source sweep (permanent gate) + the profile `#notifications-heading` anchor restored |
| `6e07fbe` | Mock share panel shows an absolute URL (C-01 parity); `originFor` extracted to `@/lib/api/origin` |

## Judgment items (need a real design decision - not invented here)

1. **The rail below xl.** Chat, the terms panel, the members panel and the moderation summary
   are all unreachable below 1280px - the whole `<aside>` is `hidden` there. Only the invite
   panel got a below-xl home in this audit, because links target it by name. Whether the rest
   of the rail deserves a sub-xl surface (a drawer? a tab? nothing?) is a product/design call.
2. **`/browse` React key warning (dev only).** "Each child in a list should have a unique key
   prop... Check the render method of OpenLeagueShelf. It was passed a child from BrowsePage."
   Bisected to the server-minted `intro` prop crossing the RSC boundary into the client shelf;
   keying the `<p>`'s children did NOT silence it, and even a single-child intro still warns,
   so this looks like a React/Next dev-mode quirk about RSC-deserialized prop elements rather
   than a fixable authoring defect. No user-facing effect; production builds strip the check.
   Left unfixed rather than papering over it.
3. **Post-draft, below xl, the invite panel exists nowhere.** No link points at it post-draft
   (both "Invite someone" links are pre-draft), so nothing is broken - but a commissioner of
   an unfilled, drafted league on a narrow window has no invite door. Same design decision as
   item 1.
4. **Quilt-era staleness in `e2e/mock-draft.spec.ts`'s solo journey (pre-existing, founder
   already deferred the reconciliation).** The audit reconciled the assertions its own change
   touched - the front-door hero heading ("There is always a seat." replaced "Real leagues.
   Real seats. Drafting this week.") and the link room's countdown (the quilt retired the
   scheduled rail, so the fill clock lives on `ShareLinkPanel` alone) - and the link-room test
   now passes end to end with the absolute share URL. The solo-mock journey then fails on the
   NEXT quilt-era assertion (`draft-board-grid` bot markers, a surface the quilt replaced),
   the first of a chain that amounts to rewriting the spec for the quilt room - the suite
   reconciliation the founder explicitly deferred to one pass at the end of the UX campaign,
   not link work. The same retired hero heading is still asserted in `design-v2.spec.ts`
   (lines ~102/276) and `mobile-360.spec.ts` (~144); both predate this branch.
5. **The e2e viewport sits exactly on the xl breakpoint.** Desktop Chrome's 1280px is one
   pixel from the width class that hid this bug. `invite-anchor.spec.ts` now covers 1200px for
   the invite chain; a broader second sub-xl project (like the existing `mobile-360`) would
   catch this class generally.

## How to re-run the dynamic layer

```
# dev server on a spare port, lab session minted
npx dotenv -e .env.local -- npx next dev -p 3210
npx dotenv -e .env.local -- npx tsx scripts/mint-dev-session.ts .lab-session.json

# the crawl (signed in, then the public surface)
LAB_BASE_URL=http://localhost:3210 LAB_SESSION_FILE=.lab-session.json npx tsx scripts/link-crawl.ts
LAB_BASE_URL=http://localhost:3210 LAB_SIGNED_OUT=1 npx tsx scripts/link-crawl.ts
```
