# Commish — League & Standings

Read this with `docs/conventions.md` and `docs/draft-engine.md` before touching anything under
`src/league/`, `src/league-service/` or `src/league-room/`. The engine/service split here
mirrors the draft's: one pure layer, one Postgres layer, one browser layer that never imports
either directly.

## The two layers

| Layer | Path | Rule |
|---|---|---|
| Engine | `src/league/` | Pure. No I/O, no `Date.now()`, `readonly` everywhere, 100% test coverage enforced: schedule generation (the circle method), standings, clinching, lineup shaping, invite codes, `LEAGUE_CONFIG`. |
| Service | `src/league-service/` | The only part that talks to Postgres: league creation, invites, the schedule write, lineups, scoring and standings assembly. Consumed directly by `/api/leagues/**` route handlers and by `src/app/**` Server Components. |

Same rationale as the draft: a schedule, a standings table or a clinch computation is a pure
function of rows already in hand, so it lives where it can be tested exhaustively without a
database. Persisting those rows, and reading them back into the shape a page renders, is the
service layer's job alone.

## Creating a league

`createLeague` (`src/league-service/creation.ts`) writes the whole league in **one
transaction**: the `leagues` row, its `scoring_settings`, the commissioner's own `teams` row,
and a `drafts` row already scheduled. A commissioner left holding a league they have no team
in — or a league with no draft to open — is exactly the dead end this closes; there is no
partial-league state to clean up after.

Every field but the name is defaulted from `LEAGUE_CONFIG.defaults` (`src/league/config.ts`):
12 teams, snake format, PPR scoring, the standard roster shape, a draft scheduled
`draftDaysFromCreation` (7) days out. `POST /api/leagues` accepts `{ "name": "…" }` as a
complete request — everything else, including the advanced disclosure's own fields, is
optional. The draft is scheduled a week out rather than immediately so its auto-tightening
clock starts in a slow tier instead of at the 60-second floor (`docs/draft-engine.md`).

**The interaction budget.** `LEAGUE_CONFIG.maxCreateInteractions` (3) is the spec's exit
criterion made testable: signed in → a created, invitable league in a small number of
interactions by accepting every default. `src/league-room/create-league-interactions.test.tsx`
drives the real `CreateLeagueForm`/`CreateLeaguePanel` and counts every click and keystroke
against that ceiling — it fails the moment the happy path grows a step, not just when a field
becomes literally impossible to skip.

## Invites

`league_invites` is the **single** membership mechanism — `leagues.invite_code` was dropped
rather than kept as a second, redundant path, because two ways to join the same league is two
places capacity and expiry logic can disagree. The invite **code is the primary key**, and it
is also the last path segment of the shareable link (`/app/join/<code>`): one artifact to
mint, one to expire, one to revoke, rather than a link and a separately-tracked code that
could drift apart.

- **Expiry** — `LEAGUE_CONFIG.invite.expiryDays` (14) from creation; an accept past that
  returns 410.
- **Use cap** — `LEAGUE_CONFIG.invite.maxUses` (32 by default, overridable per invite); an
  accept once `uses >= maxUses` also returns 410.
- **Capacity under concurrent accepts.** `acceptInvite` (`src/league-service/invites.ts`)
  locks the **league** row `FOR UPDATE` before counting existing teams — not the invite row,
  which would let two people redeeming two *different* codes for the same league both read
  "11 of 12" and both insert a 13th team. Locking the league serializes every accept for that
  league regardless of which code it arrived on. `teams_league_user_idx` (a unique index on
  `(leagueId, userId)`) is the backstop for the narrower race: the same person accepting twice
  concurrently. A violation of that index in the catch block is read as "they're already a
  member" — a success, not an error — never surfaced as a 500.
- **Re-accepting is idempotent and free.** Opening your own invite link again finds your
  existing `teams` row and returns it with `alreadyMember: true`; it costs the invite no use
  and mutates nothing.

## The schedule

`generateSchedule` (`src/league/schedule.ts`) is the circle method: team 0 stays fixed while
every other team rotates one place per round, so `n - 1` rounds cover every distinct pairing
exactly once before the rotation repeats. An **odd** number of teams gets a sentinel `BYE`
appended to make the count even; whichever real team is paired with `BYE` in a given round
simply has no matchup that week, and no `BYE` row ever reaches the `matchups` table. Home and
away alternate by **round**, not by a team's position in the rotating wheel — alternating on
position would pin a rotating team to one side of the ball for a whole half-cycle, since its
wheel index falls by exactly one every round and cancels any parity rule mixed into it.
Alternating on the round alone keeps the imbalance small and bounded (`|home − away| ≤ 4`
across every supported league size and season length) rather than perfectly even, and a
rematch always swaps sides.

The generator is pure and deterministic: the same team order and week count always produce the
same schedule, which is what makes a seeded league reproducible and a regenerated schedule
idempotent. `writeSchedule` (`src/league-service/schedule.ts`) persists a generated season
inside the caller's transaction with two `onConflictDoNothing` inserts (`weeks`, `matchups`),
so a repeat write costs nothing and never duplicates a row. It is called from
`commitDraftState` inside the same transaction that completes a draft — the schedule exists
the instant a league finishes drafting, never as a separate step a commissioner has to
remember — and the defensive re-commit `docs/draft-engine.md` describes for a wedged draft is
safe to replay because this write already is.

## Lineups

Two tables, two different questions: `roster_slots` is **ownership** — what a team drafted, in
what slot — and never changes week to week. `lineup_slots` is **what you started in week N**,
one row set per team per week. A manager who never opens the lineup editor still fields a
legal team: `getLineup` (`src/league-service/lineups.ts`) falls back to `defaultLineup`
(`src/league/lineup.ts`), which expands the roster's drafted slot assignment into the full
lineup shape, rather than handing back an empty form.

`setLineup` reuses `validateLineup` (`src/domain/roster-eligibility.ts`) — the exact function
the draft engine uses to keep a roster legal — applied to the **starting slots only**, since it
treats an empty slot as invalid and a bench spot is legitimately allowed to be empty. Its
`reason` is returned to the client **verbatim**: it is already plain language, and paraphrasing
it a second time in the league-service layer would just be a second copy of the same rule to
keep in sync.

**The bench is derived server-side, never trusted from the client.** `setLineup` computes it as
exactly "everyone on this roster who isn't starting" — that is what lets `LineupEditor`
(`src/league-room/components/lineup-editor.tsx`) send only its starting-slot assignments and do
no lineup arithmetic of its own, which matters because `src/league-room/**` may not
value-import `@/league` at all (see "The client boundary" below).

**A week locks when it is scored.** `isWeekLocked` is true once every matchup in that week has
both scores set — the same condition `MatchupSummary.final` uses — and `setLineup` refuses a
write against a locked week with a 409. There is deliberately no clock-based lock: this phase
has no live game data for a clock to track, and pretending otherwise from the server side would
undercut the same "never imply live data" rule the matchup copy already enforces from the
client side.

## Scoring and standings

`scoreWeek` (`src/league-service/results.ts`) scores one week from the **fixed, static mock
stat set** — there is no live feed in this phase, so a week becomes final the moment a
commissioner presses the button, not when a calendar says so. For each matchup it reads both
teams' saved (or default) starting lineup, scores the starters with `scoreLineup`
(`src/scoring/`) against the league's own `scoring_settings`, and writes both scores inside one
transaction — a half-scored week is not a result, it's a bug in progress, and
`computeStandings` deliberately ignores a matchup with only one score set. Re-running is safe
and reproduces identical numbers: it recomputes from the same stored lineups and stat lines and
overwrites.

`computeStandings` (`src/league/standings.ts`) tallies wins, losses, ties and both points
columns from finished matchups only, then sorts by the canonical ranking — **win percentage
(a tie counts as half a win), then points for, then team id** — a total order, so two clients
reading the same rows never disagree on placement. Win percentage rather than raw win count is
what keeps a 5-1-1 record ranked above a 5-2-0 one; a wins-only sort would call them equal and
fall through to points for, which has nothing to do with which team actually has the better
record. `roundPoints` (`src/scoring/`) is the same rounding function both the per-lineup
score and the standings' points-for/points-against columns use, so a team's own weekly total
and its season sum are never off by a rounding difference.

`clinchedTeamIds` (`src/league/clinch.ts`) is deliberately **conservative**: a team clinches a
playoff spot once its win total is strictly greater than what the first team *outside* the cut
could reach by winning every remaining week. A team that could still finish tied has not
clinched — a tiebreaker is a possibility, not a guarantee — so the celebration only fires on a
mathematically certain outcome.

## Real-time

**No `league.*`, `lineup.*` or `matchup.*` event type exists, on purpose.** Standings and
scoring are batch operations: a commissioner presses "score this week", the numbers land in
Postgres, and the next page load already reflects them — there is nothing "live" to push. A
lineup change is visible only to the manager who made it (`GET /api/leagues/[leagueId]/teams/me/lineup`
answers the caller's own team, never anybody else's), so broadcasting it would tell every other
manager in the league about a private roster move nobody asked to watch. Adding a channel
nothing subscribes to would violate `docs/conventions.md`'s "one closed taxonomy" rule for no
gain. `score.update` is enumerated in `src/lib/realtime/events.ts` for a later phase with an
actual live feed, and stays unused until one exists — Phase 1 never publishes it.

League chat is the one thing on this page that IS live. `chat.message` and `chat.reaction` ride
the same `league:<id>:events` stream, gated by the same membership rule, and are consumed by
`useLeagueChat` rather than by anything in `src/league-room/**` — the panel is imported from
`src/chat-room/**` and mounted here. See `docs/chat.md`. That does not weaken the rule above:
a chat message is a genuinely new fact somebody just produced, whereas standings and lineups
are batch results with nothing to push.

## The client boundary

`src/league-room/**` is browser code under the **same** ESLint
`@typescript-eslint/no-restricted-imports` rule as `src/draft-room/**` and `src/chat-room/**`
(`eslint.config.mjs`, scoped to all three directories' `*.{ts,tsx}` files): it may not
value-import `@/league`, `@/league-service`, `@/db*` or `@/lib/realtime*` — only
`import type` (sharing a wire type like `LeagueHomeBody` costs nothing at runtime and is how
the client and server sides stay in sync) and plain `fetch`/SSE against `/api/leagues/**` and
`/api/invites/**`. The league room renders names straight off the server-shaped view (e.g.
`MatchupSide.teamName`) rather than looking them up client-side, so it has no id→name lookup
module of its own — `src/lib/display/lookups.ts`'s `teamsById`/`playersById`/`teamName`/
`playerName` pattern is a `src/draft-room/**`-only need (the draft room resolves ids against a
live pool the server never renders into text).

Pages under `src/app/**` are Next.js Server Components (`page.tsx`) and route handlers
(`route.ts`), which are outside that rule and read the service layer directly — the idiomatic
Next.js pattern. `src/app/app/leagues/[leagueId]/page.tsx` and its `matchups/[week]/page.tsx`
sibling both call `leagueHome`/`matchupWeek`/`lineupView` straight from `@/league-service` and
hand the assembled body to a presentational component (`LeagueHome`, `MatchupPanel`) imported
from `src/league-room/**`; any interactivity those pages need is a `"use client"` component
from that same directory, never inlined into the page file.

## Routes

Every `/api/leagues/**` and `/api/invites/**` route goes through `src/app/api/leagues/_shared.ts`:
`withCurrentUser` (401 JSON, never a redirect), `withLeagueMemberActor` (membership required,
403 for a signed-in stranger with no team and no commissioner role), and `withCommissioner`
(the two commissioner-only actions). Every response is the same envelope
(`{ ok: true, data }` / `{ ok: false, error }`) every other route in the app uses.

| Route | Who | Notes |
|---|---|---|
| `GET /api/leagues` | any signed-in user | Every league the caller fields a team in, oldest first, with fill count and draft status. |
| `POST /api/leagues` | any signed-in user | Body: `{ name, format?, teamCount?, scoringPreset?, auctionBudget?, teamName?, visibility?, stakeTier?, experienceTier? }` — only `name` is required. Creates the league, the caller's team and a scheduled draft in one transaction. `visibility: "public"` (default `"invite_only"`) is what sets `is_public_matchmade` and makes the league eligible for `GET /api/public/leagues`; `stakeTier` (0-3, default 0) and `experienceTier` are the cosmetic/matching fields a public listing shows. |
| `GET /api/leagues/[leagueId]` | a manager with a team in the league, or the commissioner | `leagueHome`: standings, this week's matchup, the roster shape and the draft's status, in one payload. |
| `POST /api/leagues/[leagueId]/invites` | commissioner only | Body: `{ maxUses? }`. Mints a code; randomness is `crypto.getRandomValues`-backed, never `Math.random`, since a code is a membership capability. |
| `POST /api/invites/[code]/accept` | any signed-in user | Body: `{ teamName? }`. Joins the caller to the invite's league. Re-accepting your own invite is a 200, not an error. |
| `GET /api/leagues/[leagueId]/matchups/[week]` | a manager with a team in the league, or the commissioner | Both sides' full lineups and every starter's per-player points for that week. |
| `GET /api/leagues/[leagueId]/teams/me/lineup` | a manager with a team in the league | `?week=N`. The caller's OWN lineup, never `teams/[teamId]/lineup` — there is no path or body shape in which a manager can read or set somebody else's. |
| `PUT /api/leagues/[leagueId]/teams/me/lineup` | a manager with a team in the league | Body: `{ weekNumber, slots }`. A rejected lineup (illegal slot, unowned player, a locked week) is a 409/422 with `validateLineup`'s reason verbatim. |
| `POST /api/leagues/[leagueId]/weeks/[week]/score` | commissioner only | Scores a week from the mock dataset and stores it. Publishes no event — see "Real-time" above. |
| `GET /api/leagues/[leagueId]/events` | a manager with a team in the league, or the commissioner | The same Redis-Streams-over-SSE fan-out the draft room uses (`docs/draft-engine.md`), gated by the same membership rule — a signed-in stranger gets 403, not another league's stream. |
| `GET /api/leagues/[leagueId]/chat` | a manager with a team in the league, or the commissioner | `?before=<messageId>`. One page of `CHAT_CONFIG.pageSize` messages, oldest first, with `hasMore`. There is no unpaginated read. |
| `POST /api/leagues/[leagueId]/chat` | same | Body: `{ body }`. The author is the session's user; no body field can change it. |
| `POST /api/leagues/[leagueId]/chat/[messageId]/reactions` | same | Body: `{ emoji }` from `CHAT_CONFIG.reactions`. One verb toggles both directions. |
| `POST /api/leagues/[leagueId]/advisor/start-sit` | a manager with a team in the league | Body: `{ weekNumber, question }`. Answers advice. Writes nothing. |
| `POST /api/leagues/[leagueId]/advisor/trade` | a manager with a team in the league | Body: `{ weekNumber, counterpartyTeamId, give, receive }`. Assesses a proposal. Never executes one. |
| `GET /api/public/leagues` | **anyone, signed in or not** | `?format=&experienceTier=&stakeTier=`. Open, publicly listed, pre-draft leagues only, projected to `PublicLeagueSummary`. The one unauthenticated read in the app. |
| `POST /api/public/leagues/[leagueId]/join` | any signed-in user | Seats the caller in an open public league. 404 (same body either way) if the league id names nothing OR names a league that isn't public — deliberately collapsed, the same way `acceptInvite` collapses an invalid invite, so a caller cannot use this route to learn whether a private league id is real. 409 if its draft started or it is full, 500 on an unexpected failure. Re-joining is a 200. |

## Public matchmaking

Two ways into a league, one core. An **invite** is the private path (`acceptInvite`); **public
browse** is the open one (`joinPublicLeague`). Both call `joinLeagueInTx`
(`src/league-service/join.ts`), which takes the league row `FOR UPDATE` before counting teams
and inserts inside the caller's transaction. Two independently-written capacity checks are two
places the same league's fill count can disagree, and the disagreement only ever shows up as a
13th team in a 12-team league. Each path's own rules (an invite's expiry and use cap; a public
league's listing and draft status) run through a `JoinPrecondition` hook that fires only for a
caller who is **not** already a member, which is what keeps re-arriving free on both paths.

**The privacy boundary.** `GET /api/public/leagues` is the one unauthenticated read in this
application. What a stranger may learn is `PublicLeagueSummary` (`src/matchmaking/contract.ts`)
and nothing else: id, name, format, experience tier, stake tier, team count, filled count. No
commissioner identity, no team or owner names, no invite code, no draft id, no standings, no
rosters, no chat, no scoring settings. Three things enforce it: `is_public_matchmade` is opt-in
and false by default, `listPublicLeagues` selects exactly the contract's columns, and a key-set
test fails if the wire body ever grows a field the contract does not name. A league that is
full, or whose draft has already started, is not listed at all: a card a visitor cannot act on
is a dead end wearing a badge.

**Filtering** is `League.experienceTier`, `League.format` and `League.stakeTier`, normalized by
`normalizeBrowseFilter`, the pure function that turns a query string into a `BrowseFilter`.
Unknown values (`?format=dynasty`) normalize to "any" rather than erroring, because browse is
reached by hand-edited URLs and stale bookmarks and the honest answer is the list we can offer.
Only `'snake' | 'auction'` are offered, because those are the two formats the draft engine
runs. `leagues.experience_tier` is a **league-level** column rather than a read of the
commissioner's own profile: deriving it from a person would leak that person into an
unauthenticated read and would silently re-tier every league they run whenever they edited
their profile.

**Stake tier is cosmetic.** No entry fee is charged, no prize is paid and no balance exists
anywhere in Phase 1. `MATCHMAKING_CONFIG.stakeDisclosure` is the one wording of that promise,
rendered on the create form beside the tier control and on the browse page beside the cards.
Real money arrives in a later phase behind FBO/agent-of-payee handling, KYC/AML screening and
tax reporting.

**Signed in changes the button, not the list.** `GET /browse` itself needs no session (the
whole point is that a stranger can see what is on offer before creating an account), but joining
does. `PublicLeagueList` (`src/league-room/components/public-league-list.tsx`) renders every
card from the same `PublicLeagueSummary` rows either way; only the call to action differs. A
signed-in visitor gets the real `JoinPublicLeagueButton`. A signed-out one gets a plain "Sign in
to join" link to `/sign-in`, so the page never shows a button whose press would just bounce off
a 401. The two states are two different pieces of markup, not one button with a client-side
guard in front of it.

## Known follow-ups

- **No UI starts a draft.** `POST /api/drafts/[draftId]/start` exists and is commissioner-gated,
  but nothing in the draft room calls it. The seeded dev drafts are driven by
  `scripts/drive-dev-draft.ts`, and `e2e/league-lifecycle.spec.ts` posts the route directly with
  its real session. A commissioner using the product has no button. That is a real gap, not a
  test-harness convenience, and it belongs in the next phase's scope.
- **Playoff brackets and a championship.** `clinchedTeamIds` names who is in; nothing in Phase 1
  plays a postseason. A bracket needs seeding rules, a tiebreak policy and a bye structure that
  no spec step has defined yet.
- **Per-league scoring customization beyond the four presets.** `scoring_settings` is already
  per-league and fully populated from whichever `SCORING_PRESETS` entry a commissioner picks at
  creation, so a future settings screen granting field-by-field control is a UI change, not a
  schema change.
