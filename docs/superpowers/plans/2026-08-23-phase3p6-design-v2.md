# Phase 3.6 — The design pass: v2, dark, dense, and full width

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The founder rejected the web frontend outright: *"the web frontend isn't close to what I expect. The UX does not meet my standards at all."* The bar, verbatim and binding: *"It should feel like the most premium experience in the fantasy world. It should be sleek, modern, and beautifully simplistic but have high information density. It should maximize full screen width and be responsive. It should have the most efficient workflows possible and make the site a true joy to use. People should leave our app and say that's the best app I've ever seen or used."* Four pain points were named: visual design, layout and navigation, no wow or energy, feels like a prototype. This plan implements the three founder-approved v2 mockups across the product, and it ships the two pieces of **product logic** the mockups' promises depend on: a draft that never fires below a full room, and a proof strip that renders only real numbers.

**Architecture:** Six strands. **(1) One palette, retoned, not a second design system.** `src/design/tokens.ts` stays the only file in the repo with a color literal; v2 is a *retone* of the roles that already exist plus new roles the mocks genuinely need, and the theme axis collapses to one committed look. **(2) A shell, at last.** Today every signed-in page hand-rolls `AppHeader` plus `max-w-4xl`, which is why the product reads as a document and not as a place; v2 is a 64px league rail plus a state-bearing top bar plus a full-bleed content column, rendered once in `AppShell` and consumed by every page under `/app`. **(3) Density is primitives, not utility soup.** Every repeated shape in the three mocks (the panel with an uppercase header and a right-aligned note, the crest, the seat meter, the state pill, the meter bar, the dense table) becomes a primitive in `src/components/ui/` the first time it appears in two places, per the founder's centralization rule, and the existing consumer is refactored onto it in the same commit. **(4) The screens land in founder-priority order:** Front Door, join flow and Waiting Room, Locker Room, league space, draft room. **(5) Roll until full is server-side truth.** `autoStartDueDrafts` today starts any public matchmade draft whose kickoff has passed with as few as two seated teams; the founder's ruling is that no draft ever fires below a full room, so the platform door grows a fullness precondition, an unfilled target **rolls forward** with a guarded write, every seat is told, and a member who no longer wants to wait may **release the seat**, which is what keeps the roll humane instead of a trap. **(6) Every number on the front door is a query or it is not on the page.** Three proof stats, three credibility floors, and a row that hides rather than a number that flatters.

**Tech Stack:** Unchanged. TypeScript strict · Next.js 15 App Router · React 19 · Drizzle ORM over Postgres 17 (`drizzle-orm/postgres-js`) through PgBouncer in transaction mode · Redis 7 (Streams → SSE) · WorkOS AuthKit · Zod v4 · Vitest + happy-dom + @testing-library/react + vitest-axe · Playwright. **This plan adds no dependency and removes one font** (`Barlow_Condensed`, ruling 6).

**Spec:** The founder's directive of 2026-08-22 quoted above, and the three founder-approved mockups, which are the specification for layout, density and identity: `v2-front-door.html` (logged-out front door: hero, three-step seat-claim strip, open-league shelf with seat dots, HOUSE badges, filters), `v2-locker-room.html` (the multi-league signed-in home: 64px league rail, dense full-width board, live strips), `v2-waiting-room.html` (post-join). The two persona gauntlets already run against them, with their revisions applied to the mocks, are the input backlog: `locker-room-panel.md` and `join-flow-panel.md`. Both are reproduced by finding in the deferral table at the bottom, so this plan can be executed without them.

**Depends on Phase 3.5 merged to `main`** — both the base plan (`2026-08-22-phase3p5-competitiveness.md`, Tasks 1 to 11) **and** the house addendum (`2026-08-22-phase3p5-addendum-house-leagues.md`, Tasks 12 to 16). It builds directly on those surfaces: `WaitingRoom`, `CreateLeagueForm`, `PublicLeagueList`, `StandingsTable`, `SlotPreferencePanel`, `Countdown`, `LeagueAuthority`, the house catalog and the browse shelf. **Nothing here regresses their behavior**; where a task changes a tested assertion it says so and updates the spec in the same commit.

**This is an interstitial phase, exactly as 3.5 was.** `plans/00-roadmap.md`'s nine phases are unchanged and Phase 4 (payments) remains the next roadmap phase. Task 14 records 3.6 in the roadmap as a founder-ordered design pass.

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the codebase's own rules, restated in full so a worker executing Task 9 never has to hold three documents open.

**From `docs/conventions.md`:**

- **Directive: no MVP.** *"I don't want an MVP. Let's work towards the end solution."* Phases sequence **scope**, not quality. This is why the seat hold is a real server-side reservation rather than a client countdown, why the roll is a stored time rather than a sentence, and why a proof number without a query behind it does not render at all.
- **Stack is pinned.** Postgres 17 via Drizzle ORM (`drizzle-orm/postgres-js`, `postgres` driver). Redis 7 Streams → Server-Sent Events is *"the one and only real-time mechanism."* Auth is WorkOS AuthKit: *"We do not roll our own auth."* Validation is Zod v4 (`z.email()`, not the deprecated `z.string().email()`).
- **`docker-compose.yml` pins a top-level `name: fantasy`**, so every git worktree resolves to the **same** Compose project. Run `npm run infra:up` from any worktree.
- **Immutability.** Domain types are `readonly`; update by spreading into new objects. Enforced for `src/domain/**` by `eslint-plugin-functional`. **This plan writes nothing into `src/domain`** (ruling 24). `TOKENS` stays an `as const` tree and every new vocabulary here is a `readonly` tuple or `as const` object with its union derived from it.
- **Timing — no ambient clock in domain/reducer code.** Anything time-dependent takes a `Clock` (`src/domain/timing.ts`) and calls `clock.now()`. `Date.now()` / `new Date()` are only allowed at the outermost edge (route handlers, `current-user.ts`, `publisher.ts`, `src/draft-service/index.ts`'s `systemClock`). **The roll and the seat hold are both clock-shaped and both obey it**: `nextKickoffAfter` and `holdExpiresAt` are pure functions of instants passed in, and the ticker and the route handler are the only places that read a real clock.
- **Identity — one seam, WorkOS underneath.** Server code reads "who is this" **only** via `getCurrentUser()` / `requireCurrentUser()`. `users.id` **is** the WorkOS user id. API and SSE routes never redirect; they return a JSON 401 themselves. **`teamId` and `weekNumber` are always resolved from the authenticated session and the server's own schedule, never from a request body.** The seat hold is **not** an identity: it is a capacity reservation keyed by an opaque token in an httpOnly cookie, held by a visitor who has not signed in yet, and it grants nothing except the right to find a seat still there. **There is no dev auth bypass and this plan adds none** (ruling 16).
- **Real-time — one mechanism.** Writes are plain HTTP: validate → persist to Postgres → then `getPublisher().publish(...)`. **Postgres is authoritative; publishing is best-effort and must never fail the write.** Delivery is Redis Streams over SSE, read with plain `XREAD BLOCK`. **Never `XREADGROUP`.** **This plan adds no realtime event type** (ruling 21): a rolled kickoff and a released seat reach their members on Plan A's `notice.created`, and live seat counts for signed-out visitors are explicitly deferred (deferral D4).
- **Draft state — the action log is the source of truth.** The reducer may read only the action log and prior state, never a module-level tunable. **This plan does not touch `src/draft-engine` at all**: rolling a kickoff is a scheduling fact outside the reducer, exactly as `kickoff_at` already is.
- **Client boundary.** Everything under `src/draft-room/**`, `src/league-room/**`, `src/chat-room/**`, `src/admin-room/**` and `src/account-room/**` is BROWSER code and talks to its service layer ONLY over the wire — never by importing `@/draft-engine`, `@/draft-service`, `@/league`, `@/league-service`, `@/chat-service`, `@/ai-advisor`, `@/review-service`, `@/identity-service`, `@/integrity`, `@/integrity-service`, `@/db`, `@/lib/realtime`, `@/lib/auth`, `@/lib/leagues`, `@/lib/llm`, `@/lib/api/respond`, `@/data/seed`, `@/stats-pipeline`, `@/stats` or `@/gifs` as VALUES. `import type` stays allowed. The exempt pure directories are the eight already on the list: `src/chat`, `src/matchmaking`, `src/identity`, `src/help`, `src/reviews`, `src/moderation`, `src/trades`, `src/participation`. **This plan adds no ninth** (ruling 24), which is exactly why the roll's vocabulary lands in `src/matchmaking` — the waiting room and the browse card need the same sentence the server enforces. **`src/components/**` and `src/design/**` are neither browser-boundary-listed nor blocked**: they are shared UI and are imported by both sides today, and this plan does not change that. The rule is deliberately **not** applied to `src/app/**`.
- **API responses.** Every JSON route returns the envelope from `src/lib/api/respond.ts`: `{ ok: true, data }` or `{ ok: false, error }` with a meaningful HTTP status. Bodies are parsed with `parseJson(request, ZodSchema)`; a bad body is a 400 naming the field. **Error strings are user-facing plain language — never raw DB/exception text.**
- **Config over magic numbers.** Thresholds, limits, durations and key formats live in a `config.ts` next to the module that uses them. This plan adds fields to `MATCHMAKING_CONFIG` (the roll cadence, the seat hold, the proof floors) and to `UI_CONFIG` (the rail, the meter, the countdown's hero size) and adds **no new `config.ts`** (ruling 23).
- **Tests. Test-first.** Tests live beside the code: `src/<feature>/**/*.test.ts`. Verification commands filter by directory: `npm test -- src/league-service`, never by a guessed filename. Integration tests hit the **real** test Postgres / Redis from docker-compose — not mocks. Use `createTestDb()` + `truncateAll(db)` in `beforeEach`. Test files run serially (`fileParallelism: false`).
- **The no-write-before-a-committed-refusal test class.** Every refusal path of a transaction that has already written anything is asserted to have left the world unchanged. This plan adds **three** such transactions and therefore three such helpers — `expectNoSeatHoldTookPlace`, `expectNoRollTookPlace`, `expectNoSeatReleaseTookPlace` — each asserted on **every** refusal path of its writer, not on a representative one.
- **FK-lock enumeration in every lock-order entry.** Every transaction this plan adds or extends enumerates its implicit foreign-key `FOR KEY SHARE` acquisitions by name in its own docblock, and `src/integrity-service/lock-order.test.ts` grows one entry per writer added — **three** of them (the seat hold, the roll, the seat release). The task that touches that suite **reads its current count off the file** rather than trusting a number written here: Phase 3.5 moved it to 14 and the house addendum moved it again, and a plan quoting a count it did not measure is how a green test starts describing yesterday.
- **Coverage threshold: 100%** for the gated directories, configured in `vitest.config.mts` with `coverage.include` **and** a matching `thresholds` block. **Twenty-one** gated directories; **this plan adds none** (ruling 24) and places every new module inside one that is already gated: `src/matchmaking/roll.ts` and `src/matchmaking/seat-hold.ts` (gate 6), `src/league-service/seat-hold.ts`, `src/league-service/roll.ts`, `src/league-service/release.ts` and `src/league-service/proof.ts` (gate 17). **`src/design/**` and `src/components/**` are not gated and this plan does not gate them** — that hole is stated, not hidden, and ruling 24 says why fixing it belongs in its own piece of work. Verify with an **unfiltered** `npm run test:coverage`.
- **Browser end-to-end** lives in `e2e/` and runs under Playwright against a production build and the real docker-compose stack (`npm run e2e`). It authenticates with a sealed WorkOS test-directory session. `playwright.config.ts` pins `workers: 1` and `fullyParallel: false`. **The suite is 17 tests across 8 spec files today** (`enforcement` 3, `season` 5, `formats-and-lobby` 3, `onboarding` 2, `league-lifecycle` 1, `live-scoring` 1, `mobile-360` 1, `trades` 1) and **every one of them must be green at the end of every task in this plan.**
- **Two e2e disciplines this repo learned the hard way, and both bind every spec here.** **(a) The SSR fake:** a server-rendered control is visible and "stable" before React attaches its handler, so a click that lands pre-hydration is a silent no-op with no request on the wire. Every interaction assertion is **click-and-verify, retried** against a receipt the click itself produces (`e2e/league-lifecycle.spec.ts:140-160` is the pattern). **(b) Hardcoded counts:** count assertions are **relative** or derived from the page.
- **The e2e-under-redesign rule, new here and binding for the whole plan.** A redesign moves structure, and structure is what a selector grabs. **Assertions on user-facing copy survive by default** — a task that changes a string the suite asserts changes the spec in the SAME commit and says so in the commit body. **Assertions on structure (a role, a landmark, a test id) may be updated deliberately**, never loosened: replacing `getByRole("heading", …)` with a substring search over `body` is how a suite stops testing anything. Any spec touched by a task is re-run by that task, and the closing battery in Task 14 runs the whole suite twice.
- **Migrations.** `ADD COLUMN … NOT NULL` without a `DEFAULT` is acceptable only while the table is empty; once deployed, add with a DEFAULT or backfill separately. **Nothing in this repo uses `CONCURRENTLY`** — index builds are a deploy-era runbook step. This plan ships **two** migrations, both additive: the seat-hold table and the two `drafts` columns the roll needs.
- **Commits.** Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`). Commit after every completed step; commit bodies explain *why* and record any deviation from the plan.
- **Environment.** `.env.example` is committed; `.env.local` is gitignored. **This plan adds no environment variable.**
- **Verification commands (every step):** `npm run typecheck && npm run lint && npm test && npm run build`

**From `docs/design-system.md` (as it stands before this plan rewrites half of it):**

- **No raw hex, no raw px, no arbitrary values in feature code.** `src/design/tokens.ts` is the only file in the repo allowed to contain a color literal. **This survives v2 unchanged and is the single most load-bearing rule in this plan** — the three mocks are 900 lines of raw hex between them, and every one of those values lands in `tokens.ts` or it does not land.
- **Never a dead end.** Empty and error states always offer an action (`StatePanelProps.action` is required, not optional). **This plan's hardest cases are the race loser** (the seat was taken while they were signing in) and **the rolled draft** (the night they planned for is not happening), and each gets a real action rather than an apology.
- **Both themes are first-class.** **This plan overturns that rule, deliberately and with the argument written down** (ruling 1). It is the only rule in this document that v2 repeals.
- **Mobile-first**, minimum viewport 360px. WCAG 2.2 AA.
- **Copy.** Plain language, active voice, specific. Errors say what happened and what to do next.
- **`Icon` is the one icon entry point.** Feature code never imports `lucide-react` directly. The eighteen `IconName`s: `trophy`, `users`, `clock`, `alert-triangle`, `inbox`, `refresh-cw`, `check`, `x`, `chevron-right`, `search`, `info`, `shield`, `flame`, `anchor`, `rocket`, `crown`, `bolt`, `clover`. **This plan adds exactly one** (ruling 22): `plus`, for the rail's "join or create another league" control, which has no honest spelling among the eighteen.
- **`PositionBadge` is the only way to render a position label; `SlotChip` is the only way to render a roster-slot letter that is not itself a position.**
- **Never set the display face on a paragraph.**
- Tunables for primitives live in `src/components/ui/config.ts` — never inline in a component.

**Founder rules (binding, from founder memory and the phase ledgers):**

- **Design bar: premium and dense.** *"Most premium in fantasy; sleek, dense, full-width, efficient workflows; best-app-ever bar; direction approval from mockups before mass implementation."* The direction is approved; this is the mass implementation.
- **Centralize UI primitives the first time.** *"No page-local visual mappings; extract to `components/ui` and refactor the existing consumer in the same commit."* Task 3 exists because of this rule and nothing else.
- **House leagues are the core.** *"View and join like FFPC and Apex."* The Front Door's shelf and the Locker Room's open-seats panel are the v2 rendering of the house catalog the addendum built.
- **Half-PPR is the scoring foundation, full PPR one tap away.** Already true after Phase 3.5 Task 1; v2 renders it, it does not re-decide it.
- **No em-dashes in user-facing copy**, and here that rule has teeth: `copyViolations` (`src/integrity/copy-rules.ts`) enforces three rules — no em **or en** dash, nothing in `INTEGRITY_CONFIG.notices.accusatoryTerms`, nothing in `INTEGRITY_CONFIG.notices.passiveConstructions` — through five sweeps (`notices.test.ts`, `activity-view.test.ts`, `rendered-copy.test.tsx`, `room-copy.source.test.ts`, `script-copy.source.test.ts`). **This plan writes more user-facing copy than any plan since Phase 1**, and the sweeps are what keep it honest. Every new component file is added to `rendered-copy.test.tsx`'s roster in the task that creates it, not in Task 14.
- **Persona-panel pass on every new user-facing surface**, marked as an explicit step. **Five panels here** (Tasks 5, 6, 9, 10, 14).
- **No mock data on real surfaces.** The proof strip, the live pill, the seat meter and the board's every column render from real queries or do not render.
- **Verification agents never write review artifacts and never commit.** Standing dispatch rule; every review dispatch in this plan repeats it.

---

## What is already true (read before touching anything)

Checked against this worktree at `9437486` (Phase 3.5 base plus the house addendum in flight). Six of these change the shape of the plan.

| The mockups assume | Reality in the code today |
|---|---|
| There is a shell to put a rail into | **There is not.** Every page under `/app` hand-renders `<AppHeader …/>` plus `<main className="mx-auto … max-w-4xl p-4">` itself (`src/app/app/page.tsx:49-58` is the pattern, repeated across all eleven `page.tsx` files under `/app` and, in its public form, across the three outside it). `AppHeader` is a single centered 896px row. There is no layout file below `src/app/layout.tsx`, no shell component, and no place a league rail could live without being pasted eleven times. Task 2 is therefore not a reskin, it is the first shell this product has had. |
| The product can be dark | **It can be dark and light, and nobody can choose.** `ThemeProvider` manages `system \| light \| dark` and stamps `data-theme`, but **`useTheme` has zero consumers outside its own file and test** — there is no theme switcher anywhere in the product. The only thing that selects a theme today is the OS. Ruling 1 turns on that fact. |
| Both-theme test coverage will be expensive to unwind | **It is 331 calls across 100 files, and not one of them uses the theme argument.** `inBothThemes(ui, assert)` passes `(r, theme)`; a grep for a call site that reads the second parameter returns nothing outside the helper's own definition. The collapse is therefore a rename, compiler-enforced. |
| The board can show a live "moment" and a win probability | **Neither exists and one of them cannot exist yet.** There is no play-by-play feed, no per-player game state on the wire (`MatchupSummary` carries `homeScore`/`awayScore`/`final`/`weekStatus` and nothing per player), and no projection or win-probability model anywhere in `src/`. Deferrals D1, D2 and D3 rule all three out with the data fact that would have to change first. |
| A scheduled public league waits for a full room | **It does not, and this is the bug the founder's ruling names.** `dueDraftsQuery` selects `drafts` where `status = 'scheduled' AND kickoff_at <= now` joined to `ENFORCED_LEAGUE_SQL`, with **no seat predicate at all**, and `store.startDraft`'s only size guard is `reduceStart`'s own `draftOrder.length >= 2`. A public matchmade league with three of twelve seats filled, whose kickoff passes, **drafts with three teams today**. Task 7 is the fix and it is product logic, not messaging. |
| A member can leave a league they are waiting in | **There is no leave path of any kind.** No route, no service function, no UI. The persona gauntlet filed it as HIGH twice ("no answer to can I quit"), and the roll makes it structural rather than nice-to-have: a league that rolls forward forever with no exit is a trap the roll itself creates. Task 8. |
| A seat can be held while somebody signs up | **Nothing holds anything.** `joinLeagueInTx` takes `leagues FOR UPDATE`, counts seats and inserts a team; capacity is checked at the instant of the insert and never before. The front door's step 01 (*"Your seat holds for 10 minutes"*) is a promise with no mechanism, which is exactly the class of copy this codebase refuses to ship. Task 6. |
| The front door can quote numbers | **Two of the three have no query and the third has no aggregate.** There is no "leagues filled" count, no "drafts in the next 48 hours" count, and `review-service` exposes `listReviews`/`submitReview`/`myReview` with **no average and no total**. Task 4 writes all three, with floors. |
| Manager history tags are a rendering detail | **They would re-open a closed privacy decision.** `PublicLeagueSummary.compositionCategory` was deliberately reduced to a coarse server-side bucket because *"an aggregate over N=1 is not an aggregate"* — a per-member "3rd season on Commish" tag in a room list discloses exactly the per-manager tier that reduction exists to hide. Refused, not deferred (ruling 19). |
| The `Countdown` primitive is new work | **It shipped in Phase 3.5 Task 8** (`src/components/ui/countdown.tsx`, `UI_CONFIG.countdown`, `useCountdown`, `formatCoarseRemaining`) with three callers already refactored onto it. v2 adds one size and changes nothing else. |
| The draft room needs restructuring | **It does not.** `RoomLayout` is already a full-bleed `100dvh` frame with fixed bands, scrolling regions and a documented linearize-below-`lg` rule — it is the one surface in the product that already obeys the founder's full-width brief. Task 12 retones it and leaves its structure alone. |

---

## File Structure

**New — pure modules, every one inside an already-gated directory:**

| File | Responsibility |
|---|---|
| `src/matchmaking/roll.ts` | `ROLL_CADENCE_MINUTES`, `nextKickoffAfter`, `rollNoticeSentence`, `describeStartTiming`. The roll as arithmetic over explicit instants, plus the one sentence a browse card, a waiting room and a notice all say. Browser-safe on purpose. Gate 6. |
| `src/matchmaking/seat-hold.ts` | `SEAT_HOLD`, `holdExpiresAt`, `holdIsLive`, `describeHold`, `SEAT_HOLD_REFUSALS`. The hold's arithmetic and its vocabulary, browser-safe so the interstitial's countdown and the server's expiry are the same rule. Gate 6. |
| `src/league-service/seat-hold.ts` | `claimSeatHold`, `releaseSeatHold`, `consumeSeatHoldInTx`, `liveHoldsFor`. The reservation, transactional. Gate 17. |
| `src/league-service/roll.ts` | `rollUnfilledDraftInTx`, `rollDueDrafts`, `ROLL_REFUSALS`, `roomIsFull`. The platform door's fullness gate and the guarded roll write. Gate 17. |
| `src/league-service/release.ts` | `releaseSeat`, `RELEASE_REFUSALS`. A member leaving a league that has not drafted. Gate 17. |
| `src/league-service/proof.ts` | `proofStats`, `PROOF_FLOORS` consumer, `ProofStats`. Three counts, three floors, one hide decision. Gate 17. |

**New — UI primitives (`src/components/ui/`), each extracted at its second real caller:**

| File | Responsibility |
|---|---|
| `panel.tsx` | `Panel` — the bordered surface with an uppercase eyebrow header and an optional right-aligned meta note. The single most repeated shape in all three mocks. |
| `crest.tsx` | `Crest` — a league's identity tile: deterministic initials on a deterministic tone, `size: sm\|md\|lg`, with an optional state dot. |
| `seat-meter.tsx` | `SeatMeter` — the seat dots plus their sentence, with the dots `aria-hidden` and the sentence the accessible name. |
| `meter.tsx` | `Meter` — a value bar with a label pair (fill progress, score margin). Never a bare bar: the number is always beside it. |
| `stat-pill.tsx` | `StatPill` — LIVE / FINAL / FIX LINEUP, the tone-carrying state chip. |

**Modified — the design system:** `src/design/tokens.ts` (the v2 palette, new roles, the dense type scale, retired light palette), `src/design/generate-css.ts` + `tokens.css` (one theme block, a responsive type block), `src/design/tokens.test.ts`, `src/design/test-support.ts`, `src/design/theme-provider.tsx` (**deleted**), `src/app/globals.css`, `src/app/layout.tsx` (fonts), `src/components/ui/test-utils.tsx` (`inBothThemes` → `renderSurface`), `src/components/ui/config.ts`, `src/components/ui/index.ts`, `badge.tsx`, `table.tsx`, `countdown.tsx`, `icon.tsx`, `card.tsx`, `page-title.tsx`, `state-panel.tsx`.

**Modified — the shell:** `src/components/app-shell/app-header.tsx` (becomes `top-bar.tsx`), plus new `app-shell.tsx`, `league-rail.tsx`, `shell-data.ts` and the new route-group layout `src/app/app/(shell)/layout.tsx`; every `page.tsx` under `src/app/app/**` (eleven of them, nine of which move into the `(shell)` group) plus `src/app/browse/page.tsx`, `src/app/reviews/page.tsx` and `src/app/page.tsx`.

**Modified — the lobby and the season:** `src/league-service/browse.ts`, `join.ts`, `fill-trigger.ts`, `draft-schedule.ts`, `read.ts`, `home.ts`, `src/matchmaking/contract.ts` + `config.ts` + `filter.ts`, `src/draft-service/auto-start.ts` + `ticker.ts` + `config.ts`, `src/db/schema.ts`, `src/league-room/contract.ts` and fourteen components under `src/league-room/components/**`, `src/draft-room/components/**` (retone only), `src/help/glossary.ts`.

**Modified — integrity:** `src/integrity/system-actions.ts` (two codes, two compile-forced visibilities), `src/integrity/notices.ts` (two templates), `src/integrity/test-support.ts`, `src/integrity/rendered-copy.test.tsx` (every new component), `src/integrity-service/lock-order.test.ts` (three writers).

**New routes:** `src/app/api/public/leagues/[leagueId]/hold/route.ts` (`POST`/`DELETE`), `src/app/api/leagues/[leagueId]/seat/route.ts` (`DELETE`), `src/app/join/[leagueId]/hold/page.tsx` (the interstitial).

**New migrations:** `drizzle/0033_seat_holds.sql`, `drizzle/0034_roll_until_full.sql`.

**New docs:** `docs/decisions/design-v2.md`.

**Modified docs:** `docs/design-system.md` (substantially rewritten), `docs/conventions.md`, `docs/league.md`, `docs/draft-room.md`, `docs/decisions/enforcement-and-tiers.md`, `docs/decisions/formats-and-lobby.md`, `docs/decisions/house-leagues.md`, `plans/00-roadmap.md`, `README.md`.

**New e2e:** `e2e/design-v2.spec.ts`. **Modified e2e:** `mobile-360.spec.ts`, `formats-and-lobby.spec.ts`, `season.spec.ts` (structure only, deliberately, in the task that moves the structure).

---

## Task 1: The v2 palette, and one committed look

The retone lands first because everything after it renders in it. This task changes no layout and no copy: it changes what the existing components are made of, so that Task 2 onward can be judged on shape rather than on color.

**Files:**
- Modify: `src/design/tokens.ts` (+ `tokens.test.ts`), `src/design/generate-css.ts` (+ its test), `src/design/tokens.css` (generated), `src/design/test-support.ts`, `src/app/globals.css`, `src/app/layout.tsx`
- Delete: `src/design/theme-provider.tsx`, `src/design/theme-provider.test.tsx`
- Modify: `src/components/ui/test-utils.tsx` and every `*.test.tsx` that calls `inBothThemes` (100 files, mechanical)
- Modify: `docs/design-system.md`

**Interfaces:**
- Consumes: `TOKENS`, `renderTokensCss`, `contrastRatio` (`@/design/test-support`).
- Produces: a single `Palette`, `ColorRole` with its new members, `TOKENS.font.sizeDense`, `renderSurface`.

- [ ] **Step 1: Write the failing token tests, including the three the mocks fail**

`tokens.test.ts` keeps its numeric contrast machinery and loses its theme loop. Three assertions are new, and each of them **fails against the mock's own hexes**, which is the point of writing them first:

```ts
// src/design/tokens.test.ts
it("keeps every text role readable on every surface it is used on", () => {
  // The mock's --faint (#6B7488) is used at 12px for card meta, step captions and table subs.
  // Against --panel2 (#161920) it measures 3.75:1, below the 4.5:1 WCAG 1.4.3 floor for normal
  // text. The token moves; the threshold does not. (join-flow-panel.md, "Accessibility smells".)
  for (const role of ["textPrimary", "textMuted", "textFaint"] as const) {
    for (const surface of ["surface", "surfaceElevated", "surfaceRaised", "surfaceInset"] as const) {
      expect(contrastRatio(TOKENS.color[role], TOKENS.color[surface])).toBeGreaterThanOrEqual(4.5);
    }
  }
});

it("gives an interactive boundary its own role, because the hairline cannot carry one", () => {
  // --line (#20242E) measures 1.26:1 against --bg. That is correct for a DECORATIVE separator
  // between two panels and is nowhere near WCAG 1.4.11's 3:1 for the boundary of a control a
  // user must find. v2 therefore ships BOTH: `line` separates, `edge` bounds.
  expect(contrastRatio(TOKENS.color.line, TOKENS.color.surface)).toBeLessThan(3);
  for (const surface of ["surface", "surfaceElevated", "surfaceRaised"] as const) {
    expect(contrastRatio(TOKENS.color.edge, TOKENS.color[surface])).toBeGreaterThanOrEqual(3);
  }
});

it("prints a readable label on every fill that carries one", () => {
  expect(contrastRatio(TOKENS.color.accentText, TOKENS.color.accent)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(TOKENS.color.negativeText, TOKENS.color.negative)).toBeGreaterThanOrEqual(4.5);
});

it("has exactly one palette, so no surface can exist in a theme nobody designed", () => {
  expect(Object.keys(TOKENS.color).sort()).toEqual([...COLOR_ROLES].sort());
  expect(TOKENS).not.toHaveProperty("color.light");
});
```

- [ ] **Step 2: The palette**

`ColorRole` keeps its twelve members and gains eight: `surfaceRaised`, `surfaceInset`, `edge`, `textFaint`, `info`, `accentGlow`, `warningGlow` — and `border` is **renamed** to `line`, which is a compile-forced sweep across every `border-border` utility, and that is why it is a rename rather than an addition. The values:

```ts
/** v2 — the room at night. One palette, committed (ruling 1). */
const palette: Palette = {
  surface: "#0B0C0F",        // the ground
  surfaceElevated: "#111318", // a panel
  surfaceRaised: "#161920",   // a row hover, a field, a nested tile
  surfaceInset: "#1C2029",    // a track, a slot well, an unfilled meter
  line: "#20242E",            // the decorative hairline between two surfaces
  edge: "#6B7488",            // the boundary of a control a user must find (>= 3:1)
  textPrimary: "#EDEFF4",
  textMuted: "#98A0B2",
  textFaint: "#808A9E",       // retuned UP from the mock's #6B7488 to clear 4.5:1 at 12px
  accent: "#41E58A",
  accentText: "#04120A",
  accentGlow: "rgba(65, 229, 138, 0.14)",
  positive: "#41E58A",
  negative: "#FF5A52",
  negativeText: "#04120A",
  warning: "#FFB224",
  warningGlow: "rgba(255, 178, 36, 0.12)",
  info: "#5B9BFF",
  scrim: "#000000",
};
```

The hand-computed ratios these values were chosen against (`textMuted` 7.5:1 on `surface`, `textFaint` about 5:1 on `surfaceRaised`, `edge` 3.75:1 on `surfaceRaised`, `accent` 11.9:1, `info` 7.1:1, `warning` 10.9:1, `negative` 6.4:1) are re-derived by `tokens.test.ts`; if any value misses, **the token moves, never the threshold.**

`accent` and `positive` are **the same green, deliberately** — v2's identity is that a live game and a live action are the same energy. The existing "one pigment, two jobs" rule protected the doubling by keeping the two uses out of each other's context, and v2 keeps it with a sharper rule written into `docs/design-system.md`: **green is a fill only when it is an action; a positive outcome is green as text, a glow or a meter fill, never as a solid button-shaped block.** A `bg-positive` chip beside a `bg-accent` button is the bug that rule prevents.

The six position pigments stay six pigments and are re-derived against `#0B0C0F` rather than against the old charcoal — the sticker test (fifteen pairwise pairs, plus label-on-sticker and text-on-surface) is unchanged and is what proves the re-derivation landed. `AvatarTone` grows from five tones to six and becomes the source of **crest** color too (Task 3): a league crest and a member avatar drawing from one pack of markers is the same argument the position stickers already make.

- [ ] **Step 3: The type scale, twice**

The mocks are 13 to 14px on the desktop and that density is the brief; 13px body on a 360px phone is not. One source of truth, two emissions:

```ts
font: {
  /** Base scale, px — what a phone gets. */
  size: { xs: 12, sm: 13.5, md: 15, lg: 17, xl: 20, "2xl": 26, "3xl": 34 },
  /** The dense scale, emitted inside a min-width media query at UI_CONFIG.shell.denseFromPx. */
  sizeDense: { xs: 11, sm: 12.5, md: 13.5, lg: 15, xl: 17, "2xl": 22, "3xl": 30 },
  display: { sm: 20, md: 28, lg: 44, xl: 64 },
  lineHeight: { display: 1.06, tight: 1.2, base: 1.5 },
}
```

`renderTokensCss` emits the dense block inside `@media (min-width: …)`, so a component never writes `text-sm lg:text-xs` — density is a property of the viewport, expressed once. `generate-css.test.ts` asserts the media block exists and that both scales carry the same keys (a key present in one and missing from the other is a size that silently stops responding).

**`xs` is for letter-spaced uppercase eyebrows only, never a sentence.** That rule joins `docs/design-system.md` beside the display-face rule it resembles.

- [ ] **Step 4: One theme, and the 100 files that stop pretending otherwise**

`ThemeProvider` and its test are **deleted**, `layout.tsx` stops rendering it, `renderTokensCss` emits one `:root` block with no `[data-theme]` selector and no `prefers-color-scheme` block, and `inBothThemes` becomes:

```tsx
/** Renders once, in the product's one theme, and unmounts. */
export function renderSurface(ui: ReactElement, assert: (r: RenderResult) => void | Promise<void>) {
  return (async () => {
    const r = render(ui);
    try {
      await assert(r);
    } finally {
      r.unmount();
    }
  })();
}
```

The call-site change is `inBothThemes` → `renderSurface` across 100 test files and 331 call sites, and it is safe to do mechanically **because no call site reads the second callback argument** (verified: a grep for a `theme` parameter in a call site returns nothing). Deleting the old export is what makes the compiler enumerate any that were missed. `color-scheme: dark` on `:root` is what tells the browser to paint form controls and scrollbars to match.

- [ ] **Step 5: The fonts**

`Barlow_Condensed` is removed from `layout.tsx` and from the theme aliases. `font-display` **keeps its name and every one of its call sites** and now resolves to the Geist family at display sizes with `letter-spacing: -0.02em`; the condensed poster face is the single strongest "this is a prototype from 2010" signal in the current product, and the mocks are one family in two roles. `font-mono` is unchanged (Geist Mono) and gains one rule that the mocks apply everywhere and the product applies nowhere: **`font-variant-numeric: tabular-nums` is on `.font-mono` itself**, so a score that changes never shifts the column beside it.

- [ ] **Step 6: Sweep, and prove nothing renders in a color it invented**

A source test in `src/design/` walks every `.tsx` under `src/components`, `src/league-room`, `src/draft-room`, `src/chat-room`, `src/account-room`, `src/admin-room` and `src/app` and fails on a hex literal, an `rgb(`/`rgba(` literal, or a Tailwind arbitrary-value bracket that contains one. The rule already existed in prose; three phases of review caught violations by eye. v2 is where it gets a test, because this plan is about to write more class strings than any plan before it.

- [ ] **Step 7: Commit**

---

## Task 2: The shell — a rail, a bar, and the whole screen

The founder's "maximize full screen width" is one line of the brief and the largest single change in the plan: fifteen pages currently render their own 896px column. This task builds the frame the mocks are drawn on and moves every page into it.

**Files:**
- Create: `src/components/app-shell/app-shell.tsx`, `league-rail.tsx`, `shell-data.ts` (+ their tests), `src/app/app/(shell)/layout.tsx` (+ its test)
- Modify: `src/components/app-shell/app-header.tsx` → `top-bar.tsx` (+ its test), `src/league-service/read.ts` (+ its test), `src/league-room/contract.ts`
- Move (route groups, no URL changes): the nine shell pages into `src/app/app/(shell)/**`, the draft room into `src/app/app/(room)/drafts/[draftId]/**`, the invite landing into `src/app/app/(public)/join/[code]/**`
- Modify: every `page.tsx` under `src/app/app/**`, plus `src/app/browse/page.tsx` and `src/app/reviews/page.tsx`
- Modify: `src/app/app/admin/admin-routes.test.ts` → `src/app/app/(shell)/admin/admin-routes.test.ts` (its path glob only, in the commit that moves the files; the gate it asserts does not move, and the addendum's Task 19 still does not edit it)
- Modify: `src/components/ui/config.ts`, `src/components/ui/icon.tsx` (+ its test), `e2e/mobile-360.spec.ts`

**Interfaces:**
- Consumes: `requireCurrentUser`, `crossLeagueHome`, `leagueAuthority`, `nextActionFor`, `NoticeInbox`.
- Produces: `AppShell`, `LeagueRail`, `TopBar`, `RailLeague`, `shellData`, `UI_CONFIG.shell`, `IconName["plus"]`.

- [ ] **Step 1: Write the failing shell tests**

```tsx
// src/components/app-shell/app-shell.test.tsx
it("renders one banner, one navigation and one main, so a screen reader hears a place", () => {
  renderSurface(<AppShell {...props} />, ({ getAllByRole }) => {
    expect(getAllByRole("banner")).toHaveLength(1);
    expect(getAllByRole("navigation", { name: "Your leagues" })).toHaveLength(1);
    expect(getAllByRole("main")).toHaveLength(1);
  });
});

it("marks the league the current URL belongs to, by aria-current and not by color", () => {
  // The rail reads the path it is standing on rather than being told: `usePathname()` is the
  // fact, and it is why the shell can live in a layout at all (ruling 8, as amended).
  mockPathname("/app/leagues/lg_bandits/matchups/3");
  renderSurface(<LeagueRail {...railProps} />, ({ getByRole }) => {
    expect(getByRole("link", { name: /Bay Bandits/ })).toHaveAttribute("aria-current", "page");
  });
});

it("gives every crest an accessible name that is the league's real name, never its initials", () => {
  // The rail is six 40px tiles reading "BB", "TS", "GH". Initials are a VISUAL compression and
  // are meaningless read aloud; the accessible name is the league, and the state dot is words.
  // The action half of the name is the one string COPY owns in `next-action.ts` (C2, F1).
  renderSurface(<AppShell {...props} />, ({ getByRole }) => {
    expect(getByRole("link", { name: "Volt Kings. Fix your lineup." })).toBeInTheDocument();
  });
});

it("keeps the rail reachable at 360px by becoming a horizontal strip, not by disappearing", () => {
  renderSurface(<AppShell {...props} />, ({ getByTestId }) => {
    expect(getByTestId("league-rail").className).toMatch(/overflow-x-auto/);
    expect(getByTestId("league-rail").className).not.toMatch(/hidden/);
  });
});
```

- [ ] **Step 2: The frame, and the layout that renders it**

**Amended by the UX coherence review of 2026-08-23 (F8), which reversed ruling 8.** The shell is rendered **once, by a layout**, not by each page: a page-rendered shell means `/app/loading.tsx` suspends the rail and the top bar too, so every intra-app navigation blanks the chrome the rail exists to provide. The reason ruling 8 gave for the page-rendered version (a layout cannot receive the page's `currentLeagueId`) does not hold: `usePathname()` gives the rail the current league id on the client, which is where `aria-current` is applied anyway.

```tsx
export interface AppShellProps {
  readonly user: { readonly displayName: string; readonly avatar: string | null; readonly isAdmin: boolean };
  readonly rail: readonly RailLeague[];
  /** The one live fact the top bar carries. `null` outside a game window (ruling 12). */
  readonly liveState: LiveState | null;
  readonly children: ReactNode;
}
```

There is no `currentLeagueId` prop. `LeagueRail` is a client component that derives the current league from `usePathname()` (every league URL is `/app/leagues/{id}…`), so the shell needs no per-page argument and a layout can own it.

`src/app/app/(shell)/layout.tsx` is an async server component that calls `shellData(db, await requireCurrentUser())` and returns `<AppShell …>{children}</AppShell>`. **Three segments under `/app` render no shell at all** and therefore live in sibling route groups: the draft room (`src/app/app/(room)/drafts/[draftId]/**`) and the invite landing (`src/app/app/(public)/join/[code]/**`), with the TV board already outside `/app` at `src/app/draft/[draftId]/board`. **A route group changes no URL**, so nothing that links into `/app/drafts/…` or `/app/join/…` breaks — which is exactly the difference between this move and the route move the addendum's Task 21 rejects for the invite landing. The controller's ruling names the file `src/app/app/layout.tsx`; it lands at `src/app/app/(shell)/layout.tsx` because a route group is the only way a segment under `/app` can decline an ancestor layout, and declining it is what "the draft room renders no shell" means in App Router terms.

The grid is `grid-cols-[var(--rail)_1fr]` at `lg` and a single column below it, with the rail re-sequenced above the content as a horizontal scrolling strip. The rail width, the crest size and the dense breakpoint are `UI_CONFIG.shell`, never inline. `<main>` is full-bleed with a `px` gutter from the spacing scale and **no `max-w-*` at all** — the founder's brief in one deletion. Long-form reading surfaces (the review feed, the glossary, a legal page) keep a `max-w-prose` on their own paragraph column, because a 2000px line of body text is not density, it is a defect; the rule lands in `docs/design-system.md` as **"full-bleed frames, measured paragraphs."**

- [ ] **Step 3: The rail's data, once**

`shellData(db, user)` returns `{ rail, liveState }` in one round trip, built on the reads `crossLeagueHome` already performs. **The `(shell)` layout calls it once per navigation** (ruling 8, as amended); a page that also needs `crossLeagueHome` for its own body still reads it itself, and nothing reads the rail twice. `RailLeague` is `{ id, name, shortName, tone, state }`, where `state` is derived from `nextAction.kind` and nothing else: **`needs-you` is exactly `fix-lineup` or `join-draft`**, `live` is a league whose week is in progress, and everything else is `quiet` (F1 — before Task 10 Step 1b there is no honest `fix-lineup`, and a needs-you dot on every league every week is a dot that means nothing). **Never a colored dot with no sentence behind it**: the dot is `aria-hidden` and the state is in the link's accessible name, in the words `COPY` owns (`"Volt Kings. Fix your lineup."`).

`shortName` is derived, not stored: the first letter of each of the first two words of the league name, uppercased, falling back to the first two letters of a one-word name. A derived initial cannot go stale against a renamed league, and there is no column to migrate.

- [ ] **Step 4: The top bar**

`AppHeader` becomes `TopBar` and keeps every control it has (wordmark, admin queue, `NoticeInbox`, profile, sign out), gains the live-state pill described in Task 10 Step 3, and stops being centered. The rename is one commit and the old name does not survive it. `e2e/mobile-360.spec.ts` asserts the header's controls are reachable at 360px; it is re-run here and updated in this commit if the structure moved.

- [ ] **Step 5: Fourteen pages stop drawing their own chrome**

**The counts, read off `src/app` in this worktree (F21):** fourteen `page.tsx` files in the product, **eleven of them under `/app`**. **Nine absorb the shell** — the locker room, `/app/leagues`, a league's home, its activity, its trades, a week's matchups, the profile, the operator queue and a flag's detail — and they absorb it by *being moved into the `(shell)` route group*, not by rendering it: each one drops its `<AppHeader/>` and its `<main className="mx-auto … max-w-4xl">` and returns its content alone, because `(shell)/layout.tsx` is now the thing that renders `AppShell` (Step 2). `/browse` and `/reviews` sit outside `/app` and render the shell themselves, only when there is a user (they are reachable signed out; the signed-out header is `PublicBar`, the addendum's Task 16, which Task 5 gives the front door's nav and CTA).

**Three carve-outs render no shell at all:** the draft room, the TV board, and `/app/join/[code]`. The first two are rooms — `RoomRail` is their header, and two chromes stacked breaks the room's no-page-scroll contract, exactly as `AppHeader`'s docblock already says. The third is signed-out reachable through the middleware's exemption, so a signed-in shell around it would be chrome a stranger cannot use; it renders `PublicBar` instead, and it is the reason the addendum's Task 21 gives it its own `loading.tsx` (F7).

The fourteenth page is the front door, which is the whole subject of Task 5.

- [ ] **Step 6: One new icon**

`plus` joins `IconName` for the rail's trailing "join or create another league" control. It is the eighteen-name list's first addition in three phases and it earns it: none of `chevron-right`, `search` or `inbox` means "another one of these", and a page-local `+` glyph in a `<span>` is the page-local visual mapping the founder rule forbids.

- [ ] **Step 7: Commit**

---

## Task 3: The primitives the mocks repeat

Five shapes appear between two and eleven times across the three mockups. Under the founder's centralization rule they are components before they are class strings, and the existing consumer is refactored onto each in the same commit.

**Files:**
- Create: `src/components/ui/panel.tsx`, `crest.tsx`, `seat-meter.tsx`, `meter.tsx`, `stat-pill.tsx` (+ their tests)
- Modify: `src/components/ui/index.ts`, `badge.tsx`, `table.tsx`, `countdown.tsx`, `card.tsx`, `config.ts` (+ their tests)
- Modify: `src/identity/avatars.ts` (+ its test) — `AvatarTone` grows to six and becomes the crest source
- Modify: `src/integrity/rendered-copy.test.tsx` (the five new components join the sweep)
- Modify: the existing consumers refactored in this commit: `league-members-panel.tsx`, `public-league-list.tsx`, `standings-table.tsx`, `home-league-card.tsx`, `week-status-badge.tsx`, `draft-schedule-panel.tsx`

**Interfaces:**
- Consumes: `Card`, `EYEBROW`, `Badge`, `Table`, `avatarTone`, `UI_CONFIG`.
- Produces: `Panel`, `Crest`, `SeatMeter`, `Meter`, `StatPill`, `Table`'s `density`, `Badge`'s `glow`, `Countdown`'s `size: "xl"`.

- [ ] **Step 1: Write the failing primitive tests**

```tsx
// src/components/ui/seat-meter.test.tsx
it("names the seats in words, and hides the dots from the accessibility tree", () => {
  // join-flow-panel.md, MEDIUM: the dot row encodes fill by color alone. The dots are
  // decoration for a sentence that is already on screen; they are not a second control.
  renderSurface(<SeatMeter filled={9} total={12} />, ({ getByText, getByTestId }) => {
    expect(getByText("9 of 12 seated")).toBeInTheDocument();
    expect(getByTestId("seat-dots")).toHaveAttribute("aria-hidden", "true");
  });
});

it("says how many are left only when the answer is small enough to matter", () => {
  renderSurface(<SeatMeter filled={11} total={12} />, ({ getByText }) => {
    expect(getByText("11 of 12 seated. 1 seat left.")).toBeInTheDocument();
  });
});

it("owns the seat sentence for the whole product, held seats included", () => {
  // F17. One seat count was being spoken three ways ("9 of 12 seated", "10 of 12 seats filled",
  // "4 of 12 seats taken") by two primitives. THIS TEST IS THE REFERENCE: `SeatMeter` composes
  // the sentence, every surface renders `SeatMeter`, and no caller writes a seat sentence of its
  // own. The held clause renders only when `heldSeats > 0` and says what it knows (Task 6).
  renderSurface(<SeatMeter filled={9} total={12} heldSeats={1} />, ({ getByText }) => {
    expect(getByText("9 of 12 seated. 1 seat is being claimed right now.")).toBeInTheDocument();
  });
});

// src/components/ui/meter.test.tsx
it("never renders a bar without its number, because a bar alone makes people estimate", () => {
  // public-league-list.tsx's own no-bar ruling, generalized: the bar is the glance and the
  // number is the decision. This primitive cannot be constructed without the number.
  renderSurface(<Meter label="Seats filled" value={10} max={12} />, ({ getByText }) => {
    expect(getByText("10 of 12")).toBeInTheDocument();
  });
});

// src/components/ui/crest.test.tsx
it("gives the same league the same tone forever, and different leagues different ones", () => {
  expect(crestTone("lg_bandits")).toBe(crestTone("lg_bandits"));
  expect(new Set(SEED_LEAGUE_IDS.map(crestTone)).size).toBeGreaterThan(1);
});
```

- [ ] **Step 2: `Panel`, and the eleven places it replaces**

```tsx
export interface PanelProps {
  readonly title: string;
  /** The right-aligned note in the header: "Closest first", "10 managers, 2 open seats". */
  readonly meta?: ReactNode;
  /** Renders as an `h2` by default; a page with its own heading order may pass `h3`. */
  readonly headingLevel?: 2 | 3;
  readonly children: ReactNode;
}
```

Built on `Card` plus `EYEBROW`, so the depth token and the eyebrow class each still have one home. Every "uppercase label, hairline, content" block in the product moves onto it in this commit.

- [ ] **Step 3: Extend rather than fork**

`Table` gains `density: "comfortable" | "dense"` (dense is the mocks' 11px vertical padding and is the default under the shell). `Badge` gains `glow: boolean` for the live pill's tinted ring, built on `accentGlow`/`warningGlow`. `Countdown` gains `size: "xl"` for the waiting room's hero clock. **Three extensions and five new files, and no second component named for something that already has one** — there is no `DenseTable`, no `LivePill`, no `HeroCountdown`.

- [ ] **Step 4: One pack of markers**

`AvatarTone` grows from five to six tones, retoned against `#0B0C0F`, and `Crest` renders on the same tones through the same deterministic hash the avatar already uses. A league's crest and its members' avatars come from one palette, which is what makes the rail and the room look like one object rather than two colorways.

- [ ] **Step 5: Commit**

---

## Task 4: Proof, real only

The front door's proof strip quotes three numbers. Two have no query in this codebase and the third has no aggregate. This task writes all three, gives each a credibility floor, and makes the row's absence the honest answer below it.

**Files:**
- Create: `src/league-service/proof.ts` (+ its test)
- Modify: `src/matchmaking/config.ts`, `src/matchmaking/contract.ts`, `src/review-service/reviews.ts` (+ its test), `src/db/index-plans.test.ts`

**Interfaces:**
- Consumes: `Db`, `drafts`, `leagues`, `reviews`, `ENFORCED_LEAGUE_SQL`, `Clock`.
- Produces: `proofStats`, `ProofStats`, `MATCHMAKING_CONFIG.proof`.

- [ ] **Step 1: Write the failing proof tests**

```ts
// src/league-service/proof.test.ts
it("counts a league as filled only once its draft actually ran", async () => {
  // "Leagues filled this season" is a claim about rooms that got to draft, not about rows.
  // A league sitting at 12 of 12 with a scheduled draft has not yet done the thing being
  // counted, and counting it would inflate the number by exactly the leagues most likely to
  // still fall over.
  await seedLeagues({ drafted: 3, full: 2, filling: 7 });
  expect((await proofStats(db, deps)).leaguesFilled).toBe(3);
});

it("counts only the drafts a visitor could actually still join, in the next 48 hours", async () => {
  const stats = await proofStats(db, { ...deps, clock: fixedAt("2026-09-10T12:00:00.000Z") });
  expect(stats.draftsNext48h).toBe(2); // the private league and the one 3 days out are excluded
});

it("hides a stat that has not earned belief yet, rather than printing a small number big", async () => {
  await seedReviews(MATCHMAKING_CONFIG.proof.floors.reviewCount - 1);
  expect((await proofStats(db, deps)).rating).toBeNull();
});

it("hides the whole strip when every stat is below its floor, and says nothing at all", async () => {
  await truncateAll(db);
  expect(await proofStats(db, deps)).toEqual({ leaguesFilled: null, draftsNext48h: null, rating: null, any: false });
});

it("reports the review count beside the average, because an average with no n is a slogan", async () => {
  await seedReviews(63, { average: 4.8 });
  expect((await proofStats(db, deps)).rating).toEqual({ average: 4.8, count: 63 });
});
```

- [ ] **Step 2: The floors, as config**

```ts
proof: {
  floors: {
    /** Below this, "N leagues filled this season" reads as a startup counting its friends. */
    leaguesFilled: 25,
    /** Below this, "drafts in the next 48 hours" is a schedule, not a signal. */
    draftsNext48h: 3,
    /** Below this, an average rating is one person's mood. */
    reviewCount: 20,
  },
},
```

Each floor is a number a visitor's skepticism is calibrated against, and each is stated in the config's own docblock rather than defended on the page. **The row hides per stat and the strip hides when all three hide** — there is no "coming soon", no placeholder and no rounded-up substitute, because the persona gauntlet's skeptic finding is that an unsourced number is worse than a missing one.

- [ ] **Step 3: Three queries, each bounded and each indexed**

`leaguesFilled` counts `leagues` joined to `drafts` where the draft's status is `in_progress` or `complete` and the league was created in the current season window. `draftsNext48h` counts `drafts` where `status = 'scheduled'` and `kickoff_at` is between now and now + 48h, joined on `ENFORCED_LEAGUE_SQL` so a private league's calendar is never disclosed in aggregate. `rating` is `avg(rating)` and `count(*)` over `reviews` that are not removed. All three are served by indexes that exist (`drafts_status_idx`, the browse index) and each gains an entry in `src/db/index-plans.test.ts` — the front door is the most-hit unauthenticated page in the product and a sequential scan there is a denial-of-service surface, not a slow page.

- [ ] **Step 4: The season window, named once**

"This season" is `LEAGUE_CONFIG`'s existing season boundary, read, not re-derived. A proof stat that quietly counted forever would grow into a number that says nothing about now.

- [ ] **Step 5: Commit**

---

## Task 5: The Front Door

The first surface a stranger sees, and the one the founder's "best app I've ever seen" bar is judged on hardest. Everything on it is either a query or a sentence this product can keep.

**Files:**
- Modify: `src/app/page.tsx` (+ a new test), `src/app/browse/page.tsx`, `src/league-room/components/public-league-list.tsx` (+ its test), `browse-filters.tsx` (+ its test)
- Create: `src/league-room/components/front-door-hero.tsx`, `seat-claim-steps.tsx`, `proof-strip.tsx`, `open-league-card.tsx` (+ their tests)
- Modify: `src/matchmaking/contract.ts`, `src/league-service/browse.ts` (+ its test), `src/help/glossary.ts`, `src/integrity/rendered-copy.test.tsx`

**Interfaces:**
- Consumes: `listPublicLeagues`, `proofStats`, `PublicLeagueSummary`, `describeStartTiming`, `SeatMeter`, `Panel`, `Crest`.
- Produces: `FrontDoorHero`, `SeatClaimSteps`, `ProofStrip`, `OpenLeagueCard`, `PublicLeagueSummary`'s roster and playoff facts.

- [ ] **Step 1: Write the failing front-door tests**

```tsx
// src/app/front-door.test.tsx
it("says what a seat costs, because a visitor who searched for money deserves an answer", () => {
  // join-flow-panel.md, HIGH: the page said nothing about money anywhere, which is honest but
  // reads as an omission to the one persona most likely to ask.
  renderSurface(<FrontDoorHero {...props} />, ({ getByText }) => {
    expect(getByText("Every league is free this season.")).toBeInTheDocument();
  });
});

it("renders no proof strip at all when the numbers have not earned it", () => {
  renderSurface(<ProofStrip stats={{ leaguesFilled: null, draftsNext48h: null, rating: null, any: false }} />, ({ container }) => {
    expect(container).toBeEmptyDOMElement();
  });
});

it("links the rating to the reviews it came from, with its count beside it", () => {
  renderSurface(<ProofStrip stats={{ ...some, rating: { average: 4.8, count: 63 } }} />, ({ getByRole }) => {
    expect(getByRole("link", { name: "Read all 63 member reviews" })).toHaveAttribute("href", "/reviews");
  });
});

// src/league-room/components/open-league-card.test.tsx
it("tells a when-full joiner what they are actually agreeing to, in the one sentence that owns it", () => {
  // join-flow-panel.md, HIGH: "the moment it fills" is honestly distinct from a date and says
  // nothing about the commitment, which is being reachable on short notice.
  // F9/C5: this card does not phrase the promise. `describeStartTiming` (Task 7 Step 7) does,
  // and this card and the waiting room quote the identical string, reassurance second.
  renderSurface(<OpenLeagueCard league={whenFull} />, ({ getByText }) => {
    expect(getByText("This one drafts the moment the last seat is taken. We tell you as soon as it fills, and the room opens a few minutes after that. You do not have to wait here.")).toBeInTheDocument();
  });
});

it("says who a league is for before the button, not after the refusal", () => {
  renderSurface(<OpenLeagueCard league={beginnersOnly} />, ({ getByRole }) => {
    expect(getByRole("link", { name: "Take the last seat in Median #13. Newer players only." })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: The hero and the three-step strip**

**The header is `PublicBar`** (the addendum's Task 16), which the front door renders with its `nav` and `action` props filled in while `/reviews`, `/browse` and `/app/join/[code]` render it bare (F5). The nav is the mock's three links — **Open leagues** at `/browse`, **How it works** at `/league-rules` (the addendum's Task 21 Step 4 page; a nav item pointing at a route nobody creates is the footer-to-a-404 failure with a bigger font), **Reviews** at `/reviews` — and the action is the green **Take a seat** CTA, which points at **`/browse`**, because the shelf is where a seat is actually taken and a CTA that scrolls to a hero is a CTA that did nothing. `PublicFooter` (also Task 16, F19) closes every one of those four surfaces.

The mock's hero copy, with the gauntlet's two fixes applied: the em dash in the subhead is gone (it violated the repo's own sweep), and the money question is answered in the sentence that follows. The three-step strip ships verbatim from the mock because the panel asked to keep it verbatim, minus the unverifiable "90 seconds" total, which nobody could reconstruct from the steps and which this plan therefore does not print.

```
01 · 10 SEC   Pick a seat            Your seat holds for 10 minutes
02 · 30 SEC   Sign in with email     That is the whole signup
03 · DONE     You are in the league  Meet the room, rank your draft slots
```

Step 01's promise is real as of Task 6 and **this task depends on Task 6 shipping first** — a promise on the front door with no mechanism behind it is the exact failure this plan exists to stop. (Sequencing note: Task 6 is ordered after this one in the ledger for narrative reasons only. The dependency runs the other way and the executing engineer takes Task 6 first if they are working in parallel; either order works because Task 5 Step 2's copy is what Task 6's test asserts against.)

- [ ] **Step 3: The shelf, and the four facts a veteran actually shops on**

`PublicLeagueSummary` gains **two** fields, its fourteenth and fifteenth: `rosterSummary` (a derived sentence from the stored slot rows — "15 slots, 1 flex, superflex", through the existing `describeRosterShape`) and `playoffWeeks` (the two or three week numbers, already stored). Both are the same class of disclosure decision `scoringLabel` and `draftAt` already established: a fact about the league, never about a person in it. The gauntlet's veteran finding was that the card "looks premium, reads shallow", and these are the two cheapest fields that fix it because both are already in the database.

**The shelf header says when its numbers were true** (F20, and the honest half of deferral D4): verbatim and asserted in this task's tests, **"Seat counts as of {time}. A seat being claimed is counted."** The `{time}` is the server render's own instant through the existing formatter, and the second sentence is what makes the first one true once Task 6 ships holds. The mock's **"Live seat counts · updated just now" is refused** and named as refused here: there is no anonymous SSE fan-out for signed-out visitors (D4), "live" would be a claim about a mechanism this product does not have, and "just now" is a claim that ages badly on a cached page.

Waivers, trade deadline and dynasty are **not** added: this product has no waiver engine, no trade deadline and no keeper support, and a card field for a feature that does not exist is a lie with a label on it. The card says what the league is; `LeagueTermsPanel` (reachable before joining) says the rest.

- [ ] **Step 4: The filters, and the one that is not a filter**

The mock's filter row (All, Drafting soonest, Drafts when full, Newer players, Superflex, Median game) is **two different things wearing one shape**, and Phase 3.5's ruling 1 is why that matters: *"variety in toggles, not queues"*, and every filter axis is a way for an open seat to become invisible. "Drafting soonest" is a **sort**, not a filter, and ships as one. "Newer players" is the existing `experienceTier` axis, which exists to keep people apart on purpose and stays. "Superflex" and "Median game" would fragment the canonical pool and are therefore rendered as **badges on the card, not as filters** — a visitor can see them at a glance without a seat becoming unfindable. The row ships as: All · Drafting soonest (sort) · Drafts when full · Newer players. Four controls, one of which is a sort, and `browse-filters.tsx` keeps its enum-keyed labels.

- [ ] **Step 5: The trust surfaces the gauntlet found missing**

The links are Terms, Privacy, Support and League rules, and the nav gains Reviews (it exists and is real). **They live in `PublicFooter`** (the addendum's Task 16, F19), not in a footer this page writes, because the same four promises are made on `/browse`, `/reviews` and `/app/join/[code]` and a footer copy-pasted four times is the chrome duplication the addendum's Task 16 exists to end. The persona gauntlet filed the absence as MEDIUM-HIGH for the burned skeptic, and every one of those pages either exists or is a stub route this task creates with real content pointing at the operator dispute path Phase 3 Plan B shipped, filled in by the addendum's Task 21 Step 4. **A footer link to a 404 is worse than no footer**, and the assertion that every footer target resolves belongs to `PublicFooter`'s own test in Task 16 rather than to the page that happens to render it (F19).

- [ ] **Step 6: Persona panel — the stranger at the door**

Stranger with intent, comparison shopper, skeptic, commissioner-curious. The questions: does the money sentence read as honest or as a bait-and-switch waiting to happen; can a veteran tell what this league actually is from the card alone; does the skeptic find a name to complain to before they hand over anything; and does the "Start your own" tile read as a category rather than as the sixth-best league on the shelf (the gauntlet's MEDIUM: it currently reads as an afterthought, and this task gives it its own row under the shelf with its own framing rather than a tile among tiles).

- [ ] **Step 7: Commit**

---

## Task 6: The seat hold, the race loser, and the refusal

Three states the mocks promise and the product cannot currently reach. All three are the same mechanism seen from three angles: a seat is a scarce thing, and what happens between wanting it and having it is where trust is won or lost.

**Files:**
- Create: `src/matchmaking/seat-hold.ts`, `src/league-service/seat-hold.ts` (+ their tests), `drizzle/0033_seat_holds.sql`
- Create: `src/app/api/public/leagues/[leagueId]/hold/route.ts` (+ its test), `src/app/join/[leagueId]/hold/page.tsx`
- Create: `src/league-room/components/seat-hold-panel.tsx`, `seat-taken-panel.tsx` (+ their tests)
- Modify: `src/db/schema.ts`, `src/league-service/join.ts` (+ its test), `src/league-service/browse.ts` (+ its test), `src/matchmaking/contract.ts` + `config.ts` + `filter.ts` (+ their tests), `src/integrity-service/lock-order.test.ts`, `src/integrity/rendered-copy.test.tsx`

**Interfaces:**
- Consumes: `joinLeagueInTx`, `hasOpenSeat`, `tierJoinPrecondition`, `ENFORCEMENT_REFUSALS`, `Clock`, `SignInLink` (`src/components/app-shell/sign-in-link.tsx`, the addendum's Task 16 — this task cannot return a visitor to their held seat without it, which is why the combined order runs A16 before P6).
- Produces: `claimSeatHold`, `consumeSeatHoldInTx`, `liveHoldsFor`, `SEAT_HOLD`, `SEAT_HOLD_REFUSALS`, `PublicLeagueSummary.heldSeats`, `seat_holds`.

- [ ] **Step 1: Write the failing hold tests**

```ts
// src/league-service/seat-hold.test.ts
it("holds a seat for a visitor who is not signed in yet, keyed by a token and nothing else", async () => {
  const held = await claimSeatHold(db, { leagueId, token: "hold_abc", now: NOW });
  expect(held).toMatchObject({ ok: true, expiresAt: plusMinutes(NOW, SEAT_HOLD.minutes) });
});

it("counts a live hold against capacity, so the twelfth and thirteenth visitor cannot both be told yes", async () => {
  await fillLeague(db, leagueId, 11);
  expect(await claimSeatHold(db, { leagueId, token: "hold_a", now: NOW })).toMatchObject({ ok: true });
  expect(await claimSeatHold(db, { leagueId, token: "hold_b", now: NOW }))
    .toEqual({ ok: false, reason: SEAT_HOLD_REFUSALS.noSeat });
});

it("stops counting a hold the moment it expires, with no job to run and nothing to clean up", async () => {
  // Level-triggered, exactly like the house reconciler: expiry is a PREDICATE (`expires_at >
  // now`), never a deletion somebody has to schedule. PgBouncer forbids the session state a
  // scheduled sweeper would want, and a hold that expires only when a sweeper runs is a seat
  // held hostage by an unrelated outage.
  await claimSeatHold(db, { leagueId, token: "hold_a", now: NOW });
  expect(await liveHoldsFor(db, leagueId, plusMinutes(NOW, SEAT_HOLD.minutes + 1))).toBe(0);
});

it("gives the seat to the holder and refuses the racer, and says so in words the racer can act on", async () => {
  await fillLeague(db, leagueId, 11);
  await claimSeatHold(db, { leagueId, token: "hold_a", now: NOW });
  const loser = await joinPublicLeague(db, { leagueId, userId: "u_bob", holdToken: null });
  expect(loser).toEqual({ ok: false, reason: SEAT_HOLD_REFUSALS.taken });
  const winner = await joinPublicLeague(db, { leagueId, userId: "u_alice", holdToken: "hold_a" });
  expect(winner).toMatchObject({ ok: true });
});

it("consumes the hold on the join, so one token cannot seat two people", async () => {
  await joinPublicLeague(db, { leagueId, userId: "u_alice", holdToken: "hold_a" });
  const second = await joinPublicLeague(db, { leagueId, userId: "u_carol", holdToken: "hold_a" });
  expect(second).toEqual({ ok: false, reason: SEAT_HOLD_REFUSALS.spent });
});

it("writes nothing at all on every refusal path", async () => {
  const before = await snapshotOf(db);
  for (const call of everyRefusalPath()) await call();
  await expectNoSeatHoldTookPlace(db, before);
});

// The return: the moment nobody designed until F4 (Step 4's fourth screen).
it("seats the visitor who comes back from sign-in still holding a live token", async () => {
  await claimSeatHold(db, { leagueId, token: "hold_a", now: NOW });
  expect(await returnFromSignIn(db, { leagueId, userId: "u_alice", holdToken: "hold_a", now: NOW }))
    .toMatchObject({ ok: true, seated: true, justSeated: true });
});

it("still seats somebody whose hold expired while a seat is open, and says the hold ran out", async () => {
  await claimSeatHold(db, { leagueId, token: "hold_a", now: NOW });
  const late = plusMinutes(NOW, SEAT_HOLD.minutes + 2);
  expect(await returnFromSignIn(db, { leagueId, userId: "u_alice", holdToken: "hold_a", now: late }))
    .toMatchObject({ ok: true, seated: true, expiredHold: true });
});

it("shows the race loser the taken panel rather than a refusal code", async () => {
  await fillLeague(db, leagueId, 12);
  expect(await returnFromSignIn(db, { leagueId, userId: "u_alice", holdToken: "hold_a", now: NOW }))
    .toEqual({ ok: false, reason: SEAT_HOLD_REFUSALS.taken });
});
```

- [ ] **Step 2: The table, and why it is a table**

```sql
CREATE TABLE "seat_holds" (
  "token" text PRIMARY KEY,
  "league_id" text NOT NULL REFERENCES "leagues"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz
);
CREATE INDEX "seat_holds_live_idx" ON "seat_holds" ("league_id", "expires_at") WHERE "consumed_at" IS NULL;
```

Not Redis, and the reason is the same one that put `kickoff_at` in Postgres: **a seat is capacity, capacity is a correctness question, and Postgres is authoritative here by the codebase's own rule.** Redis is the delivery mechanism for events, never the record of a fact somebody could later dispute. Not a lock, either — PgBouncer forbids `pg_advisory_lock`, so exclusion comes from the write, and the write is the `token` primary key plus the capacity count taken inside the transaction that already holds `leagues FOR UPDATE`.

**FK acquisitions, enumerated:** the `INSERT` takes an implicit `FOR KEY SHARE` on `leagues` (the `league_id` FK). `claimSeatHold` takes `leagues FOR UPDATE` first, counts teams and live holds, then inserts, which is the identical `leagues`-then-child order `joinLeagueInTx` already establishes; `consumeSeatHoldInTx` runs inside `joinLeagueInTx`'s existing transaction and adds no new edge. One new entry in `lock-order.test.ts`, with the count read off the file.

- [ ] **Step 3: The token, and what it is not**

The token is an opaque random id in an httpOnly, SameSite=Lax, path-scoped cookie set by `POST /api/public/leagues/[leagueId]/hold`. It **is not an identity, does not authenticate anything, and grants nothing except the right to find a seat still there.** The join door still calls `requireCurrentUser()` and still checks `tierJoinPrecondition`; a held seat that a tier refusal rejects is released immediately rather than left to expire, because holding a seat for somebody who was never eligible is the seat count lying to eleven other people.

- [ ] **Step 4: The four screens**

**The interstitial** (`/join/[leagueId]/hold`): the league's own facts, a `Countdown` on the hold, and the way in. The countdown is display only, exactly as the primitive's docblock requires — the server's `expires_at` is what decides, and a clock that ran out on screen re-checks with the server rather than assuming.

**The way in is `SignInLink`** (the addendum's Task 16), rendered with `intent="/join/[leagueId]/hold"`, never a hand-written `<Link href="/sign-in">` — that link is exactly what drops the visitor's intent on the floor and lands them on `/app` with a held seat they can no longer see (F3). `SignInLink` renders `/sign-in?returnTo=…`, the route validates it through `safeReturnTo`, and `getSignInUrl({ returnTo })` seals it into the state so the callback brings them back here rather than to the callback's own `/app` default. **The hold cookie is set with `Path=/`** so it is still sent on the top-level GET back from WorkOS: a `Path` scoped to the hold's API route would not be readable by this page or by the join door. Path is a scoping convenience and never a security boundary; `httpOnly`, `SameSite=Lax` and the token's opacity are what carry the security, exactly as Step 3 argues.

**The return** (`GET /join/[leagueId]/hold` with a session, F4): the moment both documents described the departure of and neither described the arrival at. The page reads the hold cookie and calls the join door with the token, and there are exactly three outcomes:

- **(a) The seat is still theirs.** They are seated and redirected to the waiting room in the just-seated state (Step 2b of Task 9, D1), because the first thing somebody should see after signing in for a seat is the seat.
- **(b) The hold expired but a seat is still open** (`SEAT_HOLD_REFUSALS.expired`). They are joined anyway and told so, in one line above the waiting room's hero: *"Your ten minutes ran out while you were signing in. A seat was still open, so we put you in it."* Refusing somebody a seat that is sitting empty because our own timer fired would be the mechanism serving itself.
- **(c) There is no seat.** `SeatTakenPanel`, below, with its two real actions.

A visitor who arrives here with a session and **no** cookie at all is treated as (b) or (c) on the same predicate: what decides is whether the room has room, not whether we still have a receipt.

**The race loser** (`SeatTakenPanel`): *"That seat went to someone else while you were signing in. Your spot in this league is gone, and nothing was charged."* plus two real actions: the same league's next open edition (the house factory guarantees one exists for a house rung) and the shelf filtered to leagues closest to filling. Never a dead end, and never a bare "error".

**The tier refusal**, rendered at the same moment for the same reason: today `ENFORCEMENT_REFUSALS.join` is returned by the API and shown after a click. v2 says it **before** the click, on the card (Task 5 Step 1's accessible name), and keeps the post-click refusal for the case where a visitor arrives by direct link.

- [ ] **Step 5: The seat count stays honest**

`PublicLeagueSummary` gains `heldSeats` as its **sixteenth** field, and the card renders **two sentences, never one blended number**: "9 of 12 seated" plus, only when it is non-zero, "1 seat is being claimed right now." **Neither sentence is written here:** the card passes `heldSeats` to `SeatMeter`, which owns the seat sentence for the whole product (Task 3 Step 1, F17), so the shelf, the waiting room, the open-seats panel and this card cannot drift into four phrasings of one count. The gauntlet's skeptic finding is that "live seat counts" was a label with no mechanism; this is the mechanism, and it says exactly what it knows.

- [ ] **Step 6: Persona panel — the ten minutes between wanting and having**

Skeptic, first-timer, stranger with intent, commissioner. The questions: does a held seat read as a courtesy or as pressure; does the loser's screen feel like an apology or like a way forward; does a first-timer understand that signing in is the only thing between them and the seat; and does anybody read the ten-minute clock as a payment window (it is not, and nothing on it may imply one while stakes are cosmetic).

- [ ] **Step 7: Commit**

---

## Task 7: Roll until full

The founder's ruling, verbatim: *"ALWAYS ROLL UNTIL FULL: no draft ever fires below a full room. A scheduled public league whose time arrives unfilled rolls forward; scheduled time is a target that slips until the last seat fills."* Today the platform starts a three-of-twelve league without hesitating. This is the plan's largest piece of product logic and it is server-side truth, not a sentence on a screen.

**Files:**
- Create: `src/matchmaking/roll.ts`, `src/league-service/roll.ts` (+ their tests), `drizzle/0034_roll_until_full.sql`
- Modify: `src/db/schema.ts`, `src/draft-service/auto-start.ts` (+ its test), `ticker.ts` (+ its test), `config.ts`
- Modify: `src/league-service/fill-trigger.ts` (+ its test), `draft-schedule.ts` (+ its test), `browse.ts` (+ its test), `src/matchmaking/contract.ts` + `config.ts`
- Modify: `src/integrity/system-actions.ts`, `notices.ts`, `test-support.ts` (+ their tests), `src/integrity-service/lock-order.test.ts`
- Modify: `src/league-room/components/draft-schedule-panel.tsx`, `waiting-room.tsx`, `open-league-card.tsx` (+ their tests)

**Interfaces:**
- Consumes: `dueDraftsQuery`, `autoStartDueDrafts`, `claimAutoStart`, `hasOpenSeat`, `notifyAffectedMember`, `AuditLogger`, `Clock`.
- Produces: `roomIsFull`, `rollUnfilledDraftInTx`, `rollDueDrafts`, `nextKickoffAfter`, `ROLL_REFUSALS`, `drafts.kickoff_rolls`, `drafts.fill_fired_at`, `SystemActionCode["draft_kickoff_rolled"]`.

- [ ] **Step 1: Write the failing tests, starting with the one that is a bug report**

```ts
// src/draft-service/auto-start.test.ts
it("does not start a public draft whose room is not full, however late it is", async () => {
  // THE BUG THIS TASK EXISTS FOR. `dueDraftsQuery` has no seat predicate and `store.startDraft`
  // only requires two teams, so a 3-of-12 public league whose kickoff passed drafts with three
  // teams on `main` today. The founder's ruling is absolute for the door the platform owns.
  await seedPublicLeague(db, { teamCount: 12, filled: 3, kickoffAt: PAST });
  expect(await autoStartDueDrafts(db, deps)).toEqual([
    { draftId, started: false, rolled: true, kickoffAt: plusHours(PAST, ROLL_CADENCE_HOURS) },
  ]);
  expect(await statusOf(db, draftId)).toBe("scheduled");
});

it("starts a full room at its scheduled time, exactly as it does today", async () => {
  await seedPublicLeague(db, { teamCount: 12, filled: 12, kickoffAt: PAST });
  expect(await autoStartDueDrafts(db, deps)).toEqual([{ draftId, started: true }]);
});

// src/matchmaking/roll.test.ts
it("rolls to the next slot in the future, not merely to the next slot", () => {
  // A process that was down for three days must not schedule a draft for yesterday. The answer
  // is a fixpoint over the cadence, the same shape `deadlineAfter` uses for the overnight pause.
  expect(nextKickoffAfter("2026-09-10T00:00:00.000Z", "2026-09-13T05:00:00.000Z"))
    .toBe("2026-09-14T00:00:00.000Z");
});

it("keeps the time of day a human chose, because that is the part they planned around", () => {
  expect(nextKickoffAfter("2026-09-10T00:00:00.000Z", "2026-09-10T00:00:01.000Z"))
    .toBe("2026-09-11T00:00:00.000Z");
});

// src/league-service/roll.test.ts
it("tells every seated member once, and says what their seat is still worth", async () => {
  await rollDueDrafts(db, deps);
  const notices = await noticesOf(db, leagueId, "draft_kickoff_rolled");
  expect(notices).toHaveLength(3);
  expect(notices[0]!.body).toContain("Your seat is still yours.");
});

it("survives two instances rolling the same draft on the same tick", async () => {
  // No leader election exists (PgBouncer). Exclusion comes from the WRITE: the UPDATE is
  // guarded on the kickoff it read, so the second instance updates zero rows and reports a
  // clean no-op. The same argument `claimAutoStart` already makes for its status transition.
  const [a, b] = await Promise.all([rollDueDrafts(dbOne, deps), rollDueDrafts(dbTwo, deps)]);
  expect(await rollCountOf(db, draftId)).toBe(1);
  expect(a.length + b.length).toBe(1);
});

it("writes nothing on every refusal path", async () => {
  const before = await snapshotOf(db);
  for (const call of everyRefusalPath()) await call();
  await expectNoRollTookPlace(db, before);
});
```

- [ ] **Step 2: The model, chosen out loud**

Three models were weighed against the existing `drafts.start_trigger` enum (`'scheduled' | 'when_full'`), and the ruling is **keep the enum at two members and make the start predicate one sentence that covers both**:

> **A draft starts when the room is full and the clock has reached its kickoff.**

- `when_full` already satisfies the clock half by construction: `fireWhenFullInTx` writes `kickoff_at = now + grace` at the moment the last seat fills, so "full" and "kickoff reached" become true within one grace period of each other.
- `scheduled` now satisfies the fullness half or waits: an unfilled target is not due, it is **rolled**.

Collapsing the enum into one `when_full` trigger with a not-before time was the tempting third model and is **refused**, because the two triggers differ in a way the enum is the right place to record: a scheduled league's time is *a time twelve people planned around* and filling early does not move it (`FILL_TRIGGER_REFUSALS.notWhenFull` already states exactly this and would have to be deleted), while a sit-and-go league's time is *whenever the room is ready*. One column, two genuinely different promises, and the surfaces say different sentences because the promises are different.

- [ ] **Step 3: The gate, in one predicate, at the one door that owns it**

`roomIsFull` is a single exported predicate over `{ teamCount, filledTeams }` — literally `!hasOpenSeat(...)`, re-exported by name so the reason is greppable — and it is applied in **two** places that must never disagree: `dueDraftsQuery` gains the seat count as a SQL predicate (a correlated count over `teams`, bounded by construction at a dozen rows per league, with an `EXPLAIN` entry in `index-plans.test.ts`), and `rollDueDrafts` re-derives it in TypeScript for the drafts the scan returns. The query filters and the code decides; a scan that returned a due-but-unfilled draft and a starter that started it anyway is the disagreement the two-place check exists to make impossible.

**The commissioner's manual press is deliberately unchanged** and keeps its existing two-team floor. This is the one place this task does not apply the founder's ruling literally, and the reason is a dead end: there is no league-settings write endpoint in this product, so a private commissioner whose twelfth friend never signed up would have **no way at all** to ever draft, in a league nobody else can start for them. The platform door is where nobody chose the time and nobody can press the button, and it is where the ruling binds. The commissioner's press instead gains a warning it does not have today: *"3 seats are still open. Starting now drafts a short league."* **This is listed as a controller decision at the bottom of this plan.**

- [ ] **Step 4: The roll, as a guarded write**

```ts
// Zero rows means another instance rolled it first. One row means this caller owns the roll.
const rolled = await tx
  .update(drafts)
  .set({ kickoffAt: next, kickoffRolls: sql`${drafts.kickoffRolls} + 1` })
  .where(and(eq(drafts.id, draftId), eq(drafts.status, "scheduled"), eq(drafts.kickoffAt, previous)))
  .returning({ id: drafts.id });
```

Migration `0034` adds two columns, both with a writer, a reader and a surface on the day they land (the codebase has refused a column without all three four times):

```sql
ALTER TABLE "drafts" ADD COLUMN "kickoff_rolls" integer NOT NULL DEFAULT 0;
ALTER TABLE "drafts" ADD COLUMN "fill_fired_at" timestamptz;
```

`kickoff_rolls` is read by the waiting room and the browse card as `PublicLeagueSummary`'s **seventeenth** field (F21: `rosterSummary` and `playoffWeeks` are fourteen and fifteen in Task 5, `heldSeats` is sixteen in Task 6, and this is the last field this plan adds), and they say *"This draft moved once because the room was not full"* rather than silently showing a different date than the one a member wrote in their calendar. **The sentence pluralizes honestly and comes from `rollNoticeSentence` in `src/matchmaking/roll.ts`, which takes `kickoffRolls`** (F12): *moved once*, *moved twice*, then *moved 5 times since it was scheduled*. A room on its fifth roll that still says "moved once" is the product lying about the only fact the member is tracking. There is **no cap on the number of rolls** — the founder's ruling is that the time slips until the last seat fills — and Task 8's seat release is what keeps an uncapped roll from being a trap.

- [ ] **Step 5: `fill_fired_at`, and the bug it prevents**

`fireWhenFullInTx` currently guards against a repeat fire by looking for an existing `draft_fill_triggered` **notice**. Once Task 8 lets a member release a seat, that guard becomes a trap: a league that fills, has one member leave during the grace window, and then fills again would refuse to fire a second time, and its draft would never start. Notices are audit-anchored and nothing deletes them, so the guard cannot be "delete the notice". The fix is a column: `fill_fired_at` is stamped by `fireWhenFullInTx` and **cleared by `releaseSeat`**, and the guard reads it. The notice-existence check is deleted in the same commit, because two guards for one invariant is how they start disagreeing.

- [ ] **Step 6: One system-action code, one notice, no new event type**

`draft_kickoff_rolled` joins `SYSTEM_ACTION_CODES` with a compile-forced visibility of `"everyone"`, on `draft_auto_started`'s reasoning exactly: a fact about the league's shared calendar, true for everyone in it, about nobody's conduct. It rides `system_action` because `AUDIT_EVENT_TYPES` is a frozen pg enum. Its notice template is registry-derived so the copy sweeps catch it the commit it lands, and **its last sentence is `describeStartTiming`'s output rather than a string typed here** (F9), which is what makes the notice, the waiting room, the browse card and the schedule panel one promise instead of four:

> *"Half-PPR #241 did not fill by Thursday 8:00 PM, so its draft moves to Friday 8:00 PM. Your seat is still yours. The draft starts as soon as the last seat is taken."*

**In a member league that last sentence is false as written** (F11): members roll too, and their commissioner is holding a button that can start the room at two teams. `describeStartTiming` therefore takes the league's `authority`, and the member branch reads *"The draft starts as soon as the last seat is taken, or when your commissioner starts it."* The house branch is the sentence above, unchanged, because a house league has no commissioner to name.

**From the second roll onward the notice gains a second paragraph** (F12), because a member who has now been moved twice is being asked a different question than a member who was moved once:

> *"If you would rather not wait, you can release your seat and someone else can take it."*

with the link to the waiting room's `ReleaseSeatControl` (Task 8). It does not appear on the first roll: offering the exit the first time something slips reads as the product giving up on its own room.

- [ ] **Step 7: The surfaces stop lying about a time**

`describeStartTiming` (`src/matchmaking/roll.ts`, browser-safe) is the one function that turns `{ startTrigger, kickoffAt, kickoffRolls, filledTeams, teamCount, authority }` into a sentence, and the browse card, the waiting room, the draft-schedule panel and the notice all call it. A time that exists in four places and is phrased in four ways is how a product starts contradicting itself.

**This step is the authority for every start-timing sentence in the plan** (F9), and the two other tasks that print one **quote it rather than restate it**:

- **The when-full commitment**, which Task 5 Step 1 and Task 9 Step 2 previously phrased two different ways: **"This one drafts the moment the last seat is taken. We tell you as soon as it fills, and the room opens a few minutes after that. You do not have to wait here."** The last sentence is the reassurance C5 keeps, second, where it reads as relief rather than as a caveat.
- **The scheduled commitment**, house branch: **"The draft starts as soon as the last seat is taken."** Member branch: **"The draft starts as soon as the last seat is taken, or when your commissioner starts it."** (F11.)
- **The roll's own sentence** is `rollNoticeSentence(kickoffRolls)` from the same file, pluralized (F12), and Task 9's waiting-room test asserts the identical string the notice body carries.

The commissioner's short-room warning in Step 3 is unchanged: it is a warning about a press, not a description of a start.

- [ ] **Step 8: Commit**

---

## Task 8: Release the seat

The escape hatch the roll requires and the gauntlet asked for twice. A member who is waiting on a room that keeps not filling must be able to leave, or "roll until full" is a room with the door welded shut.

**Files:**
- Create: `src/league-service/release.ts` (+ its test), `src/app/api/leagues/[leagueId]/seat/route.ts` (+ its test)
- Create: `src/league-room/components/release-seat-control.tsx` (+ its test)
- Modify: `src/league-service/fill-trigger.ts` (the `fill_fired_at` clear), `src/db/schema.ts` (nothing new; the FK cascades are read and asserted), `src/integrity/system-actions.ts`, `notices.ts`, `src/integrity-service/lock-order.test.ts`, `src/league-room/components/waiting-room.tsx`, `src/help/glossary.ts`

**Interfaces:**
- Consumes: `resolveLeagueMembership`, `leagueAuthority`, `notifyAffectedMember`, `AuditLogger`.
- Produces: `releaseSeat`, `RELEASE_REFUSALS`.

- [ ] **Step 1: Write the failing release tests**

```ts
// src/league-service/release.test.ts
it("lets a member leave a league whose draft has not started, and frees the seat immediately", async () => {
  expect(await releaseSeat(db, { leagueId, userId: "u_bob" })).toMatchObject({ ok: true });
  expect(await filledTeamsOf(db, leagueId)).toBe(before - 1);
});

it("refuses once the draft has started, because a roster in a live draft is not a seat", async () => {
  await startDraft(db, draftId);
  expect(await releaseSeat(db, { leagueId, userId: "u_bob" }))
    .toEqual({ ok: false, reason: RELEASE_REFUSALS.draftStarted });
});

it("refuses a member commissioner, and says what to do instead", async () => {
  // A member league whose commissioner walks away is a league with nobody to run it, and this
  // product has no transfer-of-commissioner path. A HOUSE league has no commissioner at all,
  // so the same member leaves freely (the authority union's `house` branch, not a special case).
  expect(await releaseSeat(db, { leagueId: memberLeagueId, userId: commissionerId }))
    .toEqual({ ok: false, reason: RELEASE_REFUSALS.commissioner });
  expect(await releaseSeat(db, { leagueId: houseLeagueId, userId: anyMemberId })).toMatchObject({ ok: true });
});

it("puts a filled sit-and-go league back to filling, so its draft cannot fire into a short room", async () => {
  await fillLeague(db, sitAndGoId);            // fill_fired_at stamped, kickoff = now + grace
  await releaseSeat(db, { leagueId: sitAndGoId, userId: "u_bob" });
  expect(await fillFiredAtOf(db, sitAndGoId)).toBeNull();
  expect(await autoStartDueDrafts(db, deps)).toEqual([]);
});

it("writes nothing on every refusal path", async () => {
  const before = await snapshotOf(db);
  for (const call of everyRefusalPath()) await call();
  await expectNoSeatReleaseTookPlace(db, before);
});
```

- [ ] **Step 2: What a release deletes, enumerated**

Deleting a `teams` row is only safe because of what a pre-draft league does not have yet, and the task asserts each rather than assuming it: `draft_picks` and `matchups` reference `teams` **without** `ON DELETE CASCADE` and both are empty before a draft runs (matchups are generated at `commitDraftResults`); rosters, queues and draft actions cascade. The refusal on `status !== 'scheduled'` is therefore not politeness, it is the precondition that makes the delete legal, and a test asserts the two non-cascading tables are empty at the moment of the delete rather than trusting the status check alone.

**FK acquisitions, enumerated:** `releaseSeat` takes `leagues FOR UPDATE` (the same first lock `joinLeagueInTx` takes, so the seat count it frees cannot race a join), then deletes the `teams` row (row-exclusive plus `FOR KEY SHARE` on `leagues` and `users`), then clears `drafts.fill_fired_at` (`FOR KEY SHARE` on `leagues`, already held), then the notice inserts, then the audit anchor. One new entry in `lock-order.test.ts`.

- [ ] **Step 3: The audit compromise, stated rather than smuggled**

`AUDIT_EVENT_TYPES` is a frozen pg enum whose docblock forbids `ALTER TYPE … ADD VALUE` forever, and there is no `member_left`. A seat release has a real human actor, so it cannot ride `system_action` (which is `actorId: null` by construction). It therefore rides **`member_joined` with `payload.outcome: "seat_released"`**, on the in-code precedent Plan C already set and documented: *"`trade_rejected` carries a withdrawal too — `payload.outcome` tells the two apart, because this list is frozen."* The activity renderer reads the outcome and says *"left the league before the draft"*. **This is the one place in this plan where a frozen vocabulary forces a compromise, and it is listed as a controller decision at the bottom.**

- [ ] **Step 4: The control, where leaving is a decision and not an accident**

`ReleaseSeatControl` lives in the waiting room and on league home while the draft is scheduled, and **its weight is derived from `kickoffRolls`** (F12): at zero rolls it is a quiet text control at the bottom of the room, because nothing has gone wrong yet and offering the door first is the product doubting its own league; from the first roll onward it moves up beside the rolled-date sentence and takes a visible secondary button, because a member who has been moved is the member this control was built for. The escalation is a derived rendering of a column that already exists, not a stored state and not a nudge.

It sits behind a `Modal` confirm that states the consequence in the league's own terms: *"You will lose your seat in Half-PPR #241. Someone else can take it right away, and the league may fill without you."* Destructive `Button` variant, keyboard-operable, focus returns to the opener on cancel — all of which `Modal` already guarantees.

- [ ] **Step 5: Commit**

---

## Task 9: The Waiting Room, both variants and the two states nobody drew

The post-join screen is where a first-timer decides whether this product is competent. Phase 3.5 shipped four states as `StatePanel`s; v2 makes it a room with a countdown, a roster, a checklist and a chat, and adds the variants the mocks did not draw.

**Files:**
- Modify: `src/league-room/components/waiting-room.tsx` (+ its test), `slot-preference-panel.tsx` (+ its test), `league-members-panel.tsx` (+ its test), `draft-schedule-panel.tsx` (+ its test)
- Create: `src/league-room/components/waiting-checklist.tsx`, `room-roster.tsx` (+ their tests)
- Modify: `src/league-service/read.ts` (+ its test), `src/league-room/contract.ts`, `src/app/app/leagues/[leagueId]/page.tsx`, `src/help/glossary.ts`, `src/integrity/rendered-copy.test.tsx`

**Interfaces:**
- Consumes: `Countdown` (`size="xl"`), `Meter`, `Panel`, `Crest`, `SeatMeter`, `describeStartTiming`, `SlotPreferencePanel`, `LeagueChat`, `RoomTour`.
- Produces: `WaitingChecklist`, `RoomRoster`, `WaitingRoomLeague`'s rolled and missed states.

- [ ] **Step 1: Write the failing waiting-room tests**

```tsx
// src/league-room/components/waiting-room.test.tsx
it("counts down to a scheduled draft and states the fill in the same breath", () => {
  // F17: the seat sentence is SeatMeter's, everywhere. "10 of 12 seats filled" and "4 of 12
  // seats taken" were this screen's own two phrasings of the primitive's own string; both are
  // gone, and the change to the e2e assertions is named in this task's commit body per the
  // e2e-under-redesign rule.
  renderSurface(<WaitingRoom league={scheduledAndFilling} />, ({ getByTestId, getByText }) => {
    expect(getByTestId("waiting-room-countdown")).toBeInTheDocument();
    expect(getByText("10 of 12 seated. 2 seats left.")).toBeInTheDocument();
  });
});

it("replaces the countdown with the fill meter when there is nothing to count down to", () => {
  // join-flow-panel.md, HIGH: the when-full variant is a full second mode that the mock never
  // drew. A clock with nothing behind it is the worst possible thing to show a waiting member.
  renderSurface(<WaitingRoom league={whenFullAndFilling} />, ({ queryByTestId, getByText }) => {
    expect(queryByTestId("waiting-room-countdown")).toBeNull();
    expect(getByText("4 of 12 seated")).toBeInTheDocument();
  });
});

it("says why the date moved, rather than quietly showing a different one", () => {
  renderSurface(<WaitingRoom league={rolledOnce} />, ({ getByText }) => {
    expect(getByText("This draft moved once because the room was not full.")).toBeInTheDocument();
  });
});

it("tells a member who missed the draft what happened to their team", () => {
  // join-flow-panel.md, HIGH: no autopick answer existed anywhere in the join flow, and "what
  // if I miss it" is the first-timer's actual question. C3: the safety net has ONE phrasing,
  // "the room picks for you from your queue", stated once in docs/design-system.md (Task 14
  // Step 2) and quoted by every surface that reassures anybody about missing a draft.
  renderSurface(<WaitingRoom league={draftedWithoutYou} />, ({ getByText, getByRole }) => {
    expect(getByText("The draft ran on Thursday and the room picked for you from your queue.")).toBeInTheDocument();
    expect(getByRole("link", { name: "See your roster" })).toBeInTheDocument();
  });
});

it("speaks the house register, with no contractions anywhere on the screen", () => {
  // C1 (ruled): the expanded register is the house standard. `waiting-room.tsx:117` ships
  // "You don't have to wait here. We'll let you know the moment it fills." today; it converges
  // here on the one sentence Task 7 Step 7 owns, expanded, and the two shipped contractions die.
  renderSurface(<WaitingRoom league={whenFullAndFilling} />, ({ container }) => {
    expect(container.textContent).not.toMatch(/\b\w+'(t|ll|re|ve|s|d|m)\b/);
    expect(container.textContent).toContain("You do not have to wait here.");
  });
});

it("puts the room tour first for a manager who has never drafted", () => {
  renderSurface(<WaitingChecklist items={firstTimerItems} />, ({ getAllByRole }) => {
    expect(getAllByRole("listitem")[0]).toHaveTextContent("See how the draft room works");
  });
});
```

- [ ] **Step 2: The two hero variants**

Scheduled: the `xl` `Countdown` beside the fill `Meter`, with the local-time line under it. When-full: the fill `Meter` **promoted to hero**, no countdown at all, and the honest sentence about what joining committed them to, **quoted from `describeStartTiming`** and not typed here (F9): *"This one drafts the moment the last seat is taken. We tell you as soon as it fills, and the room opens a few minutes after that. You do not have to wait here."* The gauntlet's sit-and-go finding was that the two are different commitments told in the same words; they now differ in the largest element on the screen.

**The room going full is a moment, and it is drawn** (D3). `filledTeams === teamCount` is already on the page and the transition already arrives: the last seat lands, `fireWhenFullInTx` publishes, and the notice reaches this screen on `notice.created` (no new event type, ruling 21). What this step specifies is what the screen *does* with it: the fill `Meter` animates to complete, the seat sentence settles to **"12 of 12 seated"**, and the `xl` `Countdown` to the grace-window kickoff **replaces** the meter as the hero, in that order, so the room visibly changes state rather than quietly rerendering a different number. Under `prefers-reduced-motion` the meter completes and the countdown appears with no transition at all, on Task 13 Step 5's branch, and both sides are asserted. Nothing here is a new fact: it is the two facts the page already has, sequenced.

- [ ] **Step 3: The room, without the tags**

`RoomRoster` lists the seated managers and the open seats, with `Crest`/`Avatar` and the share link. It carries **no per-manager history tag** ("3rd season", "verified reviewer"): those would disclose exactly the per-member participation tier that `compositionCategory`'s server-side reduction exists to hide, and re-opening that decision inside a design phase would be the privacy equivalent of a page-local visual mapping. The room instead carries the league's existing **coarse** composition line, which is the same fact at the resolution the product already ruled is safe. (Ruling 19; the gauntlet's "the YOU row has no tag" finding is answered by nobody having one.)

- [ ] **Step 4: The checklist, resequenced and made real**

Four items, ordered by what actually helps: **see how the draft room works** (the existing `RoomTour`, not a practice sandbox, which does not exist and is deferred at D5), **name your team**, **rank your draft slots** (the existing `SlotPreferencePanel`, inlined here rather than linked away), **turn on notices**. First-timers get the tour first; a manager with a season behind them gets it last. The gauntlet's finding was that the highest-value item was fourth of four with the same visual weight as naming a team.

- [ ] **Step 5: Slot ranking, keyboard-first**

`SlotPreferencePanel` already ships with named move controls (Phase 3.5 Task 6 built it that way deliberately). v2 restyles it into the mock's slot tiles **without** making drag the only affordance — the gauntlet's HIGH accessibility finding against the mock. The mock's own explainer sentence is kept nearly verbatim (the panel asked for that) and gains the worked example it asked for.

- [ ] **Step 6: Persona panel — the days between joining and drafting**

First-timer, sit-and-go joiner, skeptic, veteran. The questions: does a first-timer leave this screen knowing what happens if they are not there; does the when-full joiner understand they may need to be reachable at short notice; does a rolled date read as competence or as chaos; and does the veteran find the ranking control without being told it exists.

- [ ] **Step 7: Commit**

---

## Task 10: The Locker Room

The signed-in home, and the screen the founder's "wow" is measured on. Everything the mock draws that this product can compute, and nothing it cannot.

**Files:**
- Modify: `src/app/app/page.tsx`, `src/league-room/components/home-board.tsx` (+ its test), `home-league-card.tsx` (+ its test), `first-run-panel.tsx` (+ its test), `start-or-join-disclosure.tsx`
- Create: `src/league-room/components/league-board.tsx`, `attention-queue.tsx`, `open-seats-panel.tsx`, `live-state-pill.tsx` (+ their tests)
- Modify: `src/league-service/home.ts` (+ its test), `src/league-room/contract.ts`, `src/components/app-shell/top-bar.tsx`, `src/integrity/rendered-copy.test.tsx`

**Interfaces:**
- Consumes: `crossLeagueHome`, `nextActionFor`, `useLiveScores`, `listPublicLeagues`, `Table` (dense), `Panel`, `Crest`, `StatPill`, `Meter`.
- Produces: `LeagueBoard`, `AttentionQueue`, `OpenSeatsPanel`, `LiveStatePill`, `HomeBody.liveState`.

- [ ] **Step 1: Write the failing board tests**

```tsx
// src/league-room/components/league-board.test.tsx
it("puts the league that needs the manager first, and says why in words", () => {
  renderSurface(<LeagueBoard leagues={mixed} />, ({ getAllByRole }) => {
    expect(within(getAllByRole("row")[1]!).getByText("Fix lineup")).toBeInTheDocument();
  });
});

it("renders no win probability anywhere, because there is no model behind one", () => {
  // locker-room-panel.md, HIGH (the skeptic): a clean percentage with a bar and no methodology,
  // at the same visual weight as the real score. Deferral D1 rules the model out of this phase,
  // and a design phase does not get to ship a number a model would have had to produce.
  renderSurface(<LeagueBoard leagues={live} />, ({ queryByText }) => {
    expect(queryByText(/win prob/i)).toBeNull();
  });
});

it("shows the margin, which is a subtraction this product can actually do", () => {
  renderSurface(<LeagueBoard leagues={live} />, ({ getByText }) => {
    expect(getByText("+4.52")).toBeInTheDocument();
  });
});

it("renders a median league's second result as a median, not as an opponent", () => {
  // locker-room-panel.md, MEDIUM: the mock reused the head-to-head vs-block for the median row,
  // which reads as a team called LEAGUE MEDIAN at a glance.
  renderSurface(<LeagueBoard leagues={[medianLeague]} />, ({ getByText }) => {
    expect(getByText("League median 121.4")).toBeInTheDocument();
  });
});

// src/league-room/components/attention-queue.test.tsx
it("clears an item when the thing it names is done, so nothing needs dismissing", () => {
  // locker-room-panel.md, HIGH: no chip had a dismiss affordance. The answer is not a snooze
  // with storage behind it; it is that every chip is DERIVED from an unfinished action, so
  // finishing the action is the dismissal and an un-actionable chip never renders.
  const { rerender } = render(<AttentionQueue items={itemsFor(lineupUnset)} />);
  rerender(<AttentionQueue items={itemsFor(lineupSet)} />);
  expect(screen.queryByText("Fix your lineup")).toBeNull();
});

it("degrades to one league without announcing a sort over a list of one", () => {
  // locker-room-panel.md, HIGH (the casual in ONE league): every hero element on this screen is
  // a cross-league aggregation, and n=1 turned the house shelf into the loudest thing on the
  // page. At n=1 the board is the league, the shelf drops below the fold, and no sort is named.
  renderSurface(<HomeBoard initial={oneLeague} />, ({ queryByText, getByRole }) => {
    expect(queryByText(/closest first/i)).toBeNull();
    expect(getByRole("heading", { name: "Bay Bandits" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: The board's columns, each one a fact this product holds**

Crest · league name with record and next opponent · the two scores with the leader marked · the margin `Meter` · the next action · the state `StatPill`. Sorted by whether the manager is needed, then by how close the game is (margin, which is a subtraction, not a model). The mock's win-probability column, moments column and season projection are **not** rendered; deferrals D1, D2 and D3 name the data each would require. What replaces them is the next-action column, which is real, already computed by `nextActionFor`, and is the single most useful thing on a fantasy home screen: the mock's own best idea (one action that fixes the thing) rendered from something true.

- [ ] **Step 3: The live pill, from the real week**

`SUNDAY · 7 GAMES LIVE` is the top bar's energy and it renders only from the real week state the live-scoring stack already publishes. Off-season, mid-week and pre-kickoff each get their own true sentence, and when nothing is live the pill does not render. A pulsing green pill that says "LIVE" on a Tuesday in July is the definition of a prototype.

- [ ] **Step 4: The open-seats panel, and where it sits**

The house shelf on the home screen is the founder's core-experience ruling made visible, and the gauntlet's finding is that it must not be the loudest thing on a screen belonging to somebody who has not drafted yet. It renders **below** the board always, and for a manager with one league and no completed draft it renders below the fold with a quieter heading. "The house always has a game" ships verbatim; the panel asked to keep it.

- [ ] **Step 5: Persona panel — the manager on Sunday**

Veteran in eight leagues, casual in one, first-timer with one pending draft, phone user on the couch. The questions: does the veteran see the thing that needs them in under a second; does the casual manager's single-league home read as their home rather than as somebody else's dashboard with an upsell; does the first-timer whose only fact is one future draft get a screen about that draft; and does the whole board survive a thumb at 360px with the score and the state badge intact.

- [ ] **Step 6: Commit**

---

## Task 11: The league space

League home, standings, matchups and activity, moved into the shell and made dense. This is the largest surface area in the plan and the lowest risk, because every one of these surfaces is behavior-complete and only its rendering changes.

**Files:**
- Modify: `src/league-room/components/league-home.tsx`, `standings-table.tsx`, `matchup-panel.tsx`, `matchup-scoreboard.tsx`, `median-result.tsx`, `lineup-editor.tsx`, `activity-feed.tsx`, `league-terms-panel.tsx`, `trade-inbox.tsx`, `trade-card.tsx`, `week-nav.tsx`, `advisor-panel.tsx`, `moderation-summary.tsx` (+ their tests)
- Modify: `src/app/app/leagues/[leagueId]/**` and `src/app/app/leagues/page.tsx`

**Interfaces:**
- Consumes: every primitive from Tasks 1 and 3. Produces: no new interface. This task adds no data and no route.

- [ ] **Step 1: The league header, and the one thing a member always wants**

Crest, league name, record, seed, the next thing on the calendar, and the league's format facts as a single dense line. Everything that was a stacked card becomes a `Panel` row.

- [ ] **Step 2: Standings, dense and tabular**

`Table density="dense"` with `font-mono` numerals, the median caption Phase 3.5 Task 3 wrote kept verbatim, and the playoff cut drawn as a rule between two rows rather than as a colored row (a color-only boundary is a WCAG 1.4.1 failure and a hairline is what the mock actually draws).

- [ ] **Step 3: Matchups, with the median given its own shape**

The head-to-head block and the median block are visually distinct, per the gauntlet's finding that reusing one for the other reads as a team named LEAGUE MEDIAN.

- [ ] **Step 4: The lineup editor keeps every behavior it has**

Its select-based slot picker is the sanctioned `PositionBadge` carve-out and stays. Nothing about validation, locking or the week's status changes here.

- [ ] **Step 5: Re-run the season and live-scoring specs**

`e2e/season.spec.ts` (5 tests) and `e2e/live-scoring.spec.ts` (1) walk exactly these surfaces. Any assertion that moved because structure moved is updated in this commit with the reason in the commit body; any assertion on copy that broke means this task changed copy it had no business changing, and the copy goes back.

- [ ] **Step 6: Commit**

---

## Task 12: The draft room, retoned

The draft room is the one surface in this product that already obeys the founder's brief: full-bleed, fixed bands, no page scroll, linearize below `lg`. It needs the palette and the density, not the shape.

**Files:**
- Modify: `src/draft-room/components/room-rail.tsx`, `room-dock.tsx`, `player-pool.tsx`, `draft-board.tsx`, `tv-board.tsx`, `bid-controls.tsx`, `budget-table.tsx`, `nudge-banner.tsx`, `connection-banner.tsx`, `pick-celebration.tsx`, `room-tour.tsx` (+ their tests)
- Modify: `src/app/draft/[draftId]/board/page.tsx`, `docs/draft-room.md`

- [ ] **Step 1: The board is still the hero**

The six position stickers keep their meaning and their contrast proofs against the new ground (Task 1 re-derived them). The board's spotlight and slap animations are unchanged; both already honor reduced motion twice over.

- [ ] **Step 2: The rail, the dock and the pool take the dense scale**

Fixed band heights are re-measured against the dense type scale, because a band whose height depends on its contents moves the thing the user is watching, and the type scale just changed under them.

- [ ] **Step 3: The TV board goes darker still**

The TV board is the same frame with nobody to talk to and is designed to be read from across a room: it takes the `xl` display scale and the largest countdown, and it is the one surface where `xs` never appears.

- [ ] **Step 4: Re-run the draft specs**

`e2e/league-lifecycle.spec.ts` and `e2e/formats-and-lobby.spec.ts` both enter the room. Both are re-run here.

- [ ] **Step 5: Commit**

---

## Task 13: Responsive, accessible, and provably so

The founder's brief has three words in it that are testable: responsive, efficient, joy. The first two get a battery here; the third gets Task 14's panel.

**Files:**
- Modify: `e2e/mobile-360.spec.ts`, create `e2e/design-v2.spec.ts`
- Modify: `src/design/tokens.test.ts`, `src/components/ui/*.test.tsx` (the axe assertions), `playwright.config.ts` (a second viewport project)

- [ ] **Step 1: 360px, on every surface this plan touched**

`mobile-360.spec.ts` grows from the Plan C surfaces to the v2 set: front door, browse, hold interstitial, waiting room, locker room, league home, standings, matchup, draft room. The assertion is the existing one and it is the right one: no horizontal overflow, every control reachable, nothing clipped.

- [ ] **Step 2: The rail at every width**

At `lg` and up it is a 64px column; below, a horizontal strip that scrolls with momentum and keeps `aria-current`. The gauntlet raised the bottom-tab-bar alternative and this plan **rules against it**: a bottom bar is a second information architecture that exists only on phones, and two IAs is how a product's navigation starts disagreeing with itself. One rail, two orientations.

- [ ] **Step 3: Keyboard, end to end**

A single spec walks front door → card → hold → sign-in → waiting room → rank a slot → league home **without a pointer event**. This is the "efficient workflows" clause of the brief, tested.

- [ ] **Step 4: Contrast, in a real browser**

Component tests run without a stylesheet, so `tokens.test.ts` proves the numbers and a Playwright pass proves the pairings actually shipped: a scripted axe run with the color-contrast rule enabled on each of the nine surfaces. This is the check the design-system doc has been promising since Phase 1 ("browser-based visual contrast checks land with the e2e plan").

- [ ] **Step 5: Reduced motion**

The live pill's pulse, the celebration animations and the countdown's tick each have a reduced-motion branch and each is asserted on both sides, per the existing rule that any real branch gets both tests.

- [ ] **Step 6: Commit**

---

## Task 14: Docs, the ledger, the gauntlet, and the closing battery

- [ ] **Step 1: The decision doc**

`docs/decisions/design-v2.md`, written to the code that shipped rather than to this plan: the one-theme ruling and what it cost, the retone's contrast corrections (the two the mocks failed), the `line`/`edge` split, the dense-scale mechanism, the shell's data seam, the roll's start predicate and why the enum stayed at two, the seat hold's Postgres argument, and the deferral table with the data fact each deferral is waiting on.

- [ ] **Step 2: Drift**

`docs/design-system.md` is substantially rewritten (identity, the one theme, the new roles, the type scale, the shell, the five new primitives, the full-bleed-frames-measured-paragraphs rule, the green-is-a-fill-only-for-actions rule). `docs/conventions.md` (the new directories, the gate count unchanged at twenty-one and why), `docs/league.md` (release, roll), `docs/draft-room.md` (the retone), `docs/decisions/enforcement-and-tiers.md` (the platform door's new fullness precondition, which is the fourth thing `kickoff_at` now means), `docs/decisions/formats-and-lobby.md` and `house-leagues.md` (the roll's interaction with sit-and-go and with the house catalog), `README.md`.

- [ ] **Step 3: The roadmap row**

`plans/00-roadmap.md` gains one line recording Phase 3.6 as a founder-ordered design pass with its plan file named, and restates that the nine-phase sequence and Phase 4's position are unchanged.

- [ ] **Step 4: The inert-deliverable sweep**

Five lists, walked and asserted: every `SystemActionCode` has a publisher; every `NOTICE_TEMPLATE` has a caller; every `ColorRole` is referenced by at least one Tailwind alias in `globals.css`; every new `PublicLeagueSummary` field renders on a card; every new UI primitive has at least two callers (the extraction rule's own test). **This plan declares no name it does not wire** — if this step finds one, the name comes out.

- [ ] **Step 5: The full persona gauntlet, on the shipped surface**

Not a mockup review this time: the six personas from the two existing panels (veteran, casual, first-timer, phone user, skeptic, commissioner-curious) walk the **running product** end to end, front door to draft room. Every HIGH from the two prior panels is checked off as fixed, deferred with its reason, or refused with its reason; anything new is triaged into this plan's own fix wave or ledgered with a named owner phase. The founder's bar is the acceptance criterion and it is quoted at the top of the panel's brief.

- [ ] **Step 6: The closing battery**

`npm run infra:up` from a cold stack · both migrations applied forward · `npm run seed` · `npm run audit:verify -- --full` over every chain the seed and the e2e create · `npm run integrity:sweep` · `npm run trades:sweep` · `npm test` unfiltered · `npm run test:coverage` unfiltered with **twenty-one** gates at 100% · the whole suite routed **through PgBouncer** with the lock-order suite green at its own measured count · `npm run typecheck && npm run lint && npm run build` · **`npm run e2e` twice**, green both times, all 17 original journeys plus this plan's own, with any fixture interaction the battery exposes fixed rather than retried around.

- [ ] **Step 7: Commit**

---

## Open questions, self-ruled

1. **v2 ships as ONE committed theme, dark, and the light palette is deleted rather than left to rot.** Three facts decide it. **(a) Nobody can choose today.** `useTheme` has zero consumers outside its own file: there is no theme switcher in this product, so "both themes are first-class" currently means "the OS picks one of two looks, and only one of them was ever designed." **(b) The approved direction is dark.** All three mockups are dark-first and the founder approved them as the identity, not as a variant; a light theme derived from them by an engineer at 2am is precisely the "feels like a prototype" surface this phase exists to delete. **(c) The codebase has a rule for this exact shape.** A control wired to nothing has been refused five times here; a second palette nobody designed, nobody approved and nobody can select is that control with a color picker on it. This is wrong if a meaningful share of users would abandon a dark-only product, which no evidence in this repo suggests and which the entire premium tier of this category contradicts. **The reversal cost is deliberately kept low:** `TOKENS.color` stays one shape, `generate-css.ts` keeps emitting from it, and re-introducing a second palette later is the same diff run backwards.

2. **The token roles are RETONED, not forked, and `border` is renamed to `line`.** One `tokens.ts`, one `ColorRole` union, one generated stylesheet. The rename is deliberate churn: v2 needs two boundary concepts (a decorative hairline at 1.26:1 and an interactive edge at 3:1), and leaving the old name on the decorative one would have every future `border-border` quietly failing WCAG 1.4.11 on a control. A compile error at 200 call sites is the cheapest possible way to ask that question once.

3. **`textFaint` moves off the mock's own value, and the mock is wrong rather than the threshold.** `#6B7488` on `#161920` is 3.75:1, used at 12px for card meta, step captions and table subtext across all three mockups. WCAG 1.4.3 wants 4.5:1 for normal text. The token moves to `#808A9E` (about 5:1) and the mock's `#6B7488` survives as the new `edge` role, where 3:1 is the correct bar and it clears it. Both values stay in the product; each does the job it actually passes.

4. **A panel's boundary may be decorative and an interactive boundary may not.** `#111318` on `#0B0C0F` is 1.05:1 — v2's panels are separated by their hairline alone. That is legitimate for a card (a decorative container is not a "user interface component" under 1.4.11) and illegitimate for a button, an input or a focus ring, which is why `edge` exists and why every interactive boundary in this plan uses it. Stating the distinction is what stops a future engineer from "fixing" the hairline to 3:1 and destroying the look, or from reusing the hairline on a control and destroying the accessibility.

5. **Green is both the accent and the positive, and the doubling is defended by shape rather than by context.** The existing "one pigment, two jobs" rule kept a doubled pigment safe by keeping its two uses out of each other's context; v2's green appears in the same contexts, so the rule is restated as a shape rule: **an action is a solid green fill; an outcome is green text, a green glow or a green meter fill, never a solid block.** This is wrong if two elements ever need to be a solid green fill for different reasons on one screen, which the mocks never do.

6. **Barlow Condensed is retired and `font-display` keeps its name.** The v2 identity is one family in two roles, and the condensed poster face is the strongest single "old software" signal in the current product. Keeping the utility name means 100+ call sites do not churn for a decision that is entirely about which file the font comes from. This is wrong if the poster-board identity was load-bearing for the brand, which the founder's rejection of the current frontend settles.

7. **The type scale is emitted twice from one source, and no component writes a responsive size utility.** A dense desktop and a comfortable phone are the same scale at two settings, not two scales; expressing that as `text-sm lg:text-xs` at every call site is the page-local visual mapping rule violated 400 times. The media query lives in the generated stylesheet, where the tokens already live.

8. **The shell is a component, not a route group layout.** Next.js layouts would have been the idiomatic home, and `AppShell` is a component the pages render instead, for one reason: a layout cannot receive the page's own `currentLeagueId`, and the rail's `aria-current` is the difference between navigation and a row of tiles. Every page already computes which league it is about; passing it one prop is cheaper than a context nobody else reads.

9. **The rail's data is one function every page calls, not a context and not a per-page query.** `shellData(db, user)` is one round trip, reusing what `crossLeagueHome` already reads. A context would need a client boundary the shell does not otherwise have; a per-page bespoke query is how two pages start disagreeing about which league is live.

10. **The league crest is derived initials on a deterministic tone, and there is no crest column.** A stored crest is an asset pipeline, an upload surface and a moderation problem (Phase 4's object store is a founder gate). Derived initials cannot go stale against a rename, need no migration, and reuse `AvatarTone`'s existing deterministic hash so a league and its members are visibly one object.

11. **The attention queue is derived-only and therefore has no dismiss control.** The gauntlet filed the missing dismiss as HIGH, and the fix is upstream of the control: every chip names an unfinished action, so finishing the action clears it, and a chip nobody can act on never renders at all. A snooze would need per-user per-item persistence, a new table and an expiry policy, to solve a problem caused by rendering un-actionable chips in the first place.

12. **The live pill renders only from the real week state, and off-season it renders nothing.** "SUNDAY · 7 GAMES LIVE" is the mock's best energy and it is one query away from being a lie. No pill is better than a pill that pulses on a Tuesday in July.

13. **"Locker Room" stays an internal name and does not ship as visible vocabulary this phase.** It appears only in the mock's `<title>`; making it a product term is a naming decision with a first-timer jargon cost the gauntlet already flagged, and this phase has no budget for teaching a new word. The `<h1>` on `/app` keeps the string the e2e suite already asserts, which is also the cheapest possible protection for four journeys that walk that page. Ledgered as a founder question, not decided by an engineer inside a design pass.

14. **The start predicate becomes "full AND kickoff reached", and `drafts.start_trigger` stays two members.** Collapsing to one `when_full` trigger with a not-before time would delete a distinction the product genuinely makes: a scheduled league's time is a promise twelve people planned around (which is why filling early does **not** move it, per `FILL_TRIGGER_REFUSALS.notWhenFull`), and a sit-and-go's time is whenever the room is ready. One predicate, two promises, two sentences on screen.

15. **The fullness gate binds the platform door only, and the commissioner's press keeps its two-team floor.** The founder's ruling is absolute and this is the one place the plan does not apply it literally, for a dead-end reason: there is no league-settings write path in this product, so a private commissioner whose twelfth friend never signs up would have no way to ever draft, in a league nobody else can start. The platform door is the door where nobody chose the time and nobody can press the button. **Flagged for the controller.**

16. **The roll is uncapped, and the seat release is what makes that humane.** A cap would mean either drafting a short room (which the ruling forbids) or cancelling a league (which nothing in this product can do). An uncapped roll plus a door out is a league that waits as long as it needs to and never traps anybody, which is exactly the founder's sentence read literally.

17. **The roll writes with a guard on the kickoff it read, never with a lock.** PgBouncer forbids advisory locks, so exclusion comes from the write, on the precedent `claimAutoStart` and the nudge claim already set. Two instances rolling one draft on one tick resolves to one update and one clean no-op.

18. **The seat hold lives in Postgres and expires by predicate.** Redis is this product's delivery mechanism, never its record of a disputable fact, and capacity is the most disputable fact a lobby has. Expiry as a `WHERE expires_at > now` predicate needs no sweeper, no scheduler and no session state, which is the same level-triggered argument the house reconciler already makes.

19. **Per-manager history tags are REFUSED, not deferred.** "3rd season on Commish" beside a name in a room list discloses precisely the per-member participation tier that `compositionCategory`'s server-side coarse reduction exists to hide, and the reduction's own reasoning ("an aggregate over N=1 is not an aggregate") applies verbatim to a twelve-row list. This is a privacy ruling, and a design phase does not get to reverse one.

20. **The board renders margin, not probability, and no narrative moments.** Deferrals D1 to D3 name the missing model and the missing feed. A subtraction the product can do, rendered honestly, beats a percentage it cannot, and the skeptic persona is the one who decides whether this product is trustworthy at exactly the moment money starts moving.

21. **No new realtime event type.** A rolled kickoff and a released seat reach their members on `notice.created`, which already exists and is already delivered. Live seat counts for signed-out visitors would need a new anonymous SSE fan-out (deferral D4) and are the only thing here that would have justified one.

22. **Exactly one new icon.** `plus` has no honest spelling among the eighteen. Everything else in three mockups reuses: `shield` is the house, `clock` is a countdown, `users` is a room filling, `check` is a done checklist item, `chevron-right` is every "go" link.

23. **No new config file.** The roll cadence, the seat hold and the proof floors are lobby tunables and sit in `MATCHMAKING_CONFIG`, which is browser-safe, so the sentence a member reads and the number the server enforces are the same number. The rail width, the meter and the countdown's hero size are primitive tunables and sit in `UI_CONFIG`.

24. **No new coverage gate, no ninth exempt directory, and the `src/design` + `src/components` hole is stated rather than fixed here.** Every new pure module lands in an already-gated directory. `src/design/**` and `src/components/**` are not gated today; gating them means bringing 40 primitives to 100% branch coverage, which is a real piece of work and does not belong inside the phase that is rewriting all of them. Naming the hole is better than hiding it or fixing it badly.

25. **The seat release rides `member_joined` with a payload outcome.** `AUDIT_EVENT_TYPES` is a frozen pg enum; a seat release has a human actor so it cannot ride `system_action`; and Plan C already set the precedent of a frozen type carrying two outcomes discriminated on the payload. It is ugly and it is the least-bad option under a constraint this plan is not entitled to relax. **Flagged for the controller.**

26. **Five primitives, each extracted at its second caller, and three existing primitives extended rather than forked.** The founder's rule says the first time, and "the first time" in practice means the moment a second caller exists — which for `Panel` is eleven callers and for `Crest` is four. There is no `DenseTable` and no `LivePill`: a density and a glow are properties of the primitives that already own those jobs.

27. **The e2e suite's copy assertions are load-bearing and its structure assertions are not.** A redesign that is allowed to loosen a selector to keep a suite green has converted its tests into decoration. Structure moves deliberately, in the commit that moves it; copy that breaks means the task changed something it should not have.

---

## Deferred and refused, each with the fact it is waiting on

| # | Item | Decision | The fact it waits on |
|---|---|---|---|
| D1 | Win-probability model, live, per league, for head-to-head and median | **Deferred** | No model exists anywhere in `src/`, and per-player game state is not on the wire. A percentage with a bar and no methodology was the gauntlet's HIGH against the mock; the board ships margin instead. |
| D2 | Narrative "moments" feed (red zone, "just went for 44") | **Deferred** | Requires live play-by-play ingestion plus per-matchup templating. The stats pipeline ingests box-score stats, not plays. A moment feed that is silent during a real red-zone snap breaks trust with the exact persona watching closest. |
| D3 | Live injury feed and season projections | **Deferred** | No injury feed and no projection engine. A wrong "OUT" tag is worse than no tag, and "projected 4-2" is a model output. Both are cut from the subhead and the queue. |
| D4 | Live seat counts over SSE for signed-out visitors | **Deferred** | Would need an anonymous SSE fan-out this product has never had. What ships instead is genuinely better for the trust problem: a server-rendered count, an "as of" line, and the seat hold making the number *true* rather than merely fresh. |
| D5 | Practice-pick sandbox | **Deferred** | Needs an isolated draft simulation with a non-human drafter, which is the same schema obstacle Phase 3.5 ruling 25 documented (`teams.user_id` is `NOT NULL`) and the same Phase 6 destination. The checklist ships the existing `RoomTour` instead, which is real. |
| D6 | Per-manager season-history and "verified reviewer" tags | **Refused** (ruling 19) | Re-opens a closed privacy decision. Not a build-cost question. |
| D7 | Projection columns on the board and the pool | **Deferred** | Same missing engine as D3. |
| D8 | Seat-hold lock mechanism | **INCLUDED — Task 6** | Was the largest missing mechanism behind the front door's own promise. |
| D9 | Bench points on the home board | **Deferred** | The veteran's HIGH. Scoring every bench player across every league on the home screen is a new read path with a real cost, and it is a feature request rather than a design decision. Ledgered with a named next phase. |
| D10 | Cross-league conflict detection ("swap in both") | **Deferred** | The gauntlet called it the standout premium feature and it is: it needs roster diffing across independent league instances plus a multi-league write path. Ledgered as the single highest-value follow-on this phase identified. |
| D11 | Dynasty and keeper filters, waivers, trade deadline on the card | **Refused for this phase** | None of them exists in the product. A card field for an absent feature is a lie with a label on it. |
| D12 | Push notifications for sit-and-go fills | **Deferred** (founder gate) | No email sender and no push infrastructure. In-app notices only, and the when-full copy promises exactly what in-app delivery can keep. |

---

## Self-review

**Founder-bar coverage, clause by clause:**

| The bar | Where |
|---|---|
| "Most premium experience in the fantasy world" | Tasks 1, 3 and 12: one committed palette, five primitives, and the draft board kept as the hero it already is |
| "Sleek, modern, beautifully simplistic" | Task 1's retone and font retirement; Task 3's five shapes replacing eleven bespoke ones |
| "High information density" | Task 1's dual type scale, Task 3's `Table density`, Tasks 10 and 11's dense boards and tables |
| "Maximize full screen width" | Task 2, in one deletion: every `max-w-4xl` under `/app` is gone, with the measured-paragraph carve-out stated |
| "Responsive" | Task 2's rail at two orientations, Task 13's 360px battery across nine surfaces |
| "Most efficient workflows possible" | Task 6's hold (three steps, stranger to seated), Task 9's inlined ranking and resequenced checklist, Task 10's next-action column |
| "A true joy to use" | Task 13's keyboard walk and reduced-motion branches, Task 14's persona gauntlet against the running product |
| "Best app I've ever seen or used" | Task 14 Step 5 is the acceptance test, run against the product rather than a mockup |

**The four named pain points:** *visual design* is Tasks 1 and 3; *layout and navigation* is Task 2, which is the first shell this product has had; *no wow or energy* is Task 10's live pill, board and open-seats shelf, all rendering from real data; *feels like a prototype* is answered in four specific places — the retired condensed face, the deleted 896px column, the front door's numbers becoming queries, and the seat-hold promise becoming a mechanism.

**Founder-ruling coverage:**

| Ruling | Where |
|---|---|
| ALWAYS ROLL UNTIL FULL | Task 7, as server-side truth. The cadence is `MATCHMAKING_CONFIG.roll`, members are told by a `draft_kickoff_rolled` notice, releasing a seat is Task 8, and it composes with the existing auto-start (a fullness precondition on the same scan) and the sit-and-go trigger (unchanged, plus the `fill_fired_at` fix the release makes necessary). The model is argued in ruling 14 and the enum stays at two |
| PROOF STATS REAL ONLY | Task 4: three queries, three floors in config, per-stat and whole-strip hiding, and a rating that ships with its count and a link to the reviews it came from |
| Half-PPR foundation, PPR one tap away | Already shipped in Phase 3.5 Task 1; v2 renders the labels and re-decides nothing |
| House leagues are the core | Task 5's shelf and Task 10's open-seats panel are the v2 rendering of the house catalog; Task 7's roll makes a house league's stated draft time honest |
| Design bar | The table above |

**Missing states, all five folded in:** the seat-hold interstitial (Task 6 Step 4), the race loser (Task 6 Step 4), the tier refusal moved before the click (Task 6 Step 4), the when-full waiting variant (Task 9 Step 2), and the missed-draft state (Task 9 Step 1's test and Step 2's variant).

**Placeholder scan:** no `TODO`, no `TBD`, no "handle errors appropriately", no step whose expected output is unstated. Every file in the File Structure tables appears in a task's Files block. Six places name a helper the executing engineer writes to taste rather than showing it in full — `crestTone`'s hash (copies `avatarTone`), `describeStartTiming`'s branches (copies `formatDraftTime`), the four new component bodies, the correlated seat-count SQL (copies `browseQuery`'s `HAVING`), `shellData`'s grouped read (copies `home.ts`'s existing grouped reads), and the axe-in-Playwright harness (copies `mobile-360.spec.ts`'s page loop) — and each names the existing file in this repo whose shape it copies.

**Type consistency:** `ColorRole`, `RailLeague`, `LiveState`, `ProofStats`, `SeatHoldOutcome` and `RollOutcome` are each declared once, the union-derived-from-a-tuple shape this codebase already uses for `REALTIME_EVENT_TYPES`, `AUDIT_EVENT_TYPES`, `SYSTEM_ACTION_CODES` and `PARTICIPATION_TIERS`. Nothing here declares a second type for something that already has one: a crest is not an avatar (it is a league's tile, sharing the avatar's tone palette), and a hold is not a membership.

**Boundary check:** `src/matchmaking/roll.ts` and `seat-hold.ts` are pure and browser-safe, which is precisely why the roll's sentence and the hold's arithmetic live there — the waiting room value-imports them legally (`src/matchmaking` is one of the eight exempt directories) and the server enforces the identical rule. `src/league-service/**`'s four new modules are server-only and reached from the browser over the wire. `src/components/**` and `src/design/**` are shared UI, imported by both sides today, unchanged by this plan. `src/app/**` is exempt by design. Nothing under `src/**` imports `e2e/**` or `scripts/**`.

**Founder rules:** five persona panels, each a marked step, split by audience because a stranger at the door, a visitor mid-signup, a member waiting on a room, a manager on Sunday and the whole product judged end to end are five different people with five different fears. Every user-facing string quoted in this plan is em-dash and en-dash free, active, and free of `accusatoryTerms` and `passiveConstructions`; the five sweeps enforce it and every new component joins `rendered-copy.test.tsx` in the task that creates it. One new icon, five new primitives all extracted at a second caller with existing consumers refactored in the same commit, three existing primitives extended rather than forked. No mock data on a real surface: the proof strip, the live pill, the seat count, the board and the rail's state dots each render from a query or do not render.

**Three things this plan deliberately does not do.** It does not touch **money** in any form. It does not add a **production scheduler** — the roll rides the ticker that already runs auto-start and the house reconciler, and the seat hold expires by predicate with nothing to run. And it does not add a **second information architecture for phones** (one rail, two orientations), because two IAs is how navigation starts disagreeing with itself.

## The founder-gated bucket, unchanged

| Gate | What this plan ships without it |
|---|---|
| Platform-verified client IP + Redis-shared limiter counters | The seat-hold route is the one new unauthenticated write path here; it is per-league capacity-bounded by construction (a token can hold at most one seat and a full league refuses every hold), which is a stronger limiter than a counter for this specific abuse |
| An email sender | In-app delivery only. The roll notice and the release notice are both in-app, and the when-full copy promises exactly what in-app delivery can keep (D12) |
| A production scheduler | The roll rides the existing ticker; the hold needs none at all |
| An object store | Ruling 10: crests are derived initials, not uploads |
| A banking partner and gaming counsel (Phase 4) | Stake tiers stay cosmetic; the front door says every league is free this season, which is true |
| Sentry, Fly.io, managed Postgres/Redis | Unrelated to every task here |

---

## Controller rulings (recorded at plan commit, 2026-08-23)

The planner flagged six risks. Ruled as follows; each ruling binds execution:

1. **Dark-only: ACCEPTED.** The founder approved the dark mocks as the identity and set the premium bar; the light palette is undesigned, unselectable, and unapproved. The reversal cost is documented as low. Ledgered as overriding `docs/design-system.md`'s both-themes rule.
2. **Commissioner's two-team floor: ACCEPTED.** The dead-end argument holds (no league-settings write path exists; a literal application would strand private leagues with no draft path forever). The warning copy ships. If the founder wants the ruling literal everywhere, a resize-or-cancel path is net-new scope for a later phase.
3. **Seat release audits as `member_joined` + `payload.outcome`: ACCEPTED.** Plan C's frozen-enum precedent applies; unfreezing the enum is forbidden in writing and this plan is not entitled to relax it.
4. **Seat hold stays in scope: ACCEPTED.** The no-MVP directive and the copy-without-mechanism rule both require it; cutting it would mean cutting the front door's step 01 promise.
5. **Sequencing: execution runs Task 6 BEFORE Task 5** (strict dependency order). Plan numbering is unchanged; the executor takes them 1, 2, 3, 4, 6, 5, 7, 8, ...
6. **Task 2 splits into page-group commits** within the one task (app home / league pages / admin+account / public), each group re-running the e2e specs that walk it, to keep the highest-regression-risk change reviewable.
