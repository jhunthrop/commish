# Navigation and Information Architecture Review

**Date:** 2026-08-27
**Scope:** the structure BETWEEN screens — the navigation model, wayfinding, and whether the
site's map matches a manager's mental model. Not a per-screen design review; the six of those
already exist (`2026-08-26-draft-room-design-review.md`, `2026-08-26-mock-lobby-review.md`,
`2026-08-26-mock-results-review.md`, `2026-08-27-joining-review.md`,
`2026-08-27-league-life-review.md`, `2026-08-27-competition-review.md`,
`2026-08-27-operator-review.md`, `2026-08-27-storefront-review.md`) and are not re-litigated here.
**Branch:** `worktree-ive-campaign`. Read-only; this file is the only artifact.

---

## Method

Two passes, source first so the live walk had something to falsify.

**1. Route map from source.** Enumerated every `src/app/**/page.tsx` (29 page routes) plus the
four auth route handlers, recorded each one's route group (`(shell)` / `(room)` / `(public)` /
root), its auth gate (`requireCurrentUser` / `getCurrentUser` / `withAdmin` / `middleware.ts`'s
`/app` prefix rule), and then grepped every `href=`, `ButtonLink`, `redirect(`, and
`router.push(` across `src/` — excluding `*.test.*` and `src/app/api/**` — to build the inbound
link graph. A page with zero inbound links from rendered UI is recorded as an orphan.

**2. Live walk of the built app** at `http://localhost:3102`, Playwright from
`node_modules/playwright`, scratch scripts under the session scratchpad prefixed `navIA-`.
Two sessions (`e2e/.auth/manager-a.json`, established; and signed-out), two widths (1440, 390).
For each route the walk captured: `document.title`, every `h1`, whether the top bar / league rail
/ footer rendered and whether they were *computed-visible* (not merely present in the DOM), the
header's links and buttons, and every non-chrome anchor with its visibility — so a control that
exists only above a breakpoint reads as a lost route, not a present one. Shared DB: read-only
behavior only, nothing created, nothing deleted.

**3. Reachability probes.** From three starting points — app home, deep inside a league
(`/app/leagues/:id/trades`), and inside a live draft room — counted clicks to eight destinations:
their leagues, a specific league home, the live draft room, mock drafts, the wallet, the profile,
support/help, and sign out.

---

## Route map

`gate` values: **mw** = `middleware.ts` redirects unauthenticated `/app/*` to hosted sign-in;
**req** = `requireCurrentUser()`; **opt** = `getCurrentUser()`, renders either way; **admin** =
`withAdmin` (404, not 403); **member** = membership check, `notFound()` on miss.

Click counts are from `/app` (signed-in home) for a manager who already has at least one league —
the ordinary case, not first-run. "∞" means no rendered link path exists at any depth; the URL
must be typed.

| Path | Group | Gate | Linked from | Clicks from `/app` |
|---|---|---|---|---|
| `/` | root | opt | `not-found`, `/sign-in/problem`, `/reviews`, PublicBar wordmark | 1 (wordmark on public pages only) |
| `/browse` | root ¹ | opt | front door ×3, `not-found`, wallet, invite landing ×4, seat-hold ×3, home board, draft-room mock results, first-run, seat-taken | 1 |
| `/reviews` | root ¹ | opt | `/app/profile`, review composer, proof strip, front-door nav | 2 (profile → reviews) |
| `/support` | root | none | `PublicFooter` only | ∞ |
| `/league-rules` | root | none | `PublicFooter`, front-door nav, `/support` | ∞ |
| `/legal/terms` | root | none | `PublicFooter` only | ∞ |
| `/legal/privacy` | root | none | `PublicFooter` only | ∞ |
| `/sign-in/problem` | root | none | `callback/route.ts` error redirect | n/a |
| `/join/[leagueId]/hold` | root | opt | `SignInLink` intent from open-league cards / seat-hold panel | 2 (via `/browse`, signed-out path) |
| `/draft/[draftId]/board` | root | `redirect("/sign-in")` | **nothing** | ∞ |
| `/app` | (shell) | mw + req | TopBar wordmark (every shell page), `error.tsx`, draft-room `error.tsx`, admin queue empty state | 0 |
| `/app/leagues` | (shell) | — (`redirect("/app")`) | **nothing** | ∞ |
| `/app/leagues/[leagueId]` | (shell) | req + member | league rail (every shell page), home cards, board rows, activity feed, invite landing, seat-hold redirect, create/join `router.push` | 1 |
| `/app/leagues/[leagueId]/activity` | (shell) | req + member | league home ×2, activity feed pagination | 2 |
| `/app/leagues/[leagueId]/matchups/[week]` | (shell) | req + member | league home ×2, `WeekNav` | 2 |
| `/app/leagues/[leagueId]/trades` | (shell) | req + member (team required) | `TradeInboxLink` on league home | 2 |
| `/app/mock-drafts` | (shell) | req | `PracticeEntryLink` (first-run panel only, front door, `/browse`), waiting room, mock share landing, draft-room mock results | ∞ ² |
| `/app/mock-drafts/[code]` | (shell) | req | share link copied out of a mock room | n/a |
| `/app/profile` | (shell) | req | TopBar (every shell page), waiting room | 1 |
| `/app/wallet` | (shell) | req | `/app/profile` only | 2 |
| `/app/admin/queue` | (shell) | admin | TopBar (admins only) | 1 |
| `/app/admin/queue/[flagId]` | (shell) | admin | `QueueTable` rows | 2 |
| `/app/admin/holds` | (shell) | admin | **nothing** | ∞ |
| `/app/admin/exclusions` | (shell) | admin | **nothing** | ∞ |
| `/app/admin/leagues/settle` | (shell) | admin | **nothing** | ∞ |
| `/app/admin/leagues/dissolve` | (shell) | admin | **nothing** | ∞ |
| `/app/admin/money/reconcile` | (shell) | admin | **nothing** | ∞ |
| `/app/drafts/[draftId]` | **(room)** | req | league home, home cards (`actionHref`), waiting room, draft schedule panel, mock lobby ×3, mock share landing | 1 |
| `/app/join/[code]` | **(public)** | opt, mw-exempt | `JoinLeagueEntry` form submit only | 1 (type a code) |

¹ `/browse` and `/reviews` are structurally root pages that render `PublicBar` signed-out and
hand-roll `<AppShell>` signed-in — they are the only two pages outside `(shell)` that do this.

² Reachable at 2 clicks *via* `/browse` (`PracticeEntryLink` renders there for signed-in users),
but nothing in the app labels `/browse` as the route to practice, and `/app` itself carries no
mock-draft link once `leagueCount > 0` (`firstRunPlan` returns `null`).

### Chrome inventory, measured live

| Surface | Top bar carries | Rail | Footer |
|---|---|---|---|
| `(shell)` — 17 routes | wordmark→`/app`, live pill, Queue (admin only), Notices, name→`/app/profile`, Sign out | yes, all widths | **none** |
| `(room)` — `/app/drafts/[draftId]` | *nothing* — 0 anchors, 0 forms, two help buttons | no | unlabeled `<footer>` (the dock) |
| `/draft/[id]/board` | *nothing* — 0 anchors | no | none |
| `(public)` — `/app/join/[code]` | no `<header>` at all | no | `PublicFooter` |
| public root — `/`, `/support`, `/legal/*`, `/league-rules` | wordmark→`/`, "Sign in" (**even when signed in**), front door only: 3 nav links | no | `PublicFooter` |

### Reachability from three starting points

| Destination | From `/app` | From `/app/leagues/:id/trades` | From `/app/drafts/:id` (live) |
|---|---|---|---|
| (a) their leagues | 0 | 1 (wordmark) | **∞** |
| (b) a specific league home | 1 (rail tile / card) | 1 (rail tile) ³ | **∞** |
| (c) the live draft room | 1 (card next-action) | 2 | 0 |
| (d) mock drafts | **∞** (2 via `/browse`, unsignposted) | ∞ | ∞ (only from a *finished mock*, never a real draft) |
| (e) the wallet | 2 | 2 | **∞** |
| (f) their profile | 1 | 1 | **∞** |
| (g) support / help | **∞** | **∞** | **∞** |
| (h) sign out | 1 | 1 | **∞** |

³ There is no in-page link back to the league from `/trades` — only the rail, where the current
league is visually indistinguishable from the other 105 tiles.

---

## Findings

| id | severity | finding | where | one-line fix |
|---|---|---|---|---|
| N1 | **BLOCKER** | The live draft room renders **zero anchors and zero forms** at 390 and 1440. No home, no league, no profile, no help, no sign out. Browser back is the only exit, and on a direct landing (email, notification, bookmark) there is no back entry to return to — a genuine trap on the product's highest-stakes, real-money screen. | `src/draft-room/components/room-rail.tsx`, `room-dock.tsx`, `room-layout.tsx`; route `src/app/app/(room)/drafts/[draftId]/page.tsx` | Give `RoomRail` a persistent league crest/name link to `/app/leagues/:id` plus a single "Leave the room" control; both survive the no-page-scroll contract at rail width. |
| N2 | **BLOCKER** | Support, Terms, Privacy and League rules are reachable **only** through `PublicFooter`, which `AppShell` never renders. Every one of the 17 signed-in routes has ∞ distance to help. A manager in a money dispute, mid-draft, has no route to support without signing out or typing a URL. | `src/components/app-shell/app-shell.tsx` (no footer), `public-footer.tsx` | Render `PublicFooter` (or a signed-in equivalent carrying the same four links) below `<main>` in `AppShell`. |
| N3 | **BLOCKER** | Five operator pages have **no inbound link from anywhere in the product**: `/app/admin/holds`, `/app/admin/exclusions`, `/app/admin/leagues/settle`, `/app/admin/leagues/dissolve`, `/app/admin/money/reconcile`. The operator console is one door (Queue) and five rooms with none. On a real-money platform these are the suspension, settlement and reconciliation controls. | `src/app/app/(shell)/admin/**`; `top-bar.tsx` links only `/app/admin/queue` | Add an admin section nav (rendered when `isAdmin`) listing all six operator routes; the Queue icon becomes its entry, not the whole console. |
| N4 | FRICTION | `/app/mock-drafts` disappears from the app entirely once a manager has one league — `firstRunPlan` returns `null` at `leagueCount > 0`, and `PracticeEntryLink` renders only in the first-run panel, the pre-draft waiting room, and `/browse`. The one feature a returning manager would use *between* drafts is the one with no standing entrance. | `src/identity/first-run.ts:101`, `src/league-room/components/first-run-panel.tsx:44`, `src/app/app/(shell)/page.tsx` | Give mock drafts a permanent home on `/app` (a rail entry or a home-board row), independent of first-run state. |
| N5 | FRICTION | League sub-pages disagree about exits: `/activity` renders "Go to the league"; `/trades` and `/matchups/[week]` render **no route back to the league home at all** (matchups offers only "Week 2 →"). Browser back is the only exit from two of the three. | `src/app/app/(shell)/leagues/[leagueId]/trades/page.tsx`, `.../matchups/[week]/page.tsx` | One shared league sub-page header carrying the league name as a link back to `/app/leagues/:id` on all three. |
| N6 | FRICTION | `/app/wallet`'s only inbound is `/app/profile`, and the wallet's only body link is `/browse` — a one-way door off the profile with no route back to it. The product's biggest trust surface is a cul-de-sac. | `src/app/app/(shell)/profile/page.tsx:92`, `src/app/app/(shell)/wallet/wallet-content.tsx:85` | Put the wallet in the top bar (money deserves top-level status) and add a "Back to your profile" exit. |
| N7 | FRICTION | The league rail sets `aria-current="page"` on the current league but styles it **identically** to every other tile — measured: same class string, same computed outline, background, border and opacity. The one persistent navigation in the product has no visual "you are here". | `src/components/app-shell/league-rail.tsx:88` | Add an `aria-[current=page]:` ring/inset-bar variant to the tile class. |
| N8 | FRICTION | The rail is unbounded and unlabelled: 106 tiles, `scrollHeight` 5160px against a 900px viewport, no scroll-into-view for the current league, no names, no grouping, no search. Its job is not legible — is it "leagues that need you", "all leagues", or a switcher? | `src/components/app-shell/league-rail.tsx` | Cap the rail at leagues that need action plus recents, scroll the current tile into view on mount, and put "All leagues" at the end. |
| N9 | FRICTION | The public nav (`Open leagues`, `How it works`, `Reviews`) is `hidden sm:flex` — measured `display: none, width 0` at 390. Three routes vanish on a phone with no replacement control. | `src/components/app-shell/public-bar.tsx:39` | Collapse to a menu below `sm` rather than removing; a control that only exists at `sm+` is a lost route. |
| N10 | FRICTION | The public group applies two different session rules. `/browse` and `/reviews` swap to `AppShell` when signed in. `/`, `/support`, `/league-rules`, `/legal/*` do not — a signed-in manager sees a **"Sign in" link** and no way back to `/app` except the wordmark, which returns to the marketing front door. | `src/app/browse/page.tsx:113`, `src/app/reviews/page.tsx:95` vs `src/app/support/page.tsx`, `league-rules/`, `legal/*` | One rule for the whole public group: signed-in visitors get the app chrome (or at minimum a "Back to your leagues" link), never a "Sign in" prompt. |
| N11 | FRICTION | Every one of the 29 pages sets `document.title = "Commish"` — only `src/app/layout.tsx` declares metadata; no page overrides it. History entries, tabs and bookmarks are indistinguishable, which matters exactly because browser-back is the only exit in several places (N1, N5). | `src/app/layout.tsx:18`; no page-level `metadata` export anywhere | Add a title template (`%s · Commish`) and a per-page `metadata`/`generateMetadata`. |
| N12 | FRICTION | Two "join" URL trees for one verb: `/app/join/[code]` (invite code, `(public)` group, middleware-exempt) and `/join/[leagueId]/hold` (public seat hold, root group). Same intent, two shapes, two trees, two chromes. | `src/app/app/(public)/join/[code]/`, `src/app/join/[leagueId]/hold/`, `middleware.ts:20` | Unify under one `/join/*` tree; the code path and the seat-hold path are two entrances to the same room. |
| N13 | FRICTION | The same draft is `/app/drafts/[draftId]` (plural, under `/app`) and `/draft/[draftId]/board` (singular, at root). No user would guess either from the other. | `src/app/app/(room)/drafts/`, `src/app/draft/[draftId]/board/` | Make the board a child of the room: `/app/drafts/[draftId]/board`. |
| N14 | FRICTION | "Create a league" is a **fragment, not a route**: `/app#create-league` is the target of the rail's plus tile, the front door, `/browse`, and the public list. Nothing has an h1 of "Create a league", it cannot be linked from an email reliably, and on `/app` the fragment lands mid-page under "Your leagues". | `league-rail.tsx:100`, `src/app/page.tsx:180`, `src/app/browse/page.tsx:102`, `public-league-list.tsx:277` | Give creation its own route (`/app/leagues/new`) with its own title and h1. |
| N15 | FRICTION | Naming drift across nav label, page title and section heading. Mock drafts is called four things: h1 "Mock drafts", "the lobby" (`Back to the lobby`, `Open the mock draft lobby`), "practice" (`PracticeEntryLink`, `PracticeBanner`), and "Try a mock draft". `/league-rules` is "How it works" in the front-door nav and in its own h1, but "League rules" in the footer — the route name matches neither call site. `/browse` carries five labels: "Open leagues", "Take a seat", "See every open league", "Browse open leagues", "Browse free leagues". | `mock-drafts/page.tsx:26`, `mock-drafts/[code]/page.tsx:38`, `practice-entry-link.tsx`, `src/app/page.tsx:37`, `public-footer.tsx:19`, `wallet-content.tsx:85` | One name per route, owned by a COPY constant, used by nav label, h1 and every inbound link. |
| N16 | POLISH | `/app/leagues` exists only to `redirect("/app")` and nothing links to it — a redirect stub for a URL users would reasonably guess, which is fine, but it means home has three names (`/app`, `/app/leagues`, h1 "Your leagues") and none is canonical in the URL. | `src/app/app/(shell)/leagues/page.tsx:8` | Keep the redirect; decide whether `/app/leagues` or `/app` is the canonical home and make the other the alias. |
| N17 | POLISH | The draft room's `<header>` and `<footer>` carry no accessible name and the room has **no `nav` landmark at all** — screen-reader landmark navigation cannot find the room's structure, which compounds N1. | `src/draft-room/components/room-layout.tsx`, `room-dock.tsx` | Name both landmarks; add a `nav` around whatever exit N1 introduces. |
| N18 | POLISH | No page in the product renders a breadcrumb or a section label. "Where am I" rests entirely on the h1, which for a league sub-page reads "Trades" with no league name in it (matchups does better: "Dev Season League · Week 1"). | all `(shell)` sub-pages | Prefix league sub-page h1s with the league name, as matchups already does. |
| N19 | POLISH | `/sign-in/problem`'s only exit is the wordmark to `/`, which drops the visitor at marketing rather than retrying the sign-in they were attempting. | `src/app/sign-in/problem/page.tsx:48` | Add a "Try signing in again" link carrying the original `returnTo`. |
| N20 | POLISH | `/app/join/[code]` renders no `<header>` at all — the only page in the product with no top chrome and a footer. A visitor who lands on a bad invite has one link (`/browse`) plus the four footer links, but nothing identifying the product above the fold. | `src/app/app/(public)/join/[code]/page.tsx` | Render `PublicBar` on the invite page as its own docblock in `public-bar.tsx` already claims it does. |

**Counts: 3 BLOCKER, 12 FRICTION, 5 POLISH — 20 findings.**

---

## Orphans and dead ends

### Orphan routes — 7

Zero inbound `href`/`redirect`/`router.push` from any rendered UI in `src/`:

1. `/draft/[draftId]/board` — the read-only TV board. Referenced in `docs/draft-room.md` and
   `docs/conventions.md` only. It is the product's demo-able set piece and nothing opens it.
2. `/app/admin/holds`
3. `/app/admin/exclusions`
4. `/app/admin/leagues/settle`
5. `/app/admin/leagues/dissolve`
6. `/app/admin/money/reconcile`
7. `/app/leagues` — redirect-only stub, no inbound link (benign, but it is an unreferenced route).

Four more routes are **orphaned from the signed-in half of the product** rather than absolutely:
`/support`, `/league-rules`, `/legal/terms`, `/legal/privacy` all live in `PublicFooter`, which
`AppShell` does not render (N2).

### Dead ends and one-way doors

| Where | What happens |
|---|---|
| `/app/drafts/[draftId]` (live) | Total dead end. 0 anchors, 0 forms, no rail, no shell. Only exit is browser back — and on a direct landing there is no back. |
| `/draft/[draftId]/board` | Total dead end. 0 anchors, and no inbound link either — you can only arrive by typing the URL, and only leave by typing another. |
| `/app/leagues/:id/trades` | No exit rendered. Rail or browser back only. |
| `/app/leagues/:id/matchups/:week` | Only "Week N ±1". No route to the league home. |
| `/app/wallet` | One-way door off `/app/profile`; wallet's only link is `/browse`, which leaves the account area entirely. |
| `/app/admin/*` (five pages) | One-way in the other direction: no way *in*. |
| `/`, `/support`, `/legal/*`, `/league-rules` when signed in | Offer "Sign in" and no route to `/app` — the wordmark returns to marketing. |
| `/sign-in/problem` | Only exit is `/`. |

### Browser-back-only exits

Five routes where the browser's back button is the sole exit for at least one common arrival
path: the draft room, the TV board, league trades, league matchups, and `/app/wallet` (for the
"return to profile" intent). This is exactly the population that N11 (every page titled
"Commish") makes worse — the history stack these users depend on is unreadable.

---

## Mobile route parity

Measured at 390×844 against 1440×900, signed in and signed out.

**Holds parity.** The `(shell)` chrome loses nothing: `TopBar` is icon-only by deliberate design
at every width (its own docblock records the 360px regression that forced this), and `LeagueRail`
reflows from a vertical rail to a horizontal scrolling strip rather than hiding — measured
`visible` with all 106 tiles at 390. `LiveStatePill` is likewise unconditional. This is the right
pattern and the codebase already knows why.

**Loses routes.**

| Control | Behavior | Routes lost below 640px |
|---|---|---|
| `PublicBar` nav (`public-bar.tsx:39`, `hidden ... sm:flex`) | measured `display: none`, width 0 at 390 | `/browse`, `/league-rules`, `/reviews` from the front-door header. `/browse` survives via the "Take a seat" action and the shelf; `/league-rules` survives via the footer; **`/reviews` is lost from the front-door chrome entirely** — its only other front-door route is a `ProofStrip` link. |

**Degrades badly without losing the route.** The rail's horizontal strip at 390 puts 106
undifferentiated two-letter crests in a single scroller with no current-tile indicator (N7) and
no scroll-into-view (N8). The route is technically present; finding your league in it is not a
navigation, it is a search. This is the mobile face of N8 and it is worse on the phone than on
the desktop, because the strip shows roughly six tiles at a time instead of eighteen.

**Not tested and worth a follow-up:** the draft room at 390 has the same zero exits as at 1440,
so N1 is width-independent — but a phone user has a system back gesture where a desktop user has
a keyboard shortcut, which means the room's trap is *slightly* less severe on mobile. That is not
a defense of it.

---

## Recommended navigation model

The argument against what exists, not a wish list.

### What the product actually is

Three nouns, and the navigation should say so on every page: **your leagues** (the plural home),
**a league** (the room you spend the season in), **your account** (identity, money, preferences).
Plus two utilities that cut across all three: **practice** and **help**. The current chrome names
two of those five and hides three.

### Top bar — what it should carry

Today: wordmark, live pill, Queue (admin), Notices, name, Sign out. That is an *identity* bar
wearing the job of a *navigation* bar, which is why wallet, practice and help have no home.

It should carry, left to right:

- **Wordmark → `/app`.** Correct today. This is the one obvious home and it should stay the only
  thing claiming that job — which means `/app/leagues` stays a redirect (N16), never a second
  home with its own tab.
- **Live pill.** Correct today, and the discipline behind it (no pill on a Tuesday in July) is
  right. Keep.
- **Practice.** Mock drafts is a standing capability, not a first-run consolation. It has ∞
  distance from home for every manager who has ever joined a league (N4), which is precisely the
  population most likely to want a mock. It belongs in the bar or as a fixed rail entry, not
  behind a `leagueCount === 0` branch.
- **Wallet.** Real money is a top-level noun on a real-money product. Two clicks behind the
  profile with no route back (N6) understates it and traps it. An icon in the bar, next to
  Notices, costs one control and removes a cul-de-sac.
- **Notices.** Correct today.
- **Name → `/app/profile`.** Correct today.
- **Admin (`isAdmin` only) → an admin *index*, not the queue.** The queue is one of six operator
  rooms and the only one with a door (N3). The icon should open a console that lists all six.
- **Sign out.** Correct today — but it must exist on every signed-in surface, which today means
  the draft room needs it too (N1).

Everything above is icon-only at every width, matching the pattern this bar already established
and defended. Adding two icons to a bar already proven at 360px is the cheap half of this review.

### Footer — the missing chrome

`AppShell` renders no footer, and that single omission is why Support, Terms, Privacy and League
rules are unreachable from 17 routes (N2). `PublicFooter` already exists, already names exactly
the four links a money product must always expose, and already has a test asserting its contract.
Render it under `<main>` in `AppShell`. This is a four-line fix for a BLOCKER.

### The league rail — give it one job and say what it is

Today the rail is "every league you are in, forever, as anonymous two-letter crests, in creation
order, with no indication of which one you are looking at". It is doing three jobs badly: a
switcher, an alert surface (the dots), and an index. Pick one.

It should be a **switcher for the leagues that matter right now**: leagues needing action first
(the dots already encode this and the accessible names already say why), then recents, capped —
with the current league visually current (N7), scrolled into view on mount, and a terminal "All
leagues" entry to `/app` for the long tail. The plus tile should point at a real route, not a
fragment (N14). An uncapped rail is not an index; it is a scrollbar with 5160px of undifferentiated
tiles behind it (N8), and on a phone it is worse.

### Page-level exits — the rule the product is missing

Every page should answer "where am I" and "how do I get back up" without the browser. Concretely:

1. **A page inside a league carries the league's name as a link to the league home.** `/activity`
   does this; `/trades` and `/matchups/:week` do not (N5). One shared sub-page header fixes all
   three and gives matchups the breadcrumb it half has already.
2. **A page inside the account area carries a route back to the account.** The wallet does not (N6).
3. **A room that declines the shell owes a hand-built exit.** This is the whole justification for
   the `(room)` group — the room drops the shell so the board can own the viewport, which is
   correct — but "declines the shell" was implemented as "declines navigation". `RoomRail` is
   full-height chrome that already renders the league name; making that name a link plus adding
   one "Leave" control discharges the debt without touching the no-page-scroll contract (N1).
4. **A page in the public group shows the visitor the chrome that matches their session.**
   `/browse` and `/reviews` get this right; `/`, `/support`, `/legal/*` and `/league-rules` show a
   signed-in manager a "Sign in" link (N10).

### URLs and naming

The map should be guessable and the names should agree across nav label, page title and section
heading. Today three routes fail this:

- One draft object, two URL shapes (`/app/drafts/:id` and `/draft/:id/board`) — nest the board (N13).
- One join verb, two trees (`/app/join/[code]` and `/join/:id/hold`) — unify (N12).
- One creation action, zero routes (`/app#create-league` is a fragment) — give it a page (N14).

And one route with four names — mock drafts is "Mock drafts", "the lobby", "practice", and "Try a
mock draft" depending on where you stand (N15). The product already has the right instinct here
(`NEXT_ACTION_COPY` is a single source of truth for league action labels, and the rail correctly
reuses it rather than typing a second copy). Extend that instinct to route names: one COPY
constant per route, consumed by the nav label, the `metadata.title`, the h1, and every inbound
link. That constant also solves N11, because a route that owns its name owns its page title.

### Does the model teach itself?

Not yet. The pieces of a good model are present and individually well argued — a single home, a
persistent switcher, a shell that renders once in a layout, route groups that let two surfaces
decline it for real reasons. What is missing is the *rule* that a surface declining the shell owes
its own exits, and the *rule* that a route's name is one string. Those two rules, applied, close
the three blockers and most of the friction; the model underneath them is sound.
