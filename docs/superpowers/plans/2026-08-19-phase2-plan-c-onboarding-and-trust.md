# Phase 2 Plan C — Onboarding, Identity and the Trust Surfaces

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the product legible and trustworthy to the person using it. A new manager lands somewhere that tells them what to do next instead of a wall of three equally-loud forms; every manager has a face and a name they chose rather than whatever WorkOS scraped off their SSO profile; the words the product uses have definitions attached where a first-timer meets them; a league states its terms before you agree to them and keeps stating them after you join; and the product carries an unfiltered review feed, because a money product that only shows the reviews it likes has told you what its reviews are worth.

**Architecture:** Five strands, all of them buildable with nothing but this laptop and Docker. **(1) Identity without a bucket.** `users.avatarUrl` stops being "a URL WorkOS gave us" and becomes an **avatar ref**: `preset:<key>` for the built-in set, an `https://` URL for what WorkOS supplied, nothing for initials. Presets are code (an `IconName` plus a token pigment), so a face costs no object store, no CDN and no Plan D. One pure `parseAvatarRef` decides, one `Avatar` primitive renders, and the profile surface behind `PATCH /api/profile` is the first write path this product has ever had for `displayName`, `experienceTier` or an avatar. **(2) First-run as a fork, not a wall.** `/app` today stacks join, browse and create underneath the board for everybody forever. A pure `firstRunPlan(...)` orders those three paths by what the manager told us about themselves and how many leagues they are actually in, and the zero-leagues `EmptyState` Plan B deliberately left plain becomes that fork. A `user_preferences` row carries the two per-user pieces of state the plan genuinely reads: a help level and the draft-room tour's one-time dismissal. **(3) Words with definitions.** A glossary registry plus one new `InfoTip` primitive (click, not hover, because hover-only help is a WCAG failure and a phone has no hover), wired into the four places jargon first hits a newcomer. **(4) League terms, before and after.** One pure `leagueTerms(...)` renders the same facts on the invite landing page (where you decide) and inside the league (where you live), so a prospect and a member can never be told two different things about the same league. **(5) Trust surfaces.** An unfiltered review feed whose feed query provably contains no rating predicate, moderation scoped to abuse with the removal recorded as a row rather than a vanishing act, and a `GifProvider` seam built exactly the way Plan A built Tank01: a real adapter proved against committed fixtures, keyless-mergeable, degrading to text-only chat until a key exists.

**Tech Stack:** TypeScript strict · Next.js 15 App Router · React 19 · Drizzle ORM over Postgres 17 (`drizzle-orm/postgres-js`) through PgBouncer in transaction mode · Redis 7 (Streams → SSE) · WorkOS AuthKit · Zod v4 · Vitest + happy-dom + @testing-library/react + vitest-axe · Playwright.

**Spec:** `plans/phase-2-accounts-and-data-foundation.md` — **Step 14** (lines 542–573), **Step 15** (lines 577–607, preset half), **Step 16** (lines 611–641, GIF half), **Step 17** (lines 645–677). Phase split and plan boundaries: `docs/superpowers/plans/2026-08-19-phase2-overview.md`. What Plan B landed, its twenty rulings, and the persona backlog it ledgered: `.superpowers/sdd/2026-08-19-phase2-plan-b-live-scoring/progress.md`. Phase 1's residual persona backlog: `.superpowers/sdd/2026-08-18-phase1-plan-f-matchmaking-and-e2e/progress.md` (Track A Task 6).

**Depends on Plan B for:** the `/app` cross-league home this plan forks (`crossLeagueHome`, `HomeBoard`, `HomeLeagueCard`), the plain zero-leagues `EmptyState` Plan B built and **explicitly deferred to this plan** ("The empty state is the one Plan C extends with the onboarding fork"), `WeekStatusBadge` and `NextAction` as the vocabulary the fork must not contradict, and the eighth coverage gate whose pattern this plan follows four more times.

**Depends on Plan D for nothing.** Every task runs against the local docker-compose stack. No object store, no CDN, no Giphy key, no deployed URL, no Sentry DSN. The three places where Plan D's resources would change behavior are named explicitly and are each a config value or a single predicate, not undelivered code: `AVATAR_CONFIG.uploads` (false until there is a bucket), `IDENTITY_CONFIG.notifications.deliverableChannels` (`["in_app"]` until there is email), and `GIF_PROVIDER` (`none` until there is a key).

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the codebase's own rules.

**From `docs/conventions.md`:**

- **Directive: no MVP.** *"I don't want an MVP. Let's work towards the end solution."* Phases sequence **scope** (money, tax, native apps come later), not quality. Nothing gets built in a form a later phase plans to throw away.
- **Stack is pinned.** Postgres 17 via Drizzle ORM (`drizzle-orm/postgres-js`, `postgres` driver). Redis 7 Streams → Server-Sent Events is *"the one and only real-time mechanism"*. Auth is WorkOS AuthKit: *"We do not roll our own auth."* Validation is Zod v4 (`z.email()`, not the deprecated `z.string().email()`).
- **`docker-compose.yml` pins a top-level `name: fantasy`**, so every git worktree resolves to the **same** Compose project. Run `npm run infra:up` from any worktree; they all talk to one shared stack.
- **Immutability.** Domain types are `readonly`; use `readonly T[]` / `Readonly<Record<…>>`. Update by spreading into new objects. Enforced for `src/domain/**` by `eslint-plugin-functional` (`functional/prefer-readonly-type`, `functional/immutable-data`, `functional/no-let`).
- **Timing — no ambient clock in domain/reducer code.** Anything time-dependent takes a `Clock` (`src/domain/timing.ts`) and calls `clock.now()`. Actions carry an explicit ISO `timestamp`. Tests inject a fixed clock. `Date.now()` / `new Date()` are only allowed at the outermost edge (route handlers, `current-user.ts`, `publisher.ts`).
- **Identity — one seam, WorkOS underneath.** Server code reads "who is this" **only** via `getCurrentUser()` / `requireCurrentUser()` from `src/lib/auth/current-user.ts`. `users.id` **is** the WorkOS user id. API and SSE routes never redirect — they return a JSON 401 themselves.
- **Real-time — one mechanism.** Writes are plain HTTP: validate → persist to Postgres → then `getPublisher().publish(...)`. **Postgres is authoritative; publishing is best-effort and must never fail the write.** Delivery is Redis Streams over SSE, stream key `league:<id>:events`, read with plain `XREAD BLOCK`. **Never `XREADGROUP`.** Event types are enumerated once in `src/lib/realtime/events.ts`. No Socket.io, no managed realtime vendor, no second transport — ever.
- **Draft state — the action log is the source of truth.** An in-progress draft's state is *derived*, by replaying `draft_actions` through the pure reducer in `src/draft-engine/`. Every accepted action is persisted before it is cached or published, and `teamId` is always resolved from the authenticated session, never from a request body.
- **Client boundary.** Everything under `src/draft-room/**`, `src/league-room/**` and `src/chat-room/**` is BROWSER code. Each talks to its service layer ONLY over the wire — never by importing `@/draft-engine`, `@/draft-service`, `@/league`, `@/league-service`, `@/chat-service`, `@/ai-advisor`, `@/db`, `@/lib/realtime`, `@/lib/auth`, `@/lib/leagues`, `@/lib/llm`, `@/lib/api/respond`, `@/data/seed` or `@/stats-pipeline` as VALUES. `import type` stays allowed. The rule is deliberately **not** applied to `src/app/**`. Exempt pure directories that browser code MAY value-import: `src/chat/**`, `src/matchmaking/**`.
- **API responses.** Every JSON route returns the envelope from `src/lib/api/respond.ts`: `{ ok: true, data }` or `{ ok: false, error }` with a meaningful HTTP status. Bodies are parsed with `parseJson(request, ZodSchema)`; a bad body is a 400 naming the field. **Error strings are user-facing plain language — never raw DB/exception text.**
- **Config over magic numbers.** Thresholds, limits, durations, key formats live in a `config.ts` next to the module that uses them (`LEAGUE_CONFIG`, `REALTIME_CONFIG`, `DRAFT_QUEUE_CONFIG`, `UI_CONFIG`, `MATCHMAKING_CONFIG`, `STATS_INGESTION_CONFIG`, …). No inline literals for tunables.
- **Tests.** **Test-first.** Tests live beside the code: `src/<feature>/**/*.test.ts`. Verification commands filter by directory: `npm test -- src/identity`, never by a guessed filename. Integration tests hit the **real** test Postgres / Redis from docker-compose — not mocks. Use `createTestDb()` + `truncateAll(db)` in `beforeEach`. Test files run serially (`fileParallelism: false`).
- **Coverage threshold: 100%** for the gated directories, configured in `vitest.config.mts` with `coverage.include` **and** a matching `thresholds` block (Plan A's fix wave proved an `include` entry with no threshold is not a gate at all). Eight gated directories on `main` today: `src/scoring`, `src/draft-engine`, `src/draft-room/state`, `src/league`, `src/chat`, `src/matchmaking`, `src/stats`, `src/stats-pipeline`. **This plan adds four** (Task 11, ruling 20). Verify with an **unfiltered** `npm run test:coverage`.
- **Browser end-to-end** lives in `e2e/` and runs under Playwright against a production build and the real docker-compose stack (`npm run e2e`). **There is no dev auth bypass and none may be added.**
- **Any step shipping a user-visible surface additionally requires:** a design review against `docs/design-system.md`; loading/empty/error/success states all designed; an automated a11y check plus a keyboard-only walkthrough of the primary flow; a plain-language copy review; renders and operates at 360px width.
- **Migrations.** `ADD COLUMN … NOT NULL` without a `DEFAULT` is acceptable only while the table is empty (pre-first-deploy, as in `drizzle/0001`); once deployed, add with a DEFAULT or backfill in a separate migration.
- **Commits.** Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`). Commit after every completed step; commit bodies explain *why* and record any deviation from the plan.
- **Environment.** `.env.example` is committed; `.env.local` is gitignored. Fail fast with a clear message when a required var is missing (see `db/client.ts`, `realtime/redis.ts`).
- **Verification commands (every step):** `npm run typecheck && npm run lint && npm test && npm run build`

**From `docs/design-system.md`:**

- **No raw hex, no raw px, no arbitrary values in feature code.** `src/design/tokens.ts` is the only file allowed to contain a color literal.
- **Never a dead end.** Empty and error states always offer an action (`StatePanelProps.action` is required, not optional, and `EmptyState`/`ErrorState` inherit that).
- **Both themes are first-class.** Every surface is designed and tested in light and dark, via `inBothThemes` from `src/components/ui/test-utils.tsx`. **Mobile-first**, minimum viewport 360px. WCAG 2.2 AA.
- **Copy.** Plain language, active voice, specific. Errors say what happened and what to do next.
- **`Icon` is the one icon entry point. Feature code never imports `lucide-react` directly.** `IconName`s on `main` today: `trophy`, `users`, `clock`, `alert-triangle`, `inbox`, `refresh-cw`, `check`, `x`, `chevron-right`, `search`. Task 1 adds six.
- **`PositionBadge` is the only way to render a position label; `Sticker` is the only way to render a position-pigmented tile.** Nothing else may reach for `bg-pos-*` directly.
- **Never set the display face on a paragraph.** It is a lettering face, not a reading face.
- Tunables for primitives live in `src/components/ui/config.ts` — never inline in a component.

**From `docs/decisions/data-layer-hardening.md` (Plan A):**

- **Balance as rollup.** Any running total is a rollup row updated **in the same transaction** as each contributing write, over an append-only source table that stays the reconciliation source of truth. Never a `SUM()` on the read path. The threshold is unbounded growth: derive over a bounded set, roll up over an unbounded one.
- **PgBouncer transaction pooling forbids session state.** No `pg_advisory_lock`, no named prepared statements (`prepare: false` is unconditional), no `SET` outside a transaction, no session-scoped temp tables, **no `LISTEN`/`NOTIFY`**. DDL goes through the direct port, never the pooler.

**Founder rules (binding, from the phase overview and founder memory):**

- **No em-dashes in user-facing copy.** Not in component text, not in error strings, not in seed data, not in `.env.example` comments a developer reads as product copy. Source comments may use them; the codebase already does.
- **Persona-panel pass on every new user-facing surface**, marked as an explicit step. The controller runs the panel (high-stakes veteran, social casual, commissioner, first-timer); the plan only marks where. **Six panels in this plan** (Tasks 3, 5, 6, 8, 9, 10), each covering a coherent cluster of surfaces rather than one component.
- **Centralize UI primitives the first time.** No page-local visual mapping; extract to `src/components/ui/` and refactor the existing consumer in the same commit.
- **No mock data on real surfaces.** A preset avatar is not mock data (it is a real choice a real user made); a fake GIF result would be.

**Plan-C-specific constraints (each ruled in "Open questions, self-ruled" at the end):**

- **`users.avatarUrl` becomes an avatar *ref*, and only `https://` is ever rendered as an image.** After this plan the column is user-writable, which makes it an injection surface; `parseAvatarRef` renders initials for anything that is not a known preset or an `https://` URL, and there is a test naming `javascript:` and `data:` specifically.
- **Nothing in this plan uploads a file.** Presets are code. The upload path is Plan D's, gated behind `AVATAR_CONFIG.uploads`, and the ref scheme is what makes it a one-implementation change rather than a schema change.
- **No preference ships as a switch wired to nothing.** The `user_preferences` row holds only preferences this plan actually reads. Email notification is modeled, catalogued and *named on the surface as not connected yet*, with no toggle, until Plan D delivers the sender.
- **The review feed's freedom from curation is asserted against the query, not the copy.** A test proves the feed's SQL carries no rating predicate and that a 1-star review appears in the same position ordering would put any other review.
- **The GIF adapter is keyless-mergeable**, exactly as Plan A's Tank01 adapter was: real HTTP client, fetch injected, committed fixtures with a provenance manifest, and every test in the task passes unchanged the day a real key re-records them.

---

## What is already true (read before touching anything)

| The spec assumes | Reality on `main` today (4531a82) |
|---|---|
| Step 14 needs a new post-signup onboarding route | `src/app/callback/route.ts` already routes every sign-in to `/app` via `handleAuth({ returnPathname: "/app" })`, and `/app` already renders **all three** of the spec's paths: `JoinLeagueEntry`, a `/browse` link and `CreateLeaguePanel`, stacked under the board, for every user forever. The gap is not that the paths are missing. It is that they are undifferentiated: a first-timer with zero leagues and a veteran with ten see the identical wall. **This plan forks that page; it does not add an onboarding route.** (Ruling 6.) |
| Step 14 branches on `User.experienceTier` | The column exists (`users.experience_tier`, default `beginner`) and is read by league creation and public browse. **Nothing in the product has ever written it.** `syncUserFromWorkOS` sets `displayName`/`experienceTier`/`avatarUrl` on first creation only, and its docblock says they are "never clobbered by a later sync — the user may have edited them in-app." There is no in-app edit. Task 2 is that write path, and it is the reason Step 14's fork can branch on anything at all. |
| Step 15 adds an `avatarUrl` field | It exists, and it is already rendered in three places (`message-list.tsx`, `tv-board.tsx`, and `draft-board.tsx` for players) through a real `Avatar` primitive with an `initialsFor` fallback. What does not exist is any way for a user to choose one, and any validation of what the column holds. |
| Step 15's presets need a place to live | They need no place. A preset is an `IconName` plus a token pigment, which is code. The object store is only ever needed by the **upload** half, which the overview carved out to Plan D. |
| Step 16 needs a `chat.gif` event type | The taxonomy already carries `chat.message`, and a GIF **is** a message. Adding `chat.gif` would mean two publish paths and two client folds for one row. Ruled against, in ruling 17, contradicting the spec deliberately. |
| Step 17's moderation needs "an admin removal action" | **There is no admin or staff concept anywhere in this codebase**, and Phase 3 owns moderation and audit infrastructure outright. Inventing a staff role here would be building the thing Phase 3 plans to build properly. Removal is an operator script writing an immutable removal row; the report affordance is in-product. (Ruling 18.) |
| A tooltip exists to hang a glossary off | It does not. `src/components/ui/` has no Tooltip, no Popover, no Textarea, no Checkbox. Task 6 adds `InfoTip` and Task 9 adds `Textarea`, both as centralized primitives per the founder correction of 2026-08-18. |
| The invite landing page tells you what you are joining | `src/app/app/join/[code]/page.tsx` renders exactly: "You've been invited to a league. Invite code ABC123." and a **Join this league** button. It names no league, no format, no size, no scoring, no stake tier, no commissioner. In a product about to hold real money, that is the trust gap this plan's Task 7 closes. |
| A league's own settings are visible to its members | They are not. `LeagueHomeBody` carries `format`, `teamCount` and `rosterSlots` but nothing renders the roster shape or the scoring weights, and the commissioner is identified only by the fact that *you* are or are not them (`isCommissioner`). Nobody in a league can currently see who runs it. |
| `PublicLeagueSummary` could just gain a scoring field | It is the documented privacy boundary for the one unauthenticated route in the product, and `browse.test.ts` fails on any extra wire key. Adding the Phase 1 backlog's "scoring format on cards" is a deliberate disclosure decision, taken in Task 6 with its reasoning, not a field append. |
| `scoring_settings` stores which preset was chosen | It does not. It stores fifteen `real` weights. A human-readable scoring label has to be **derived** from those weights, which is a pure function and belongs in the already-gated `src/scoring/**`. |

---

## File Structure

**New — the pure identity layer (`src/identity/**`, joins the coverage gate):**

| File | Responsibility |
|---|---|
| `src/identity/config.ts` | `IDENTITY_CONFIG`: display-name bounds, the avatar ref prefix, `notifications.deliverableChannels`, `AVATAR_CONFIG.uploads`. Every tunable this plan's identity code reads. |
| `src/identity/avatars.ts` | `AVATAR_PRESETS`, `AvatarRef`, `parseAvatarRef`, `avatarRefValue`, `presetByKey`. The one place a stored string becomes something renderable. |
| `src/identity/first-run.ts` | Pure: `firstRunPlan(input) → FirstRunPlan` — which of create / join / browse leads, and what the page says above them. |
| `src/identity/preferences.ts` | Pure: `PreferenceState`, `defaultPreferences(user)`, `isDraftTourDismissed(prefs)`. |
| `src/identity/notifications.ts` | Pure: `NOTIFICATION_CATALOG`, `NotificationChannel`, `deliverableChannels()`, `channelStatus(channel)`. The seam Plan D's email sender plugs into. |

**New — the pure help layer (`src/help/**`, joins the coverage gate):**

| File | Responsibility |
|---|---|
| `src/help/config.ts` | `HELP_CONFIG`: which terms are surfaced at which help level. |
| `src/help/glossary.ts` | `GLOSSARY`, `TermKey`, `term(key)`, `termsFor(surface)`. Every definition the product shows, in one registry. |

**New — the pure review layer (`src/reviews/**`, joins the coverage gate):**

| File | Responsibility |
|---|---|
| `src/reviews/config.ts` | `REVIEW_CONFIG`: rating range, body bounds, page size, report reasons. |
| `src/reviews/contract.ts` | Types only: `ReviewView`, `ReviewFeedBody`, `SubmitReviewBody`, `ReportReason`. |
| `src/reviews/validate.ts` | Pure: `validateReviewDraft(draft)` → the same rule the Zod schema and the composer's live counter both read. |

**New — the GIF seam (`src/gifs/**`, joins the coverage gate):**

| File | Responsibility |
|---|---|
| `src/gifs/provider.ts` | `GifProvider`, `GifResult`, and the request-cost docblock. |
| `src/gifs/config.ts` | `GIF_CONFIG`: env var names, result cap, rating ceiling, query bounds. |
| `src/gifs/registry.ts` | `createGifProvider(): GifProvider | null` — `none` returns null, an unknown name fails fast. |
| `src/gifs/test-support.ts` | `describeGifProviderContract(label, factory)` — the suite a future Tenor adapter passes unchanged. |
| `src/gifs/giphy/client.ts`, `config.ts`, `map.ts`, `giphy-gif-provider.ts` | The real adapter, fetch injected, mapped off committed fixtures. |
| `src/gifs/giphy/fixtures/*.json`, `manifest.json` | Committed responses plus the provenance manifest, mirroring `src/stats/tank01/fixtures/`. |

**New — service layers:**

| File | Responsibility |
|---|---|
| `src/identity-service/profile.ts` | `readProfile(db, userId)`, `updateProfile(db, input)` — the first write path to `users` this product has. |
| `src/identity-service/preferences.ts` | `readPreferences(db, user)` (lazily seeds the row), `updatePreferences(db, input)`. |
| `src/identity-service/schemas.ts` | `updateProfileSchema`, `updatePreferencesSchema`. |
| `src/review-service/reviews.ts` | `submitReview`, `listReviews`, `reportReview`, `removeReview`. |
| `src/review-service/schemas.ts` | `submitReviewSchema`, `reportReviewSchema`. |

**New — routes:**

| File | Responsibility |
|---|---|
| `src/app/api/profile/route.ts` | `PATCH /api/profile`, rate-limited, behind `withCurrentUser`. |
| `src/app/api/profile/_shared.ts` | The profile rate limiter singleton and its test reset. |
| `src/app/api/preferences/route.ts` | `PATCH /api/preferences`. |
| `src/app/api/invites/[code]/route.ts` | `GET /api/invites/[code]` — the terms you are being asked to agree to. |
| `src/app/api/reviews/route.ts` | `GET` (public, rate-limited by IP) and `POST` (authenticated). |
| `src/app/api/reviews/[reviewId]/report/route.ts` | `POST` — report for abuse. |
| `src/app/api/gifs/search/route.ts` | `GET ?q=` — 404s cleanly when no provider is configured. |
| `src/app/app/profile/page.tsx` | The profile and preferences surface. |
| `src/app/reviews/page.tsx` | The public, unfiltered feed. |

**New — client (`src/account-room/**`, a new client-boundary directory, ruling 3):**

| File | Responsibility |
|---|---|
| `src/account-room/contract.ts` | Types only: `ProfileBody`, `PreferencesBody`. |
| `src/account-room/hooks/deps.tsx` | `useAccountRoomDeps()` — the same `fetchJson` injection seam `src/league-room/hooks/deps.tsx` established. |
| `src/account-room/components/profile-form.tsx` | Display name, experience tier, save. |
| `src/account-room/components/avatar-picker.tsx` | The preset grid, keyboard-operable as a radio group. |
| `src/account-room/components/notification-summary.tsx` | What the product tells you about, and where it reaches you today. |
| `src/account-room/components/review-composer.tsx` | Write or edit your one review. |
| `src/account-room/components/review-feed.tsx` | The feed list plus each row's report control. |

**New — other client:**

| File | Responsibility |
|---|---|
| `src/components/ui/info-tip.tsx` | The one way a term gets a definition. Click, not hover. |
| `src/components/ui/textarea.tsx` | The multi-line control this codebase has never had. |
| `src/league-room/components/first-run-panel.tsx` | The zero-leagues fork. Replaces `HomeBoard`'s plain `EmptyState`. |
| `src/league-room/components/league-terms-panel.tsx` | A league's terms, rendered from `LeagueTerms`. Used by the join page and the league home. |
| `src/league-room/components/league-members-panel.tsx` | Who is in this league, with faces, and who runs it. |
| `src/draft-room/components/room-tour.tsx` | The one-time draft-room tour. |
| `src/chat-room/components/gif-picker.tsx` | Search and send, rendered only when the seam is configured. |

**New — decision doc:** `docs/decisions/identity-and-trust.md`.

**New migrations:** `drizzle/0015_user_preferences.sql`, `drizzle/0016_reviews.sql`, `drizzle/0017_chat_message_gifs.sql`.

**Modified:** `src/db/schema.ts`, `src/domain/user.ts`, `src/domain/league.ts`, `src/scoring/describe.ts` (new file in an existing gated dir), `src/league/terms.ts` (new file in an existing gated dir), `src/components/ui/avatar.tsx`, `src/components/ui/icon.tsx`, `src/components/ui/index.ts`, `src/components/app-shell/app-header.tsx`, `src/lib/auth/current-user.ts`, `src/lib/auth/user-sync.ts`, `src/league-service/invites.ts`, `src/league-service/read.ts`, `src/league-service/browse.ts`, `src/league-service/index.ts`, `src/league-room/contract.ts`, `src/league-room/components/home-board.tsx`, `src/league-room/components/join-form.tsx`, `src/league-room/components/league-home.tsx`, `src/league-room/components/public-league-list.tsx`, `src/league-room/components/standings-table.tsx`, `src/chat/contract.ts`, `src/chat/config.ts`, `src/chat-service/chat.ts`, `src/chat-service/schemas.ts`, `src/chat-room/components/message-list.tsx`, `src/chat-room/components/chat-composer.tsx`, `src/draft-room/components/tv-board.tsx`, `src/draft-room/components/draft-board.tsx`, `src/draft-room/components/draft-room.tsx`, `src/matchmaking/contract.ts`, `src/app/app/page.tsx`, `src/app/app/join/[code]/page.tsx`, `src/app/app/drafts/[draftId]/page.tsx`, `src/app/app/leagues/[leagueId]/page.tsx`, `src/app/browse/page.tsx`, `src/app/page.tsx`, `eslint.config.mjs`, `vitest.config.mts`, `package.json`, `.env.example`, `e2e/league-lifecycle.spec.ts`, `docs/conventions.md`, `docs/design-system.md`, `docs/league.md`, `README.md`.

---

## Task 1: The avatar seam — presets that need no bucket, and one place that decides

Step 15's preset half. The column exists and is already rendered; what is missing is a vocabulary for what it may contain and a set of choices that cost no infrastructure. After this task `users.avatarUrl` holds one of three things and exactly one function decides which.

The security half matters as much as the product half. Today the column is written only by `syncUserFromWorkOS` from a WorkOS-supplied URL, so nobody has ever thought about what an arbitrary string in it would do. Task 2 makes it user-writable. `parseAvatarRef` is where that stops being a problem, and it ships **before** the write path rather than after.

**Files:**
- Create: `src/identity/config.ts`
- Create: `src/identity/avatars.ts`, `src/identity/avatars.test.ts`
- Modify: `src/components/ui/icon.tsx` (+ `icon.test.tsx`)
- Modify: `src/components/ui/avatar.tsx`, `src/components/ui/avatar.test.tsx`
- Modify: `src/chat-room/components/message-list.tsx`, `src/draft-room/components/tv-board.tsx`, `src/draft-room/components/draft-board.tsx` (+ their tests)
- Modify: `eslint.config.mjs` (add `src/identity/**` to the browser-safe exempt list)

**Interfaces:**
- Consumes: `IconName` from `@/components/ui/icon` (**type only**, so the pure layer never pulls React).
- Produces:
  - `type AvatarPresetKey = "shield" | "flame" | "anchor" | "rocket" | "crown" | "bolt" | "trophy" | "clover"`
  - `interface AvatarPreset { readonly key: AvatarPresetKey; readonly label: string; readonly icon: IconName; readonly tone: AvatarTone }`
  - `type AvatarTone = "accent" | "positive" | "negative" | "warning" | "neutral"`
  - `const AVATAR_PRESETS: readonly AvatarPreset[]`, `presetByKey(key): AvatarPreset | undefined`, `avatarRefValue(key): string`
  - `type AvatarRef = { kind: "preset"; preset: AvatarPreset } | { kind: "remote"; url: string } | { kind: "initials" }`
  - `parseAvatarRef(stored: string | null): AvatarRef`
  - `Avatar`'s prop `src` is replaced by `avatar?: string | null` (the stored ref, not a URL).

Task 2 writes `avatarRefValue(key)` into the column; Task 3 renders `Avatar` at five more call sites; Task 9 renders it beside every review.

- [ ] **Step 1: Write the failing `parseAvatarRef` test**

Create `src/identity/avatars.test.ts`. The hostile cases are the point of the file, so they lead:

```ts
import { describe, expect, it } from "vitest";
import { AVATAR_PRESETS, avatarRefValue, parseAvatarRef, presetByKey } from "./avatars";

describe("parseAvatarRef", () => {
  it("renders initials when there is nothing stored", () => {
    expect(parseAvatarRef(null)).toEqual({ kind: "initials" });
    expect(parseAvatarRef("")).toEqual({ kind: "initials" });
    expect(parseAvatarRef("   ")).toEqual({ kind: "initials" });
  });

  it("resolves every preset this product ships", () => {
    for (const preset of AVATAR_PRESETS) {
      expect(parseAvatarRef(avatarRefValue(preset.key))).toEqual({ kind: "preset", preset });
    }
  });

  it("falls back to initials for a preset key it does not know", () => {
    // A key removed in a later release must not become a broken face for everyone who chose it.
    expect(parseAvatarRef("preset:unicorn")).toEqual({ kind: "initials" });
  });

  it("accepts the https URL WorkOS supplies", () => {
    expect(parseAvatarRef("https://workoscdn.com/u/abc.png")).toEqual({
      kind: "remote",
      url: "https://workoscdn.com/u/abc.png",
    });
  });

  it("refuses every scheme that is not https", () => {
    // This column becomes user-writable in Task 2, and its value lands in an <img src>. Anything
    // that is not a known preset or a plain https URL renders as initials, which is a real face
    // and not an error state. Named schemes, not a regex the reader has to trust.
    for (const hostile of [
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "http://insecure.example/pic.png",
      "//protocol-relative.example/pic.png",
      "vbscript:msgbox(1)",
      "preset:../../etc/passwd",
    ]) {
      expect(parseAvatarRef(hostile)).toEqual({ kind: "initials" });
    }
  });

  it("gives every preset a distinct key, a label, and an icon the Icon primitive knows", () => {
    const keys = AVATAR_PRESETS.map((preset) => preset.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const preset of AVATAR_PRESETS) {
      expect(preset.label).toMatch(/\S/);
      expect(presetByKey(preset.key)).toEqual(preset);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/identity`
Expected: FAIL — `Cannot find module './avatars'`.

- [ ] **Step 3: Write `src/identity/config.ts` and `src/identity/avatars.ts`**

```ts
// src/identity/config.ts
/** Tunables for identity. Nothing in `src/identity/**` may inline one of these. */
export const IDENTITY_CONFIG = {
  displayName: { minLength: 2, maxLength: 40 },
  avatar: {
    /** The stored-value prefix that marks a built-in preset. */
    presetPrefix: "preset:",
    /**
     * Custom avatar UPLOAD needs an object store, which is Plan D's table (phase overview:
     * "Step 15's custom avatar upload needs an object store"). The ref scheme is what makes
     * turning it on a new `AvatarRef` case and a new writer, not a schema change: an uploaded
     * avatar is stored as its https URL, which `parseAvatarRef` already renders today.
     */
    uploads: false,
    /** The only URL scheme ever rendered into an `<img src>`. See `parseAvatarRef`. */
    allowedUrlPrefix: "https://",
  },
} as const;
```

```ts
// src/identity/avatars.ts
import type { IconName } from "@/components/ui/icon";
import { IDENTITY_CONFIG } from "./config";

export type AvatarTone = "accent" | "positive" | "negative" | "warning" | "neutral";

export type AvatarPresetKey =
  | "shield" | "flame" | "anchor" | "rocket" | "crown" | "bolt" | "trophy" | "clover";

export interface AvatarPreset {
  readonly key: AvatarPresetKey;
  /** The visible name in the picker and the avatar's accessible label. */
  readonly label: string;
  readonly icon: IconName;
  readonly tone: AvatarTone;
}

/**
 * A preset is an icon and a pigment. Both already exist in the design system, so a face costs
 * no object store, no CDN and no bytes over the wire beyond what the app already ships. That is
 * the entire reason this half of Step 15 lands in a plan with no founder-supplied resources.
 *
 * Eight, not thirty: a picker a manager can scan in one glance beats a wall they scroll past.
 */
export const AVATAR_PRESETS: readonly AvatarPreset[] = [
  { key: "shield", label: "Shield", icon: "shield", tone: "accent" },
  { key: "flame", label: "Flame", icon: "flame", tone: "negative" },
  { key: "anchor", label: "Anchor", icon: "anchor", tone: "neutral" },
  { key: "rocket", label: "Rocket", icon: "rocket", tone: "warning" },
  { key: "crown", label: "Crown", icon: "crown", tone: "warning" },
  { key: "bolt", label: "Bolt", icon: "bolt", tone: "accent" },
  { key: "trophy", label: "Trophy", icon: "trophy", tone: "positive" },
  { key: "clover", label: "Clover", icon: "clover", tone: "positive" },
];

const BY_KEY: ReadonlyMap<string, AvatarPreset> = new Map(AVATAR_PRESETS.map((p) => [p.key, p]));

export function presetByKey(key: string): AvatarPreset | undefined {
  return BY_KEY.get(key);
}

export function avatarRefValue(key: AvatarPresetKey): string {
  return `${IDENTITY_CONFIG.avatar.presetPrefix}${key}`;
}

export type AvatarRef =
  | { readonly kind: "preset"; readonly preset: AvatarPreset }
  | { readonly kind: "remote"; readonly url: string }
  | { readonly kind: "initials" };

/**
 * The one place a stored avatar value becomes something renderable.
 *
 * The default in every unrecognized case is `initials`, never an error and never a broken image:
 * `Avatar` always has a name to fall back to, so "we do not know what this is" and "this person
 * has not chosen" produce the same, perfectly fine, face.
 *
 * Only `https://` is ever handed to an `<img src>`. This column is user-writable after Task 2,
 * and an avatar URL is the shortest path from a text field to script execution in every other
 * manager's browser.
 */
export function parseAvatarRef(stored: string | null): AvatarRef {
  const value = (stored ?? "").trim();
  if (value === "") return { kind: "initials" };
  if (value.startsWith(IDENTITY_CONFIG.avatar.presetPrefix)) {
    const preset = presetByKey(value.slice(IDENTITY_CONFIG.avatar.presetPrefix.length));
    return preset === undefined ? { kind: "initials" } : { kind: "preset", preset };
  }
  if (value.startsWith(IDENTITY_CONFIG.avatar.allowedUrlPrefix)) return { kind: "remote", url: value };
  return { kind: "initials" };
}
```

- [ ] **Step 4: Add the six icons to the one icon entry point**

`src/components/ui/icon.tsx` is the only file allowed to import `lucide-react` for feature use. Extend `ICONS` with `shield: Shield`, `flame: Flame`, `anchor: Anchor`, `rocket: Rocket`, `crown: Crown`, `bolt: Zap`, `clover: Clover`, keeping the existing ten untouched. Note `bolt` maps to lucide's `Zap`: the map's keys are **our** vocabulary and need not match lucide's spelling, which is the point of having the map.

Add one case to `icon.test.tsx` asserting every `IconName` renders an `<svg>`, iterating the union rather than listing names, so a future addition cannot skip the check.

- [ ] **Step 5: Teach `Avatar` the ref, and refactor all three call sites in the same commit**

The founder correction of 2026-08-18 is explicit that a primitive gets centralized *and its existing consumers refactored* in one commit. `Avatar`'s `src` prop becomes `avatar`, and the parsing happens inside the primitive so no call site ever holds an `AvatarRef`:

```tsx
export interface AvatarProps {
  /** The person's display name — the source of the initials fallback. */
  readonly name: string;
  /** The STORED avatar ref (`users.avatar_url`), not a URL. `parseAvatarRef` decides what it is. */
  readonly avatar?: string | null;
  readonly size?: AvatarSize;
  /** Provide to make the avatar an accessible image; omit to leave it decorative. */
  readonly label?: string;
  readonly className?: string;
}
```

The preset branch renders `<Icon name={preset.icon} />` on a tone class drawn from the existing token roles (`bg-accent text-accent-text`, `bg-positive`, …) through a `Readonly<Record<AvatarTone, string>>` map local to `avatar.tsx` — that map is the primitive's own implementation, which is exactly where a visual mapping is allowed to live. The remote branch keeps today's `<img>` and its existing eslint-disable, whose comment is updated: the allowlist concern is now handled by `parseAvatarRef`, and the reason `next/image` is still not used is the per-host allowlist that does not exist.

Call sites: `message-list.tsx:51`, `tv-board.tsx:67`, `draft-board.tsx:139` — rename `src=` to `avatar=`. `draft-board.tsx` passes no value at all (a player, not a manager), so it needs no change beyond the prop rename if one is present.

- [ ] **Step 6: Test the primitive in both themes**

Add to `avatar.test.tsx`, using the file's existing idiom:

```tsx
  it("renders a chosen preset as an icon, both themes, no axe violations", async () => {
    await inBothThemes(<Avatar name="Ada Lovelace" avatar="preset:shield" label="Ada Lovelace" />, async ({ container }) => {
      expect(screen.getByRole("img", { name: "Ada Lovelace" })).toBeInTheDocument();
      expect(container.querySelector("svg")).not.toBeNull();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("falls back to initials rather than an image for a value it will not render", async () => {
    render(<Avatar name="Ada Lovelace" avatar="javascript:alert(1)" />);
    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
```

- [ ] **Step 7: Add `src/identity/**` to the browser-safe exempt list**

`src/identity/**` is pure, imports no server module, and `src/chat-room/**` will call `parseAvatarRef` indirectly through `Avatar`. In `eslint.config.mjs`, add it beside `src/chat/**` and `src/matchmaking/**` in the exempt set, and add the same note to `docs/conventions.md` in Task 11's sweep.

- [ ] **Step 8: Run and commit**

```bash
npm test -- src/identity
npm test -- src/components/ui
npm test -- src/chat-room
npm test -- src/draft-room
npm run typecheck && npm run lint && npm run build
```

```bash
git add src/identity src/components/ui src/chat-room src/draft-room eslint.config.mjs
git commit -m "feat(identity): avatar refs, eight presets that need no object store, one parser

users.avatar_url has only ever held whatever WorkOS scraped off an SSO profile, because nothing
in the product could write it. Task 2 makes it user-writable, so the vocabulary and the parser
land first: preset:<key> for the built-in set, an https URL for what WorkOS supplied, and
initials for everything else.

Everything else includes javascript:, data:, http: and protocol-relative, each named in a test
rather than implied by a regex. An avatar URL is the shortest path from a text field to script
execution in every other manager's browser, and this column stops being ours alone next task.

A preset is an IconName and a token pigment, which is code. That is the whole reason this half
of the spec's Step 15 lands in a plan with no founder-supplied resources; the upload half needs
a bucket and stays Plan D's, as one more AvatarRef case rather than a schema change.

Avatar's src prop became avatar (a ref, not a URL) and all three existing call sites moved in
this commit, per the centralize-the-first-time rule."
```

---

## Task 2: The profile — the first write path this product has to who you are

Nothing in this codebase has ever updated a `users` row's app-owned fields. `syncUserFromWorkOS`'s docblock already promises they are "never clobbered by a later sync — the user may have edited them in-app", which has been true only because no edit existed. This task makes the promise load-bearing.

It also unblocks Step 14: the onboarding fork branches on `experienceTier`, and `experienceTier` has never been anything but the column default.

**Files:**
- Create: `src/identity-service/profile.ts`, `src/identity-service/profile.test.ts`
- Create: `src/identity-service/schemas.ts`
- Create: `src/app/api/profile/route.ts`, `src/app/api/profile/_shared.ts`, `src/app/api/profile/route.test.ts`
- Create: `src/account-room/contract.ts`, `src/account-room/hooks/deps.tsx`
- Create: `src/account-room/components/profile-form.tsx` (+ test), `src/account-room/components/avatar-picker.tsx` (+ test)
- Create: `src/app/app/profile/page.tsx`
- Modify: `src/components/app-shell/app-header.tsx` (+ test)
- Modify: `eslint.config.mjs` (add `src/account-room/**` to the client-boundary group)

**Interfaces:**
- Consumes: `AVATAR_PRESETS` / `avatarRefValue` / `AvatarPresetKey` (Task 1), `IDENTITY_CONFIG` (Task 1), `withCurrentUser` from `@/app/api/leagues/_shared`, `createRateLimiter` from `@/lib/api/rate-limit`, `ok`/`fail`/`parseJson` from `@/lib/api/respond`.
- Produces:
  - `updateProfileSchema` (Zod) and `UpdateProfileInput` from `@/identity-service/schemas`
  - `readProfile(db, userId): Promise<ProfileBody | null>` and `updateProfile(db, input): Promise<ProfileBody>` from `@/identity-service/profile`
  - `interface ProfileBody { readonly displayName: string; readonly experienceTier: ExperienceTier; readonly avatarPreset: AvatarPresetKey | null; readonly avatar: string | null }` on `@/account-room/contract`
  - `PATCH /api/profile`
  - `AppHeaderProps` gains `avatar: string | null` and the name becomes a link to `/app/profile`.

Task 3 renders the chosen avatar across the product; Task 4 adds the preferences section to this page; Task 5's fork reads the `experienceTier` this page writes.

- [ ] **Step 1: Write the failing service test**

`src/identity-service/profile.test.ts`, real Postgres via `createTestDb()`:

```ts
  it("writes a display name, a tier and a preset, and reads them back", async () => {
    await seedUser(db, { id: "u1", displayName: "u1@example.com" });
    const saved = await updateProfile(db, {
      userId: "u1", displayName: "Ada Lovelace", experienceTier: "experienced", avatarPreset: "shield",
    });
    expect(saved).toEqual({
      displayName: "Ada Lovelace", experienceTier: "experienced", avatarPreset: "shield", avatar: "preset:shield",
    });
    expect(await readProfile(db, "u1")).toEqual(saved);
  });

  it("never lets a profile write set an arbitrary avatar value", async () => {
    // The write path takes a PRESET KEY, not a URL. There is no code path from a request body to
    // an <img src>, which is a stronger guarantee than validating one.
    await seedUser(db, { id: "u1" });
    // @ts-expect-error — the input type does not admit a URL, and this line is the proof.
    await expect(updateProfile(db, { userId: "u1", displayName: "A", experienceTier: "beginner", avatarPreset: "https://evil.example/x.png" }))
      .rejects.toThrow();
  });

  it("leaves the WorkOS-supplied picture in place until a preset is chosen", async () => {
    await seedUser(db, { id: "u1", avatarUrl: "https://workoscdn.com/u/abc.png" });
    const saved = await updateProfile(db, { userId: "u1", displayName: "Ada", experienceTier: "beginner", avatarPreset: null });
    expect(saved.avatar).toBe("https://workoscdn.com/u/abc.png");
  });

  it("a later WorkOS sign-in does not clobber what the user chose", async () => {
    // user-sync.ts has always CLAIMED this. Nothing could test it before, because nothing could
    // edit. Now something can, so the claim gets an assertion.
    await seedUser(db, { id: "u1" });
    await updateProfile(db, { userId: "u1", displayName: "Ada Lovelace", experienceTier: "experienced", avatarPreset: "flame" });
    await syncUserFromWorkOS({ db, clock: fixedClock }, {
      id: "u1", email: "ada@example.com", firstName: "A", lastName: "L", profilePictureUrl: "https://workoscdn.com/new.png",
    });
    expect(await readProfile(db, "u1")).toMatchObject({ displayName: "Ada Lovelace", experienceTier: "experienced", avatar: "preset:flame" });
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/identity-service`
Expected: FAIL — `Cannot find module './profile'`.

- [ ] **Step 3: Write the schema and the service**

```ts
// src/identity-service/schemas.ts
import { z } from "zod";
import { AVATAR_PRESETS, IDENTITY_CONFIG } from "@/identity";

const PRESET_KEYS = AVATAR_PRESETS.map((preset) => preset.key) as [string, ...string[]];

export const updateProfileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(IDENTITY_CONFIG.displayName.minLength, "Your name needs at least 2 characters.")
    .max(IDENTITY_CONFIG.displayName.maxLength, "Your name can be at most 40 characters."),
  experienceTier: z.enum(["beginner", "experienced"]),
  /** A preset KEY or null. Never a URL: see `updateProfile`'s docblock. */
  avatarPreset: z.enum(PRESET_KEYS).nullable(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
```

`updateProfile` writes `avatarUrl: avatarPreset === null ? undefined : avatarRefValue(avatarPreset)` — `undefined` meaning "leave the column alone", so declining a preset preserves the WorkOS picture rather than deleting a face. Its docblock states the invariant the second test asserts: **the write path accepts a preset key, so there is no path from a request body to an `<img src>` at all.**

- [ ] **Step 4: Write the route, rate-limited**

`src/app/api/profile/_shared.ts` follows the advisor's exact pattern:

```ts
const limiter = createRateLimiter(IDENTITY_CONFIG.profileRateLimit);

/** Keyed by user id: a profile write is authenticated, so the user is the right blast-radius unit. */
export function profileRateLimited(userId: string): Response | null {
  return limiter.allow(userId) ? null : fail("You've changed that a lot in a short time. Give it a minute and try again.", 429);
}

export function resetProfileRateLimit(): void {
  limiter.reset();
}
```

Add `profileRateLimit: { maxRequests: 10, windowMs: 60_000 }` to `IDENTITY_CONFIG`. The route is a `PATCH` behind `withCurrentUser`, returning `ok<ProfileBody>(...)`.

Route test cases: 401 signed out, 400 naming the field for a two-character-short name, 429 past the threshold, 200 round-trip.

- [ ] **Step 5: Build the surface**

`src/account-room/**` is a new client-boundary directory (ruling 3): add it to `eslint.config.mjs`'s `SERVER_ONLY_MODULE_GROUPS` scope beside the three existing room directories, and give it a `hooks/deps.tsx` that mirrors `src/league-room/hooks/deps.tsx` exactly, so its components fetch through an injected `fetchJson` and its tests need no network.

`AvatarPicker` is a **radio group**, not a grid of buttons: eight mutually exclusive choices is what a radio group is for, arrow keys work for free, and a screen reader announces "Shield, 1 of 8" rather than eight unrelated buttons. Each option renders `<Avatar name={displayName} avatar={avatarRefValue(preset.key)} size="lg" />` with the preset's label as the visible radio label.

`ProfileForm` uses `Input` and `Select`, shows a save state, and on success calls `router.refresh()` so the header updates without a full reload. The experience-tier control's options are copy, not enum values: `"New to fantasy"` / `"Played before"`, reusing `PublicLeagueList`'s existing `TIER_LABEL` vocabulary so the two surfaces cannot describe the same tier differently. Extract that map to `src/identity/config.ts` as `EXPERIENCE_TIER_LABEL` and repoint `public-league-list.tsx` at it in this commit.

`src/app/app/profile/page.tsx` renders `AppHeader`, a `PageTitle`, the picker and the form from a server-side `readProfile`.

- [ ] **Step 6: Give the header a face and a way in**

`AppHeaderProps` gains `avatar: string | null`. The name becomes a `Link` to `/app/profile` carrying `<Avatar name={displayName} avatar={avatar} size="sm" />` and the name text. Update the three call sites (`src/app/app/page.tsx`, `src/app/browse/page.tsx`, and `src/app/app/leagues/[leagueId]/page.tsx` if it renders the header) to pass `user.avatarUrl`.

- [ ] **Step 7: Run and commit**

```bash
npm test -- src/identity-service
npm test -- src/account-room
npm test -- src/app/api/profile
npm test -- src/components
npm run typecheck && npm run lint && npm run build
```

```bash
git add src/identity src/identity-service src/account-room src/app src/components eslint.config.mjs
git commit -m "feat(profile): the first write path this product has to who you are

Nothing has ever updated a users row's app-owned fields. user-sync.ts's docblock has claimed
since Phase 1 that displayName, experienceTier and avatarUrl are never clobbered by a later
WorkOS sync because the user may have edited them in-app; there was no in-app edit, so the claim
was untestable. There is now, and it has an assertion.

The write path takes a preset KEY, never a URL, so there is no code path from a request body to
an img src at all. That is a stronger guarantee than validating one would be, and the type system
carries it: the ts-expect-error in the service test IS the proof.

Declining a preset leaves the WorkOS picture in place rather than deleting a face.

experienceTier has been the column default for every user who ever signed up, which is why the
onboarding fork could not have branched on it before this commit."
```

---

## Task 3: Identity renders wherever the product says who somebody is

Step 15's audit task, in the shape Step 5's retrofit established: write the list down, then satisfy it. The product currently shows a manager's face in two places (chat, the TV board) and their name in nine. This task closes the gap and adds the surface the audit exposes as missing entirely: **a league has no members list**, so nobody in a league can see who else is in it or who runs it.

**Files:**
- Modify: `src/domain/league.ts` (`TeamCard.ownerAvatarUrl` docblock — it is now a ref, not a URL)
- Modify: `src/league-service/read.ts` (standings rows carry the owner)
- Modify: `src/league-room/contract.ts`
- Create: `src/league-room/components/league-members-panel.tsx` (+ test)
- Modify: `src/league-room/components/standings-table.tsx` (+ test)
- Modify: `src/league-room/components/league-home.tsx` (+ test)
- Modify: `src/draft-room/components/room-rail.tsx` (+ test)
- Create: `docs/decisions/identity-and-trust.md` (the audit list section only; Task 11 finishes the doc)

**Interfaces:**
- Consumes: `Avatar` (Task 1), `TeamCard` from `@/domain/league`, `LeagueHomeBody` from `@/league-room/contract`.
- Produces: `LeagueMembersPanel({ teams, commissionerUserId, myTeamId })`; `TeamStandingsRow` gains `ownerDisplayName` and `ownerAvatar`.

- [ ] **Step 1: Write the audit list down first, in the decision doc**

Create `docs/decisions/identity-and-trust.md` with an "Where identity renders" table listing every call site found, its file, and whether it shows a face today. This list is the completion checklist for the task, exactly as Step 5's retrofit did it:

| Surface | File | Before | After |
|---|---|---|---|
| App header | `src/components/app-shell/app-header.tsx` | name only | face + name, links to the profile (Task 2) |
| Chat message | `src/chat-room/components/message-list.tsx:51` | face + team name | unchanged, now ref-aware (Task 1) |
| TV board spotlight | `src/draft-room/components/tv-board.tsx:67` | face + owner badge | unchanged, now ref-aware (Task 1) |
| Draft board seat header | `src/draft-room/components/draft-board.tsx:249` | team name only | **unchanged, deliberately** (ruling 8) |
| Room rail, whose turn | `src/draft-room/components/room-rail.tsx:183` | team name only | face beside the name |
| Standings row | `src/league-room/components/standings-table.tsx:50` | team name only | face beside the name |
| League members | *does not exist* | nothing | new panel, with the commissioner marked |
| Review row | *does not exist* | nothing | Task 9 |

- [ ] **Step 2: Write the failing members-panel test**

```tsx
  it("names the commissioner, marks you, and gives every manager a face", async () => {
    await inBothThemes(
      <LeagueMembersPanel teams={THREE_TEAMS} commissionerUserId="u1" myTeamId="t2" />,
      async ({ container }) => {
        expect(screen.getByRole("list", { name: "Managers" })).toBeInTheDocument();
        // The commissioner is named as a fact about the league, not implied by a control only
        // they can see: every member can find out who runs the league they are in.
        expect(screen.getByText("Commissioner")).toBeInTheDocument();
        expect(screen.getByText("You")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("shows an open seat as an open seat, not as a missing person", async () => {
    render(<LeagueMembersPanel teams={THREE_TEAMS} teamCount={6} commissionerUserId="u1" myTeamId="t2" />);
    expect(screen.getByText("3 seats still open")).toBeInTheDocument();
  });
```

- [ ] **Step 3: Carry the owner through to standings**

`TeamStandingsRow` gains `ownerDisplayName: string` and `ownerAvatar: string | null`. `leagueHome` already selects the owner for `TeamCard`; join the same rows into the standings mapping rather than issuing a second query, and assert the query count did not change with the same counting-connection device `src/league-service/home.test.ts` already uses.

- [ ] **Step 4: Render the panel on the league home**

`LeagueMembersPanel` renders on `league-home.tsx` beside the invite panel, so the commissioner's "who is missing" question and their "invite someone" answer sit together. Below `sm` it linearizes; at 360px the name truncates and the face does not shrink.

- [ ] **Step 5: PERSONA-PANEL PASS**

**CONTROLLER STEP.** Four personas, 360px and desktop, light and dark, across the three surfaces this task and Task 2 shipped: the profile page, the header, and the members panel. Two known tensions to resolve rather than guess: the **commissioner** wants the members panel to answer "who has not joined yet" at a glance, and the **high-stakes veteran** will read a face beside a standings row as noise if it costs a row of density. The Phase 1 backlog item "member avatars/activity cues" is this panel's subject and should be raised in the panel explicitly. Record findings in the SDD ledger; fix rounds land as follow-up commits on this task.

- [ ] **Step 6: Run and commit**

```bash
npm test -- src/league-room
npm test -- src/league-service
npm test -- src/draft-room
npm run test:coverage
npm run typecheck && npm run lint && npm run build
```

```bash
git add src/league-room src/league-service src/draft-room src/domain docs/decisions
git commit -m "feat(league): faces where the product says who somebody is, and a members list at all

The audit list is written down in docs/decisions/identity-and-trust.md before any of it was
satisfied, matching the retrofit pattern Phase 2's Step 5 established, and it exposed a surface
that was missing entirely rather than merely faceless: a league had no members list, so nobody in
a league could see who else was in it or who ran it. The commissioner is now a fact the panel
states, not something you infer from which buttons you can see.

An empty seat renders as an open seat rather than as an absent person, because those are
different things to a commissioner deciding whether to send another invite.

The draft board's seat headers deliberately stay text-only: that grid is dense by design and a
face per column is the one place in this product where identity costs more than it gives."
```

---

## Task 4: `user_preferences`, the draft-room tour, and a notification model with nothing wired to nothing

Two per-user pieces of state this plan genuinely reads, in one row: how much help to show, and whether the draft-room tour has been dismissed. Plus the notification model, which lands here because it belongs beside the other preferences and because the discipline it needs is the same one: **a preference this product cannot honor does not ship as a control.**

**Files:**
- Create: `src/identity/preferences.ts`, `src/identity/preferences.test.ts`
- Create: `src/identity/notifications.ts`, `src/identity/notifications.test.ts`
- Create: `src/identity-service/preferences.ts`, `src/identity-service/preferences.test.ts`
- Create: `src/app/api/preferences/route.ts` (+ test)
- Create: `src/account-room/components/notification-summary.tsx` (+ test)
- Create: `src/draft-room/components/room-tour.tsx` (+ test)
- Modify: `src/db/schema.ts`, `src/db/schema.test.ts`
- Create: `drizzle/0015_user_preferences.sql` (via `npm run db:generate`)
- Modify: `src/app/app/profile/page.tsx`, `src/app/app/drafts/[draftId]/page.tsx`, `src/draft-room/components/draft-room.tsx`
- Modify: `src/identity-service/schemas.ts`

**Interfaces:**
- Consumes: `IDENTITY_CONFIG`, `RealtimeEventType` from `@/lib/realtime/events` (**type only**, so the catalog cannot name an event the product does not publish), `Modal` from `@/components/ui`.
- Produces:
  - `type HelpLevel = "guided" | "standard"`, `interface PreferenceState { readonly helpLevel: HelpLevel; readonly draftTourDismissedAt: string | null }`, `defaultPreferences(user): PreferenceState`, `isDraftTourDismissed(prefs): boolean`
  - `type NotificationChannel = "in_app" | "email"`, `NOTIFICATION_CATALOG`, `deliverableChannels(): readonly NotificationChannel[]`, `channelStatus(channel): "live" | "not-connected"`
  - `readPreferences(db, user): Promise<PreferenceState>`, `updatePreferences(db, input): Promise<PreferenceState>`
  - `PATCH /api/preferences`
  - `userPreferences` table and `helpLevelEnum` on `@/db/schema`

Task 5's fork reads `helpLevel`; Task 6's glossary reads it too.

- [ ] **Step 1: Write the failing pure tests**

```ts
// src/identity/preferences.test.ts
  it("starts a first-timer in guided help and an experienced manager in standard", () => {
    // The column default is a floor, not the answer: the row is seeded from what the user told us
    // about themselves, so guidance is on for the person who needs it without them finding a
    // setting first, and off for the person who would find it patronizing.
    expect(defaultPreferences({ experienceTier: "beginner" })).toEqual({ helpLevel: "guided", draftTourDismissedAt: null });
    expect(defaultPreferences({ experienceTier: "experienced" }).helpLevel).toBe("standard");
  });
```

```ts
// src/identity/notifications.test.ts
  it("only catalogues things the product actually publishes", () => {
    // The catalog is a promise to the user about what they will be told. Every topic maps to a
    // real event type in the one taxonomy, so a topic cannot describe a notification nobody sends.
    for (const topic of NOTIFICATION_CATALOG) {
      for (const event of topic.events) expect(REALTIME_EVENT_TYPES).toContain(event);
    }
  });

  it("reports email as not connected, and in-app as live", () => {
    // Plan D delivers the sender. Until it does, email is DESCRIBED and never offered as a switch:
    // a toggle that changes nothing is the half-state the no-MVP directive rules out, and in a
    // product about to hold money it is worse than absent, because the user believes it.
    expect(deliverableChannels()).toEqual(["in_app"]);
    expect(channelStatus("email")).toBe("not-connected");
    expect(channelStatus("in_app")).toBe("live");
  });
```

`REALTIME_EVENT_TYPES` does not exist yet as a value — `src/lib/realtime/events.ts` declares the union as a type only. Add `export const REALTIME_EVENT_TYPES = [...] as const satisfies readonly RealtimeEventType[]` there and derive the type from it, so the list and the union cannot diverge. That is a small, load-bearing improvement to a file this plan reads.

- [ ] **Step 2: Run them, watch them fail, then write both modules**

Run: `npm test -- src/identity`
Expected: FAIL — missing modules.

`NOTIFICATION_CATALOG` topics, each with plain-language copy and no em-dashes:

```ts
export const NOTIFICATION_CATALOG: readonly NotificationTopic[] = [
  { key: "draft-turn", title: "It's your turn to pick", detail: "While you're in the draft room.", events: ["draft.pick", "draft.nudge"] },
  { key: "draft-start", title: "Your draft is starting", detail: "While you're in the league.", events: ["draft.status"] },
  { key: "scores", title: "Your scores are moving", detail: "On your league page and your home page, while games are being played.", events: ["score.update"] },
  { key: "chat", title: "Your league is talking", detail: "In the league's chat.", events: ["chat.message", "chat.reaction"] },
];
```

- [ ] **Step 3: Add the table and generate the migration**

```ts
export const helpLevelEnum = pgEnum("help_level", ["guided", "standard"]);

/**
 * One row per user, holding only the preferences this product actually reads. It is created
 * lazily on first read rather than at sign-up, seeded from `defaultPreferences`, so a user who
 * never opens a setting still gets the right default and there is no backfill to write.
 *
 * There is deliberately NO notification-channel column here. The catalog in
 * `src/identity/notifications.ts` describes what the product tells you about; email delivery is
 * Plan D's, and a stored preference for a channel with no sender is a switch wired to nothing.
 * The day the sender exists, this table gains the column and the surface gains the toggles.
 */
export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  helpLevel: helpLevelEnum("help_level").notNull().default("guided"),
  /** Null until the tour is dismissed. A timestamp, not a boolean, so "when" survives for Phase 3. */
  draftTourDismissedAt: timestamp("draft_tour_dismissed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

```bash
npm run db:generate       # writes drizzle/0015_user_preferences.sql
npm run db:migrate        # dev, direct port
npm run db:migrate:test   # test
```

Read the generated SQL before applying: it must contain exactly `CREATE TYPE "public"."help_level"` and `CREATE TABLE "user_preferences"`. Anything else, stop and reconcile.

- [ ] **Step 4: Write the service, then the tour**

`readPreferences` upserts-on-read with `onConflictDoNothing` then selects, so two concurrent first reads cannot both insert. `updatePreferences` writes `helpLevel` and/or stamps `draftTourDismissedAt` from an injected clock.

`RoomTour` is a `Modal` (the primitive exists, and a modal is the right shape for something shown once and dismissed, unlike a coach-mark sequence that would need positioning logic nothing else in this product needs). Three panels of copy naming the three controls the spec asks for: **the clock**, **the queue**, **the chat**. Dismiss is a real button labeled "Got it", plus Esc and the backdrop, all of which `Modal` already gives. The dismissal `PATCH`es and does not block the room: the tour closes immediately and the write is best-effort, because a failed preference write must never keep a manager out of a live draft.

```tsx
  it("is shown once and never again", async () => {
    const { rerender } = render(<RoomTour dismissedAt={null} onDismiss={onDismiss} />);
    expect(screen.getByRole("dialog", { name: "How this room works" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    rerender(<RoomTour dismissedAt="2026-08-19T00:00:00.000Z" onDismiss={onDismiss} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes even when the preference write fails", async () => {
    // A background preference write must never be the thing that keeps a manager out of a live
    // draft. The worst case is seeing the tour twice.
    render(<RoomTour dismissedAt={null} onDismiss={() => { throw new Error("nope"); }} />);
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
```

`src/app/app/drafts/[draftId]/page.tsx` already calls `requireCurrentUser()`, so it reads preferences server-side and passes `dismissedAt` into `DraftRoom` as a prop. No client-side fetch on the room's critical path.

- [ ] **Step 5: Add the notification section to the profile page**

`NotificationSummary` renders the catalog as a description list: each topic's title, its detail, and the channel it reaches you on today. Below it, one honest sentence with no toggle beside it:

```
Email updates aren't connected yet. When they are, you'll choose which of these arrive in your inbox.
```

- [ ] **Step 6: Run and commit**

```bash
npm test -- src/identity
npm test -- src/identity-service
npm test -- src/draft-room
npm test -- src/account-room
npm test -- src/db
npm run typecheck && npm run lint && npm run build
```

```bash
git add src/identity src/identity-service src/account-room src/draft-room src/db src/app src/lib/realtime drizzle
git commit -m "feat(identity): one preferences row, the draft-room tour, and no switch wired to nothing

The row holds exactly two things because exactly two things are read: a help level, seeded from
what the user told us about themselves rather than from a column default, and the tour's
dismissal, stored as a timestamp so Phase 3 still has the when.

The notification catalog is modeled, and it is checked against the real event taxonomy so a topic
cannot promise a notification nobody publishes. Email is described and is not a toggle. Plan D
delivers the sender; a switch that changes nothing is the half-state the no-MVP directive rules
out, and in a product about to hold money the user believes it.

The tour closes even when its own preference write throws. The worst case is seeing it twice; the
alternative is a background write standing between a manager and a live draft."
```

---

## Task 5: The first-run fork

Spec Step 14. Plan B built the zero-leagues `EmptyState` plain and deferred its content here on purpose. This task is that content, and it is more than the empty state: `/app` currently stacks join, browse and create underneath the board **for everybody, forever**, which is the same wall whether you have zero leagues or ten.

**Files:**
- Create: `src/identity/first-run.ts`, `src/identity/first-run.test.ts`
- Create: `src/league-room/components/first-run-panel.tsx` (+ test)
- Modify: `src/league-room/components/home-board.tsx` (+ test)
- Modify: `src/app/app/page.tsx`
- Modify: `src/league-room/contract.ts`
- Create: `e2e/onboarding.spec.ts`
- Modify: `e2e/league-lifecycle.spec.ts`

**Interfaces:**
- Consumes: `HomeBody` from `@/league-room/contract`, `HelpLevel` and `ExperienceTier` (Tasks 4 and 2), `EmptyState` / `Button` / `Card`.
- Produces:
  - `type FirstRunPathKey = "create" | "join" | "browse"`
  - `interface FirstRunPath { readonly key: FirstRunPathKey; readonly title: string; readonly detail: string; readonly cta: string }`
  - `interface FirstRunPlan { readonly headline: string; readonly paths: readonly FirstRunPath[]; readonly showsExplainer: boolean }`
  - `firstRunPlan(input: { readonly experienceTier: ExperienceTier; readonly helpLevel: HelpLevel; readonly leagueCount: number }): FirstRunPlan | null`
  - `FirstRunPanel({ plan })`

- [ ] **Step 1: Write the failing pure test**

`firstRunPlan` returns `null` for anyone already in a league, which is what makes the fork disappear instead of nagging:

```ts
  it("orders the paths by what this manager most likely needs", () => {
    // A first-timer with no group is looking for a game to join. An experienced manager with no
    // leagues on this product is nearly always the person who came here to RUN one. Same three
    // paths, different order, because ordering is the only honest way to guide without hiding.
    expect(firstRunPlan({ experienceTier: "beginner", helpLevel: "guided", leagueCount: 0 })!.paths.map((p) => p.key))
      .toEqual(["browse", "join", "create"]);
    expect(firstRunPlan({ experienceTier: "experienced", helpLevel: "standard", leagueCount: 0 })!.paths.map((p) => p.key))
      .toEqual(["create", "join", "browse"]);
  });

  it("always offers all three paths, whichever way it orders them", () => {
    // Guidance is ordering, never removal. A first-timer who came here to run their office league
    // must not have to find the create form behind an experience setting they set wrong.
    for (const tier of ["beginner", "experienced"] as const) {
      const plan = firstRunPlan({ experienceTier: tier, helpLevel: "guided", leagueCount: 0 })!;
      expect(new Set(plan.paths.map((p) => p.key))).toEqual(new Set(["create", "join", "browse"]));
    }
  });

  it("shows the how-it-works explainer only in guided help", () => {
    expect(firstRunPlan({ experienceTier: "beginner", helpLevel: "guided", leagueCount: 0 })!.showsExplainer).toBe(true);
    expect(firstRunPlan({ experienceTier: "beginner", helpLevel: "standard", leagueCount: 0 })!.showsExplainer).toBe(false);
  });

  it("disappears entirely once you are in a league", () => {
    expect(firstRunPlan({ experienceTier: "beginner", helpLevel: "guided", leagueCount: 1 })).toBeNull();
  });
```

- [ ] **Step 2: Run it, watch it fail, write `first-run.ts`**

Copy for the three paths, plain and active, no em-dashes:

- `create`: "Start a league" / "You pick the format, the scoring and who's in it." / "Start a league"
- `join`: "Join with an invite" / "Paste the link or code your commissioner sent you." / "Use an invite"
- `browse`: "Find an open league" / "Browse leagues that still have seats and join one today." / "Browse open leagues"

The `guided` explainer is three sentences, no jargon, and it is the one place the product explains what a season-long league *is*:

```
A league is a group of managers who draft NFL players, then start the ones they think will
score most each week. You play one other manager every week of the NFL season. Your team's
score is whatever your starters do in their real games.
```

- [ ] **Step 3: Replace the empty state and restructure `/app`**

`HomeBoard`'s zero-leagues branch renders `<FirstRunPanel plan={plan} />` instead of the plain `EmptyState`, so the panel is inside the component that already knows the league count. `HomeBody` gains `firstRun: FirstRunPlan | null`, computed server-side in `crossLeagueHome`'s caller (the page and `/api/home`) rather than in the service, because it needs the user's preferences and the service takes only a db and a user id — pass it as a field on the route's response body, assembled in `src/app/api/home/route.ts` and `src/app/app/page.tsx` from `readPreferences` plus the league count.

Then `/app`'s three always-on sections change shape:

- `firstRun !== null`: the panel is the page's main content and the three trailing sections are **removed**, because the panel already is them, ordered and explained. This is the wall going away.
- `firstRun === null`: the board is the page, and join / browse / create collapse into a single `<details>` labeled "Start or join another league", closed by default. The `#create-league` anchor `/browse` and both empty states link to must still resolve, so the `<details>` is `open` when the URL fragment targets it. Add a test asserting the anchor still lands somewhere visible, because three existing surfaces depend on it.

- [ ] **Step 4: The e2e journey**

`e2e/onboarding.spec.ts`: a manager with zero leagues signs in, sees the fork with all three paths, follows "Browse open leagues", and lands on `/browse`. Then update `e2e/league-lifecycle.spec.ts`, which walks sign-in → `/app` → create: after this task the create form may be inside the `<details>`, so the spec opens it by name rather than assuming it is on the page.

- [ ] **Step 5: PERSONA-PANEL PASS**

**CONTROLLER STEP.** This panel covers **both** first-run surfaces: this fork and Task 4's draft-room tour. Four personas, 360px and desktop, both themes. The load-bearing personas here are the **first-timer** (does the explainer answer "what am I even signing up for" without jargon this plan has not defined yet) and the **high-stakes veteran** (a wall that collapsed into a `<details>` is either a relief or a thing they now have to click every time they start their fourth league of the season). Plan B's ledgered backlog item "EmptyState single CTA nudges create-league when join/browse are equally valid first steps" is exactly this surface and is now answered; confirm the panel agrees. Record findings in the SDD ledger.

- [ ] **Step 6: Run and commit**

```bash
npm test -- src/identity
npm test -- src/league-room
npm run test:coverage
npm run typecheck && npm run lint && npm run build
NEXT_DIST_DIR=.next-e2e npm run build && npm run e2e
```

```bash
git add src/identity src/league-room src/app e2e
git commit -m "feat(app): the first run forks, and the wall of three forms goes away

/app has stacked join, browse and create under the board for everybody forever, which is the same
wall whether you have zero leagues or ten. A manager with no leagues now gets those three paths
ORDERED by what they told us about themselves, with an explainer above them in guided help, and a
manager with leagues gets their board with the three paths collapsed behind one disclosure.

Guidance is ordering, never removal: all three paths are always offered, because a first-timer who
came here to run their office league must not have to find the create form behind an experience
setting they set wrong. There is a test that says so.

The fork returns null the moment you are in a league, so it disappears instead of nagging. The
#create-league anchor three other surfaces link to still resolves, and that has its own test."
```

---

## Task 6: The glossary, and one primitive that gives a word a definition

Two backlog items and half of Step 14's "coach a brand-new user" in one task. Phase 1's `/browse` persona panel ledgered "snake/jargon glossary" and "scoring format on cards"; Plan B's ledgered "badge/lock vocabulary alignment". They are the same problem: this product uses words a newcomer has never seen, in places where nobody is there to ask.

**Files:**
- Create: `src/help/config.ts`, `src/help/glossary.ts`, `src/help/glossary.test.ts`
- Create: `src/components/ui/info-tip.tsx`, `src/components/ui/info-tip.test.tsx`
- Modify: `src/components/ui/index.ts`
- Create: `src/scoring/describe.ts`, `src/scoring/describe.test.ts`
- Modify: `src/matchmaking/contract.ts`, `src/league-service/browse.ts` (+ tests)
- Modify: `src/league-room/components/public-league-list.tsx` (+ test)
- Modify: `src/league-room/components/standings-table.tsx` (+ test)
- Modify: `src/draft-room/components/room-rail.tsx` (+ test)
- Modify: `eslint.config.mjs` (add `src/help/**` to the browser-safe exempt list)

**Interfaces:**
- Consumes: `ScoringSettings` from `@/domain/scoring`, `HelpLevel` (Task 4), `Icon`.
- Produces:
  - `type TermKey`, `interface GlossaryTerm { readonly key: TermKey; readonly term: string; readonly short: string; readonly detail: string }`, `GLOSSARY`, `term(key): GlossaryTerm`
  - `InfoTip({ term, className })` from `@/components/ui/info-tip`
  - `describeScoring(settings): string` from `@/scoring/describe`
  - `PublicLeagueSummary` gains `scoringLabel: string`

- [ ] **Step 1: Write the failing `describeScoring` test**

`scoring_settings` stores fifteen weights and no preset name, so the label is derived. This lives in the already-gated `src/scoring/**`:

```ts
  it("names each shipped preset from its own weights", () => {
    expect(describeScoring(SCORING_PRESETS.standard)).toBe("Standard");
    expect(describeScoring(SCORING_PRESETS.ppr)).toBe("PPR");
    expect(describeScoring(SCORING_PRESETS.half_ppr)).toBe("Half PPR");
    expect(describeScoring(SCORING_PRESETS.te_premium)).toBe("PPR, TE premium");
  });

  it("describes a custom league honestly rather than mislabeling it", () => {
    // A commissioner who edits a weight has a league that is not any preset. Calling it "PPR"
    // because one field matches would be a scoreboard-shaped lie on a page people join from.
    expect(describeScoring({ ...SCORING_PRESETS.ppr, pointsPerPassingTouchdown: 6 })).toBe("Custom");
  });
```

- [ ] **Step 2: Write the failing glossary and `InfoTip` tests**

```tsx
  it("reveals a definition on click and hides it again, with no hover in the mechanism", async () => {
    // Hover-only help fails WCAG 2.2's 1.4.13 and does not exist on a phone, which is this
    // product's minimum viewport. The control is a real button with aria-expanded.
    render(<InfoTip term="snake-draft" />);
    const trigger = screen.getByRole("button", { name: "What is a snake draft?" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("note")).toHaveTextContent("picks run 1 to 12, then 12 to 1");
    await userEvent.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("every term has a short line and a longer one, and no em-dash anywhere", () => {
    for (const entry of Object.values(GLOSSARY)) {
      expect(entry.short.length).toBeLessThanOrEqual(HELP_CONFIG.maxShortLength);
      expect(entry.detail).toMatch(/\S/);
      expect(`${entry.term}${entry.short}${entry.detail}`).not.toContain("—");
    }
  });
```

The em-dash assertion is a founder rule turned into a gate, in the one file that is nothing but user-facing copy. It is cheap here and impossible to enforce by review forever.

- [ ] **Step 3: Write the registry**

Terms, keyed and defined once: `snake-draft`, `auction-draft`, `ppr`, `half-ppr`, `te-premium`, `flex`, `bench`, `on-the-clock`, `lineup-lock`, `waiver` (only if a waiver surface exists; if not, leave it out rather than defining a feature the product does not have), `stake-tier`, `matchup`, `standings-record`.

`GLOSSARY.snake-draft.detail`: "Every manager picks in order, then the order reverses. In a 12-team league picks run 1 to 12, then 12 to 1, and back again. It means the manager who picks last in one round picks first in the next."

- [ ] **Step 4: Wire it into the four places jargon first lands**

1. **`/browse` cards** gain the scoring label beside the format. `PublicLeagueSummary` gains `scoringLabel`, `browseQuery` joins `scoring_settings`, and `browse.test.ts`'s exact-wire-key assertion is updated **deliberately, in its own step**, because that assertion is the privacy boundary: adding a field to the one unauthenticated response in this product is a disclosure decision. The disclosure is defensible and the commit body says why: scoring weights are a property of the league being advertised, not of any person, and a manager cannot evaluate a league to join without them. Format and scoring both carry an `InfoTip`.
2. **Standings header** carries an `InfoTip` on the record column.
3. **The draft room rail** carries one on "on the clock" and on the format name.
4. **The lineup lock message** carries one on lineup lock, which Plan B's persona panel flagged as under-explained.

In `guided` help level, `InfoTip` additionally renders its `short` line inline beneath the term rather than behind the control, so a first-timer reads it without knowing to click. Same component, one prop, one branch, both tested.

- [ ] **Step 5: PERSONA-PANEL PASS**

**CONTROLLER STEP.** Four personas over the four wired surfaces. The **first-timer** is the reason this exists; the **high-stakes veteran** is the risk, since a page speckled with help affordances reads as a beginner's product. The panel's job is to rule on whether `standard` help level should hide the trigger entirely or keep it quiet, and that ruling goes in the ledger. Also confirm the glossary's copy against the vocabulary Plan B's `WeekStatusBadge` already ships, per the ledgered "badge/lock vocabulary alignment" item.

- [ ] **Step 6: Run and commit**

```bash
npm test -- src/help
npm test -- src/scoring
npm test -- src/components/ui
npm test -- src/league-service
npm test -- src/league-room
npm run test:coverage
npm run typecheck && npm run lint && npm run build
```

```bash
git add src/help src/scoring src/components/ui src/league-service src/league-room src/draft-room src/matchmaking eslint.config.mjs
git commit -m "feat(help): definitions where the jargon lands, and a scoring label browse never had

Three ledgered persona findings across two phases were the same problem: this product uses words a
newcomer has never seen, in places where nobody is there to ask. One registry now holds every
definition, one InfoTip primitive is the only way one gets shown, and a test asserts the copy in
that registry carries no em-dash, because a founder rule that only review enforces is a founder
rule that erodes.

InfoTip is click, never hover. Hover-only help fails WCAG 2.2 1.4.13 and does not exist at all on
this product's minimum viewport.

scoring_settings stores fifteen weights and no preset name, so the browse card's scoring label is
derived from the weights, and a league whose commissioner edited one reads Custom rather than
being mislabeled as PPR because a single field matched. Adding that field to PublicLeagueSummary
is a deliberate disclosure on the one unauthenticated route in the product: scoring is a property
of the league being advertised, not of any person, and nobody can evaluate a league to join
without it."
```

---

## Task 7: League terms, and an invite that tells you what you are agreeing to

The invite landing page says: *"You've been invited to a league. Invite code ABC123."* and offers a button. It names no league, no format, no size, no scoring, no stake tier and no commissioner. This product is two phases from holding real money, and that page is where somebody agrees to something.

**Files:**
- Create: `src/league/terms.ts`, `src/league/terms.test.ts` (existing gated directory)
- Modify: `src/league-service/invites.ts` (+ test)
- Modify: `src/league-service/index.ts`
- Create: `src/app/api/invites/[code]/route.ts` (+ test)
- Create: `src/league-room/components/league-terms-panel.tsx` (+ test)
- Modify: `src/league-room/components/join-form.tsx` (+ test)
- Modify: `src/app/app/join/[code]/page.tsx`
- Modify: `src/league-room/contract.ts`

**Interfaces:**
- Consumes: `describeScoring` (Task 6), `stakeTierLabel` and `MATCHMAKING_CONFIG.stakeDisclosure` from `@/matchmaking`, `RosterSlotConfig` from `@/domain/roster`, `InfoTip` (Task 6).
- Produces:
  - `interface LeagueTerms { readonly name: string; readonly format: DraftFormat; readonly teamCount: number; readonly filledTeams: number; readonly scoringLabel: string; readonly rosterLine: string; readonly stakeLabel: string; readonly stakeDisclosure: string; readonly commissionerName: string; readonly commissionerAvatar: string | null }`
  - `leagueTerms(input): LeagueTerms` from `@/league/terms`
  - `invitePreview(db, code): Promise<InvitePreviewResult>` from `@/league-service/invites`
  - `GET /api/invites/[code]`
  - `LeagueTermsPanel({ terms })`

Task 8 renders the same panel inside the league.

- [ ] **Step 1: Write the failing pure test**

```ts
  it("renders a roster shape a human can read, not a config array", () => {
    expect(leagueTerms({ ...BASE, rosterSlots: STANDARD_ROSTER_SLOTS }).rosterLine)
      .toBe("1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1 DEF, 6 bench");
  });

  it("carries the stake disclosure verbatim, from the one place it is written", () => {
    // Phase 1 wrote this sentence once and put it on /browse. The invite page is the other place
    // somebody decides to enter a league, and two hand-written versions of "no money changes
    // hands" is exactly how one of them ends up out of date the week money starts changing hands.
    expect(leagueTerms(BASE).stakeDisclosure).toBe(MATCHMAKING_CONFIG.stakeDisclosure);
  });

  it("names the commissioner", () => {
    expect(leagueTerms({ ...BASE, commissioner: { displayName: "Ada Lovelace", avatarUrl: "preset:crown" } }).commissionerName)
      .toBe("Ada Lovelace");
  });
```

- [ ] **Step 2: Write `invitePreview`, refusing to leak**

`invitePreview` runs the same validity checks `acceptInvite` runs (exists, not expired, uses remaining) and returns the same plain-language refusals from the same constants, so a dead link says the same thing on the preview as it does on the accept. Its test asserts that an **invalid** code returns the refusal and **no league fields at all** — a preview endpoint that leaks a league's name for any code somebody guesses is an enumeration oracle over private leagues.

```ts
  it("tells you nothing about a league when the code is not valid", async () => {
    const result = await invitePreview(db, "NOPE99");
    expect(result).toEqual({ ok: false, reason: "That invite link isn't valid. Ask your commissioner for a new one." });
    expect(JSON.stringify(result)).not.toContain(SEEDED_LEAGUE_NAME);
  });
```

- [ ] **Step 3: Build the panel and put it on the join page**

`LeagueTermsPanel` is a `Card` with a definition list: league name as the heading, then format (with its `InfoTip`), size as "8 of 12 managers", scoring (with its `InfoTip`), the roster line, the stake label with the disclosure sentence directly beneath it, and the commissioner with their `Avatar`. Loading is a `Skeleton`; an invalid code is an `ErrorState` whose action is a link back to `/app` (never a dead end).

`JoinForm` renders it above the button and the button's label becomes specific: `Join {league name}`. A confirmation that names what you are confirming.

- [ ] **Step 4: Run and commit**

```bash
npm test -- src/league
npm test -- src/league-service
npm test -- src/league-room
npm run test:coverage
npm run typecheck && npm run lint && npm run build
```

```bash
git add src/league src/league-service src/league-room src/app
git commit -m "feat(league): an invite that says what you are agreeing to

The invite landing page named a six-character code and offered a button. It named no league, no
format, no size, no scoring, no stake tier and no commissioner. This product is two phases from
holding real money and that page is where somebody agrees to something.

leagueTerms is pure and lives in the gated league directory, so the same facts render on the join
page and inside the league and cannot diverge. The stake disclosure is read from
MATCHMAKING_CONFIG rather than retyped: two hand-written versions of 'no money changes hands' is
exactly how one of them is stale the week money starts changing hands.

An invalid code returns the refusal and no league fields at all, asserted directly. A preview
endpoint that leaks a name for any guessed code is an enumeration oracle over private leagues."
```

---

## Task 8: The same terms, still visible after you have joined

Trust is not a one-time disclosure. Once a manager is in a league, nothing in this product tells them how it scores, what its roster shape is, or who runs it, and Plan B's persona panel already found a commissioner surprised by a control disappearing with no explanation. The terms panel Task 7 built is the answer, rendered where members live.

**Files:**
- Modify: `src/league-service/read.ts` (+ test)
- Modify: `src/league-room/contract.ts`
- Modify: `src/league-room/components/league-home.tsx` (+ test)
- Modify: `src/app/app/leagues/[leagueId]/page.tsx`
- Modify: `docs/league.md`

**Interfaces:**
- Consumes: `leagueTerms` (Task 7), `LeagueTermsPanel` (Task 7), `LeagueMembersPanel` (Task 3).
- Produces: `LeagueHomeBody` gains `terms: LeagueTerms`.

- [ ] **Step 1: Write the failing service test**

```ts
  it("gives every member the league's terms, not just the commissioner", async () => {
    // The one thing that would make this surface pointless is gating it on isCommissioner. The
    // terms are what everybody in the league is playing under.
    const asMember = await leagueHome(db, "l1", "u2");
    expect(asMember!.terms.scoringLabel).toBe("PPR");
    expect(asMember!.terms.commissionerName).toBe("Ada Lovelace");
    expect(asMember!.isCommissioner).toBe(false);
  });

  it("costs no extra round trip", async () => {
    // leagueHome already reads the league, its scoring settings and its teams. The terms are
    // assembled from rows it holds, not fetched again.
    const { queries } = await countQueries(() => leagueHome(db, "l1", "u2"));
    expect(queries).toBe(BASELINE_LEAGUE_HOME_QUERIES);
  });
```

- [ ] **Step 2: Assemble the terms from rows already in hand and render the panel**

`leagueHome` already selects the league, its `scoring_settings` and its `TeamCard[]`. The commissioner's own display name is the one field it does not hold; fold it into the existing team-owner select rather than adding a query, since the commissioner has a team in every league (`createLeague` gives them one in the same transaction).

On `league-home.tsx`, the terms panel and the members panel sit together in a "How this league works" section, below the board and above chat.

- [ ] **Step 3: PERSONA-PANEL PASS**

**CONTROLLER STEP.** This panel covers **both** trust surfaces: the invite preview from Task 7 and this in-league panel. Four personas, 360px and desktop, both themes. The **commissioner** persona reads this as "does my league look like the thing I told my friends it was", and the **high-stakes veteran** reads it as "can I verify the scoring without asking anybody". The panel must also check the copy against Plan B's ledgered commissioner finding, since this is now the place a commissioner learns how their league behaves. Record findings in the SDD ledger.

- [ ] **Step 4: Run and commit**

```bash
npm test -- src/league-service
npm test -- src/league-room
npm run typecheck && npm run lint && npm run build
```

```bash
git add src/league-service src/league-room src/app docs
git commit -m "feat(league): the terms stay visible after you join, and everybody can see them

Trust is not a one-time disclosure. Nothing told a manager already in a league how it scores, what
its roster shape is, or who runs it, and Plan B's persona panel already found a commissioner
surprised by a control that vanished with no explanation.

Every member sees the terms, not just the commissioner, and there is a test that says so: gating
this on isCommissioner is the single change that would make the surface pointless.

It costs no extra round trip. leagueHome already held the league, its scoring settings and its
team owners; the commissioner's name folded into the select that was already running."
```

---

## Task 9: The unfiltered review feed

Spec Step 17. The whole point is that it is unfiltered by rating, so the interesting engineering is not the form, it is proving the absence of curation and drawing the moderation line where Phase 3 can pick it up without a rewrite.

**Files:**
- Create: `src/reviews/config.ts`, `src/reviews/contract.ts`, `src/reviews/validate.ts`, `src/reviews/validate.test.ts`
- Create: `src/review-service/reviews.ts`, `src/review-service/reviews.test.ts`, `src/review-service/schemas.ts`
- Create: `src/app/api/reviews/route.ts` (+ test), `src/app/api/reviews/_shared.ts`
- Create: `src/app/api/reviews/[reviewId]/report/route.ts` (+ test)
- Create: `src/app/reviews/page.tsx`
- Create: `src/account-room/components/review-composer.tsx` (+ test), `src/account-room/components/review-feed.tsx` (+ test)
- Create: `src/components/ui/textarea.tsx` (+ test), modify `src/components/ui/index.ts`
- Create: `scripts/remove-review.ts`
- Modify: `src/db/schema.ts`, `src/db/schema.test.ts`, `package.json`, `src/app/page.tsx` (link the feed from the landing page)
- Create: `drizzle/0016_reviews.sql`
- Modify: `e2e/onboarding.spec.ts`

**Interfaces:**
- Consumes: `Avatar` (Task 1), `withCurrentUser`, `createRateLimiter`, `parseAvatarRef`.
- Produces:
  - `REVIEW_CONFIG` (rating range 1–5, body 20–1000, `pageSize`, `reportReasons`)
  - `interface ReviewView { readonly id: string; readonly rating: number; readonly body: string; readonly createdAt: string; readonly updatedAt: string; readonly authorName: string; readonly authorAvatar: string | null }`
  - `validateReviewDraft(draft): { readonly ok: true } | { readonly ok: false; readonly message: string }`
  - `submitReview(db, input)`, `listReviews(db, { before? })`, `reportReview(db, input)`, `removeReview(db, input)`
  - `Textarea` on `@/components/ui`
  - `reviews` and `reviewReports` tables

- [ ] **Step 1: Add the tables and the migration**

```ts
/**
 * One review per person, edited rather than duplicated: `user_id` is UNIQUE, so "I already wrote
 * one" is a database fact and not a count the service has to get right.
 *
 * Removal is a stamp, never a delete. A removed review keeps its author, its text, who removed it
 * and why, because the alternative is that a product with an unfiltered review feed can make a
 * review disappear leaving nothing behind. Phase 3 owns the real audit log; this row is the
 * interim record it will read, not a second system it will have to reconcile.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedByUserId: text("removed_by_user_id").references(() => users.id),
    removalReason: text("removal_reason"),
  },
  (t) => [
    uniqueIndex("reviews_user_idx").on(t.userId),
    /** The feed's only ordering. Partial on visibility, because the feed never reads removed rows. */
    index("reviews_feed_idx").on(t.createdAt).where(sql`${t.removedAt} is null`),
  ],
);

export const reviewReports = pgTable(
  "review_reports",
  {
    reviewId: text("review_id").notNull().references(() => reviews.id, { onDelete: "cascade" }),
    reporterUserId: text("reporter_user_id").notNull().references(() => users.id),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.reviewId, t.reporterUserId] })],
);
```

```bash
npm run db:generate && npm run db:migrate && npm run db:migrate:test
```

Read the SQL before applying. Add the `CREATE INDEX CONCURRENTLY` runbook note for Plan D, matching the notes migrations 0011 through 0014 already carry.

- [ ] **Step 2: Write the failing service tests — the curation proof first**

```ts
  it("shows a one-star review exactly where a five-star one would be", async () => {
    // The spec's own exit criterion. Ordering is by time and nothing else, so the assertion is
    // positional: the newest review leads whatever its rating.
    await submitReview(db, { userId: "u1", rating: 5, body: LONG_ENOUGH, clock: at("2026-08-01T00:00:00Z") });
    await submitReview(db, { userId: "u2", rating: 1, body: BRUTAL, clock: at("2026-08-02T00:00:00Z") });
    const feed = await listReviews(db, {});
    expect(feed.reviews.map((r) => r.rating)).toEqual([1, 5]);
  });

  it("has no rating predicate in the feed query at all", async () => {
    // Stronger than the case above, which a filter tuned to hide 2-star reviews would still pass.
    // The query's own SQL is inspected: a rating comparison in the feed is the bug this whole
    // feature exists to not have.
    const { sql: text } = feedQuery(db, {}).toSQL();
    expect(text).not.toMatch(/rating/i);
  });

  it("edits the existing review rather than adding a second", async () => {
    await submitReview(db, { userId: "u1", rating: 2, body: LONG_ENOUGH, clock: at("2026-08-01T00:00:00Z") });
    await submitReview(db, { userId: "u1", rating: 4, body: REVISED, clock: at("2026-08-03T00:00:00Z") });
    const feed = await listReviews(db, {});
    expect(feed.reviews).toHaveLength(1);
    expect(feed.reviews[0]).toMatchObject({ rating: 4, body: REVISED, createdAt: "2026-08-01T00:00:00.000Z" });
  });

  it("excludes a removed review from the feed and keeps every fact about the removal", async () => {
    await submitReview(db, { userId: "u1", rating: 5, body: SPAM, clock: at("2026-08-01T00:00:00Z") });
    await removeReview(db, { reviewId: "r1", removedByUserId: "operator", reason: "spam", clock: at("2026-08-04T00:00:00Z") });
    expect((await listReviews(db, {})).reviews).toHaveLength(0);
    const [row] = await db.select().from(reviews).where(eq(reviews.id, "r1"));
    expect(row).toMatchObject({ body: SPAM, userId: "u1", removedByUserId: "operator", removalReason: "spam" });
  });
```

- [ ] **Step 3: Write the service, the schemas and the routes**

`GET /api/reviews` is **public** and therefore rate-limited by IP, copying `src/app/api/public/leagues/_shared.ts` exactly rather than inventing a second pattern. `POST /api/reviews` is behind `withCurrentUser` and rate-limited by user id. `POST /api/reviews/[reviewId]/report` is behind `withCurrentUser`, takes a reason from `REVIEW_CONFIG.reportReasons`, and is idempotent by primary key (reporting twice is not an error, it is the same report).

- [ ] **Step 4: Build `Textarea`, then the composer and the feed**

`Textarea` is the multi-line sibling of `Input`, built on the same `FieldShell` and `useFieldIds` so label, hint, error and `aria-describedby` behave identically. It takes a `maxLength` and renders a live remaining-character count wired to the field with `aria-describedby`, announced politely rather than on every keystroke.

`ReviewComposer` loads the user's existing review if there is one and says so ("You've already left a review. Editing replaces it."). Rating is a radio group of five, labeled in words, not stars alone: `1, poor` through `5, excellent`, because a star glyph has no accessible name.

`ReviewFeed` is newest-first with a "Show more" control, an `EmptyState` whose action is the composer, and a report control per row. `src/app/reviews/page.tsx` server-renders the first page, is readable signed out, and is linked from the landing page and from `/app/profile`.

- [ ] **Step 5: The operator removal path**

```json
"reviews:remove": "dotenv -e .env.local -- tsx scripts/remove-review.ts",
```

`scripts/remove-review.ts` takes `--id`, `--reason` and `--by`, refuses to run without all three, prints the row it is about to stamp and asks for confirmation, then writes the removal and emits one JSON line naming the review, the author, the operator, the reason and the timestamp. There is deliberately **no admin UI and no staff role** (ruling 18): Phase 3 owns moderation and audit, and inventing a role here would be building the thing Phase 3 plans to build properly.

- [ ] **Step 6: PERSONA-PANEL PASS**

**CONTROLLER STEP.** Four personas over the feed, the composer and the report control, 360px and desktop, both themes. The **first-timer** reads this page before signing up and is the reason it must be readable signed out. The **high-stakes veteran** is checking whether the negative reviews are really there. The **commissioner** is the person most likely to be the subject of a complaint. Record findings in the SDD ledger.

- [ ] **Step 7: Extend the e2e journey and commit**

Add to `e2e/onboarding.spec.ts`: a signed-in manager writes a 1-star review, and it appears at the top of `/reviews` in a signed-out browser context.

```bash
npm test -- src/reviews
npm test -- src/review-service
npm test -- src/account-room
npm test -- src/components/ui
npm test -- src/db
npm run test:coverage
npm run typecheck && npm run lint && npm run build
NEXT_DIST_DIR=.next-e2e npm run build && npm run e2e
```

```bash
git add src/reviews src/review-service src/account-room src/components/ui src/db src/app scripts package.json drizzle e2e
git commit -m "feat(reviews): an unfiltered feed, proved against the query rather than the copy

The point of this feature is the absence of curation, so the test that matters inspects the feed
query's own SQL and asserts it contains no rating predicate at all. A positional assertion that a
one-star review leads would still pass under a filter tuned to hide two-star ones; this will not.

Removal is a stamp, never a delete: a removed review keeps its author, its text, who removed it and
why. A product with an unfiltered review feed that can make a review vanish leaving nothing behind
has not got one.

There is no admin UI and no staff role. Phase 3 owns moderation and audit outright, and inventing a
role here would be building the thing Phase 3 plans to build properly. Removal is an operator
script that names what it is about to do and records what it did; the report affordance is
in-product, idempotent by primary key, because reporting twice is the same report.

The feed is readable signed out, because the person it is for has not signed up yet."
```

---

## Task 10: The GIF seam, keyless-mergeable, and chat that degrades to text

Spec Step 16's GIF half. The overview carved this to "the `GifProvider` adapter seam and its unconfigured-degrade path only", and there is a version of that which is dead code: an interface nothing calls. This task builds the version that is not, using the shape Plan A proved with Tank01 — a **real** adapter, fetch injected, verified against committed fixtures, so the day a Giphy key exists it is a config value and not a code change.

Voice messages are the other half of Step 16 and are **not** in this plan: they need the object store, which is Plan D's (ruling 19).

**Files:**
- Create: `src/gifs/provider.ts`, `src/gifs/config.ts`, `src/gifs/registry.ts` (+ tests), `src/gifs/test-support.ts`
- Create: `src/gifs/giphy/client.ts`, `config.ts`, `map.ts`, `giphy-gif-provider.ts` (+ tests)
- Create: `src/gifs/giphy/fixtures/search-touchdown.json`, `fixtures/manifest.json`
- Create: `src/app/api/gifs/search/route.ts` (+ test)
- Create: `src/chat-room/components/gif-picker.tsx` (+ test)
- Modify: `src/db/schema.ts`, `drizzle/0017_chat_message_gifs.sql`
- Modify: `src/chat/contract.ts`, `src/chat/config.ts`, `src/chat-service/chat.ts`, `src/chat-service/schemas.ts` (+ tests)
- Modify: `src/chat-room/components/message-list.tsx`, `src/chat-room/components/chat-composer.tsx` (+ tests)
- Modify: `.env.example`

**Interfaces:**
- Consumes: `envOr` / `envOrUndefined` from `@/lib/env`, `ChatMessageView` from `@/chat/contract`.
- Produces:
  - `interface GifResult { readonly id: string; readonly previewUrl: string; readonly url: string; readonly width: number; readonly height: number; readonly alt: string }`
  - `interface GifProvider { search(query: string, limit: number): Promise<readonly GifResult[]> }`
  - `createGifProvider(): GifProvider | null` from `@/gifs/registry`
  - `describeGifProviderContract(label, factory)` from `@/gifs/test-support`
  - `ChatMessageView` gains `gif: ChatGif | null`; `ChatPageBody` gains `gifSearchEnabled: boolean`
  - `GET /api/gifs/search?q=`

- [ ] **Step 1: Write the provider contract suite first**

`src/gifs/test-support.ts`, in the shape `src/stats/test-support.ts` established, so a future Tenor adapter runs it unchanged:

```ts
export function describeGifProviderContract(label: string, factory: () => Promise<GifProvider>): void {
  describe(`${label} satisfies the GifProvider contract`, () => {
    it("returns at most the number of results asked for", async () => {
      expect((await (await factory()).search("touchdown", 3)).length).toBeLessThanOrEqual(3);
    });

    it("gives every result a usable image, a preview, real dimensions and alt text", async () => {
      // Alt text is not optional: a GIF in a chat log with no alt is a message a blind manager
      // cannot read. If upstream has no description, the adapter synthesizes one from the query.
      for (const gif of await (await factory()).search("touchdown", 5)) {
        expect(gif.url.startsWith("https://")).toBe(true);
        expect(gif.previewUrl.startsWith("https://")).toBe(true);
        expect(gif.width).toBeGreaterThan(0);
        expect(gif.height).toBeGreaterThan(0);
        expect(gif.alt).toMatch(/\S/);
      }
    });

    it("never returns the same id twice in one search", async () => {
      const ids = (await (await factory()).search("touchdown", 10)).map((gif) => gif.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("answers an empty query with no results rather than an error", async () => {
      await expect((await factory()).search("   ", 5)).resolves.toEqual([]);
    });
  });
}
```

- [ ] **Step 2: Build the Giphy adapter against committed fixtures**

Mirror `src/stats/tank01/` exactly: a `client.ts` taking an injected `fetch` with a file-wide thrower guard in tests so no test can reach `api.giphy.com` even with a key present; `map.ts` mapping the `data[]` array's `images.fixed_height` and `images.original` entries with string-number coercion; a `manifest.json` recording provenance as `authored-from-published-response-shapes`; and a rating ceiling (`GIPHY_CONFIG.rating = "pg-13"`) sent on every request, because an unrated GIF search in a league chat is a moderation surface this phase has no answer for, exactly as `CHAT_CONFIG` says about the closed reaction set.

The adapter fails **loudly** on an HTTP 200 carrying an error body, following the refusal-detection Plan A's Tank01 client added.

- [ ] **Step 3: The registry, unconfigured by default**

```ts
/**
 * `GIF_PROVIDER=none` (the default) returns null, and null means the picker is never rendered and
 * the search route 404s. That is the degrade path: chat stays exactly what it is today, text and
 * emoji, with no broken search box and no empty result grid explaining itself.
 *
 * An unrecognized provider name FAILS FAST with a clear typed error rather than falling back to
 * none, matching `src/stats/registry.ts`: a typo in a deploy's env is a misconfiguration to be
 * shouted about, not a feature to silently lose.
 */
export function createGifProvider(): GifProvider | null
```

- [ ] **Step 4: Teach chat a GIF is a message**

Migration 0017 adds to `chat_messages`: `kind` (`chat_message_kind` enum, `text` | `gif`, default `text`), `gif_url`, `gif_preview_url`, `gif_alt`, `gif_width`, `gif_height`, all nullable. Explicit columns rather than a `jsonb` blob, because the shape is fixed and small and a blob is unvalidatable at the database.

`postMessage` accepts an optional `gif` and writes both in one insert. **No new event type**: the existing `chat.message` frame already carries the whole `ChatMessageView`, and the client already folds it (ruling 17). `message-list.tsx` renders the GIF with its `alt`, `width` and `height` set so the message list does not reflow when it loads, and `loading="lazy"`.

Server-side validation refuses a `gif` whose `url` is not `https://` and whose dimensions are outside `CHAT_CONFIG.gif` bounds, because the client sends the chosen result back and a client-chosen URL is a client-controlled URL.

- [ ] **Step 5: The composer branches on the capability**

`ChatPageBody` gains `gifSearchEnabled`, set from `createGifProvider() !== null`. `ChatComposer` renders the GIF button only when it is true. The two tests that matter:

```tsx
  it("offers no GIF control when the seam is unconfigured", () => {
    renderChat({ gifSearchEnabled: false });
    expect(screen.queryByRole("button", { name: "Add a GIF" })).toBeNull();
    // And the thing that must still be true: chat is not degraded, it is unchanged.
    expect(screen.getByRole("textbox", { name: "Message" })).toBeEnabled();
  });

  it("sends a chosen GIF as a message and shows it with its alt text", async () => {
    renderChat({ gifSearchEnabled: true, search: async () => [TOUCHDOWN] });
    await userEvent.click(screen.getByRole("button", { name: "Add a GIF" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search GIFs" }), "touchdown");
    await userEvent.click(await screen.findByRole("button", { name: TOUCHDOWN.alt }));
    expect(await screen.findByRole("img", { name: TOUCHDOWN.alt })).toBeInTheDocument();
  });
```

- [ ] **Step 6: PERSONA-PANEL PASS**

**CONTROLLER STEP.** Four personas over the composer with and without the seam configured, and over a chat log containing a GIF, at 360px and desktop, both themes. The **social casual** is who this feature is for and the panel should confirm it feels like the reason they came. The **high-stakes veteran** cares that a tall GIF does not push a live scoreboard off screen. Record findings in the SDD ledger.

- [ ] **Step 7: Run and commit**

```bash
npm test -- src/gifs
npm test -- src/chat
npm test -- src/chat-service
npm test -- src/chat-room
npm run test:coverage
npm run typecheck && npm run lint && npm run build
```

```bash
git add src/gifs src/chat src/chat-service src/chat-room src/db src/app drizzle .env.example
git commit -m "feat(gifs): a real adapter behind a seam, and chat that is unchanged without a key

The overview carved this to 'the seam and its unconfigured-degrade path', and there is a version of
that which is dead code: an interface nothing calls. This is the other version, built the way Plan
A built Tank01 — a real Giphy client with fetch injected, mapped against committed fixtures with a
provenance manifest, so a key is a config value and never a code change.

A GIF is a message, so it rides chat.message. Adding chat.gif would mean two publish paths and two
client folds for one row, which is how two renderings of the same thing drift.

Alt text is required by the contract suite, not merely produced by the adapter: a GIF in a chat log
with no alt is a message a blind manager cannot read. Dimensions ride along so the log does not
reflow when it loads.

Unconfigured, there is no GIF button and no explanation of its absence, because chat is not
degraded without one. It is what it already was. Voice messages are Step 16's other half and need
the object store, which is Plan D's."
```

---

## Task 11: Docs, four more gates, and the closing battery

**Files:**
- Modify: `vitest.config.mts`
- Modify: `docs/decisions/identity-and-trust.md` (finish it; Task 3 started it)
- Modify: `docs/conventions.md`, `docs/design-system.md`, `docs/league.md`, `README.md`, `.env.example`

- [ ] **Step 1: Add the four gates, with both halves each**

`src/identity`, `src/help`, `src/reviews` and `src/gifs` join `COVERAGE_GATED_DIRS` **and** each gets its own `thresholds` block. Plan A's fix wave found `src/stats` with an `include` entry and no threshold, which measured nothing; Plan B's Task 11 said one instance of that mistake per phase is enough, and this plan adds four directories at once, so the check is an unfiltered `npm run test:coverage` reporting **twelve** directories at 100%.

If any file cannot reach 100% honestly, do not lower the threshold and do not add an ignore comment: either the untestable part belongs at an edge (move it to a route or a `page.tsx`, which are not gated) or the branch is unreachable and should be deleted.

- [ ] **Step 2: Finish `docs/decisions/identity-and-trust.md`**

Sections:

1. **The avatar ref scheme** — the three cases, why only `https://` renders, and the one-line change that turns on uploads when Plan D has a bucket.
2. **Where identity renders** — the audit table from Task 3, updated to its final state, including the deliberate omission at the draft board.
3. **The preferences row** — why it holds two fields and not five, and the rule that produced that: a preference this product cannot honor does not ship as a control.
4. **The notification catalog and the deliverable seam** — what the product tells you about today, the `deliverableChannels()` predicate, and exactly what Plan D changes (one array, one column, one section of the profile page).
5. **The first-run rule** — guidance is ordering, never removal, and the test that pins it.
6. **League terms** — one pure function, two surfaces, and why the stake disclosure is read rather than retyped.
7. **The review feed's moderation boundary** — report in-product, removal by operator script, removal as a stamp, and precisely where Phase 3 takes over.
8. **The GIF seam** — the contract, the fixture discipline, the unconfigured path, the rating ceiling, and the deferral of voice with the resource it needs named.

- [ ] **Step 3: Correct the drift, by grep and not by guess**

```bash
grep -rn "eight gated\|EIGHT\|avatarUrl\|src=\{.*avatar\|no way to edit\|never clobbered\|onboarding" docs src README.md
```

Known targets: `docs/conventions.md`'s coverage-gate enumeration (eight becomes twelve), its client-boundary section (`src/account-room/**` joins the restricted set; `src/identity/**` and `src/help/**` join the exempt pure set), `docs/design-system.md` (the `Avatar` prop is a ref, six new `IconName`s, `InfoTip` and `Textarea` are primitives with their own rules), `docs/league.md` (the league terms surface, the members panel, the invite preview), `README.md` (the new scripts and env vars), `.env.example` (`GIF_PROVIDER`, `GIPHY_API_KEY`, commented out, with copy carrying no em-dash).

The em-dash rule binds **user-facing copy**, not engineering prose; these docs already use em-dashes pervasively and consistency with the surrounding text wins. `.env.example` comments are the exception, because a developer reads those as product copy.

- [ ] **Step 4: The closing battery**

```bash
npm run infra:down && npm run infra:up
npm run db:migrate && npm run db:migrate:test
npm run seed && npm run stats:ingest
npm test
npm run test:coverage                 # UNFILTERED: twelve gated dirs, all 100%
TEST_DATABASE_URL=$TEST_PGBOUNCER_URL npm test    # the whole suite through the pooler
npm run typecheck && npm run lint && npm run build
NEXT_DIST_DIR=.next-e2e npm run build && npm run e2e
npm run e2e                           # twice, back to back, per Plan A's precedent
```

The through-the-pooler run is Plan A's standing exit criterion. This plan adds three tables and several new write paths, so it is not optional.

- [ ] **Step 5: Commit**

```bash
git add docs vitest.config.mts README.md .env.example
git commit -m "docs: the identity and trust decision record, four more gates, and the drift sweep

Four new pure directories, four include entries and four thresholds blocks. Plan A's fix wave found
one directory in include with no threshold, which is not a gate; adding four at once without saying
so out loud is how that mistake scales.

The decision doc's job is to make Plan D's work small and obvious: uploads are one AvatarRef case
and one config flag, email notifications are one array, one column and one section of a page that
already exists. It says so as a list, because that is the actual claim.

The sweep is a grep and not a guess: the gate count, the client-boundary directory lists, the
Avatar prop's meaning, and user-sync's 'the user may have edited them in-app' docblock, which was
aspirational for two phases and is now describing something real."
```

---

## Open questions, self-ruled

Every judgment call this plan makes, numbered, with the reasoning that would have to be wrong for the ruling to be wrong.

1. **`users.avatarUrl` becomes a ref rather than gaining a second column.** A `avatar_preset` column beside `avatar_url` would mean two sources for one face and a precedence rule to get wrong at every read. One column with a parsed vocabulary has exactly one answer, and the parse is pure and tested. The cost is that the column's name is now slightly wrong; that is cheaper than a migration and a precedence rule, and the docblock says so.

2. **Only `https://` is ever rendered into an `<img src>`.** Before this plan the column was written only by WorkOS, so nobody had to think about it. Task 2 makes it user-writable. `javascript:`, `data:`, `http:` and protocol-relative are each named in a test rather than covered by a regex the reader has to trust, and the failure mode is initials, which is a real face rather than an error state.

3. **`src/account-room/**` is a new client-boundary directory, unlike Plan B's ruling 18 which declined one.** Plan B declined because a list of leagues is what the league room is. A profile, a preferences form and a review composer are not the league room by any reading, and putting them there would make the boundary rule's name a lie. The cost is one entry in `eslint.config.mjs` and one `deps.tsx` copy, both of which the rule's existing shape makes mechanical.

4. **Presets are code, and nothing in this plan uploads a file.** The overview carved upload to Plan D with the resource named. A preset that is an `IconName` plus a token pigment needs no bucket, no CDN, no image pipeline and no content moderation, all four of which an upload needs and none of which exist. Eight presets, not thirty, because a picker you scan in one glance beats a wall you scroll.

5. **The profile write path takes a preset key, never a URL.** Validating a user-supplied URL is a thing you can get right; not accepting one is a thing you cannot get wrong. When Plan D adds uploads, the URL is minted by our own upload handler and never by a request body, so this ruling survives that change rather than being undone by it.

6. **There is no `/onboarding` route; `/app` forks.** `handleAuth({ returnPathname: "/app" })` already lands every sign-in there, `middleware.ts` routes there, and `error.tsx`/`not-found.tsx` both link there as "Go to your leagues". A separate route would be a page a user can only see once, cannot get back to, and which would need its own guard against being shown to somebody with ten leagues. The fork lives on the home, is computed from live state, and disappears on its own.

7. **Guidance is ordering, never removal.** The spec says a first-timer "sees a short explainer" and an experienced user "skips straight to action", which could be read as showing different paths. It is read here as showing the same three paths in a different order with a different amount of prose, because `experienceTier` is self-reported, unverified, and set by a control most users will never touch. Hiding the create form from somebody who ticked "new to fantasy" and then came here to run their office league is a dead end produced by a guess.

8. **The draft board's seat headers stay text-only, deliberately.** Every other identity surface gains a face. That grid is the densest thing in the product, it already truncates team names at 24 columns wide, and a face per column costs the scan speed the board exists for. It is in the audit table as a decided omission rather than absent from it.

9. **The `user_preferences` row holds two fields, because two are read.** `helpLevel` is read by the fork and the glossary; `draftTourDismissedAt` is read by the tour. Anything else would be a column with no reader, and a column with no reader is a migration written for a feature nobody has specified.

10. **The tour's dismissal is a timestamp, not a boolean.** Same storage, strictly more information, and Phase 3's integrity work correlates behavior against time. A boolean would have to be widened later, which is a migration to avoid a character.

11. **No notification preference ships as a switch.** The spec does not ask for notification preferences at all; the plan brief does, with email named as Plan D's. A stored preference for a channel that has no sender is a control that changes nothing, which the user believes. So the model ships (the catalog, the channel union, the `deliverableChannels()` predicate) and the surface *describes* what the product tells you about and where, with one honest sentence about email and no toggle beside it. Plan D flips one array, adds one column and adds toggles to a section that already exists.

12. **The notification catalog is checked against the real event taxonomy.** A catalog is a promise about what you will be told. Deriving it from `REALTIME_EVENT_TYPES` means a topic cannot describe a notification nobody publishes, which is the failure mode a hand-written list has.

13. **`InfoTip` is click-activated, never hover.** Hover-only help fails WCAG 2.2's 1.4.13 (Content on Hover or Focus) and does not exist at all at 360px, which is this product's stated minimum viewport. The trigger is a real `<button>` with `aria-expanded`; Escape closes it.

14. **The glossary's copy is gated against em-dashes by a test.** The founder rule binds all user-facing copy, and a registry that is nothing but user-facing copy is the one file where the rule can be enforced mechanically instead of by review forever. It costs three lines.

15. **`scoringLabel` is added to `PublicLeagueSummary`, which is a deliberate disclosure.** That type is the documented privacy boundary of the only unauthenticated route in the product, and its test fails on any extra wire key precisely so that adding one is a decision. This one is defensible: scoring weights are a property of the league being advertised, not of any person, and a manager cannot evaluate a league to join without them. Compare the commissioner byline, which Phase 1's persona panel **rejected** for the same surface and which stays rejected here: that one is a person.

16. **The commissioner is named on the invite preview and inside the league, but still not on `/browse`.** The distinction is whether the reader is authenticated and specifically invited. An invite code is a capability its holder was given; `/browse` is the open internet. Ruling 15's line holds in both directions.

17. **A GIF rides `chat.message`; `chat.gif` is not added, contradicting the spec.** The spec's task list says to add it. A GIF is a message: it occupies a row in `chat_messages`, it is delivered by the same frame carrying the same `ChatMessageView`, and the client already folds it. A second event type would mean two publish paths and two client folds for one write, which is how two renderings of one thing drift. Recorded here rather than silently skipped.

18. **Review moderation is a report affordance plus an operator script, with no admin role.** There is no staff or admin concept anywhere in this codebase, and Phase 3 owns moderation and audit infrastructure outright. Building a role, a permission check and an admin UI here means building the thing Phase 3 plans to build properly, then reconciling two of them. The removal row carries author, text, operator, reason and timestamp, which is exactly what Phase 3's audit log will want to read.

19. **Voice messages are not in this plan.** Step 16's other half needs client recording uploaded to an object store served through a CDN, both of which the overview assigns to Plan D by name. The deferral is recorded in the decision doc with the resource named, matching how Plan A recorded its Tank01 key deferral.

20. **All four new pure directories join the coverage gate.** `src/identity`, `src/help`, `src/reviews` and `src/gifs` each get an `include` entry **and** a `thresholds` block. The alternative is a per-directory argument about which deserves a gate, which is exactly the argument that let `src/stats` ship with an `include` and no threshold. One rule, applied mechanically: a new pure or adapter directory in this codebase ships with a real gate.

21. **`REALTIME_EVENT_TYPES` becomes a runtime value in `src/lib/realtime/events.ts`.** The union is declared as a type today, which means nothing can iterate it. The notification catalog's check needs to. Declaring the array and deriving the type from it keeps one source and makes the type strictly better, and it is four lines in a file this plan already reads.

22. **`invitePreview` reveals nothing for an invalid code.** A preview endpoint keyed by a short code is an enumeration oracle if it distinguishes "no such code" from "here is a private league you were not invited to". It returns the same plain-language refusal `acceptInvite` returns, from the same constant, and a test asserts the seeded league's name appears nowhere in the response.

---

## Self-review

**Spec coverage — Step 14 (first-run onboarding), task by task:**

| Spec task (lines 552–557) | Where |
|---|---|
| First-run fork branching on `User.experienceTier` | Task 5 (`firstRunPlan`), made possible by Task 2 (the first write path to that column) |
| Surface create / join-by-invite / browse using existing components | Task 5 — the fork orders the three components `/app` already renders; nothing is rebuilt |
| Extend Step 8's zero-leagues empty state with the fork's guidance | Task 5 step 3 — `HomeBoard`'s `EmptyState` becomes `FirstRunPanel`, which is the extension Plan B deferred here by name |
| Skippable draft-room tour of the pick clock, queue and chat, shown once, persisted per user | Task 4 (`RoomTour` + `user_preferences.draft_tour_dismissed_at`) |
| Design-system standing rule: loading/empty/error states, a11y, keyboard, plain-language copy | Tasks 4 and 5, with the shared persona panel at Task 5 step 5 |
| Tests: first-timer sees the guided path, experienced sees the fast path, tour shown exactly once | Task 5 step 1 (both branches), Task 4 step 4 (the once-only case and its rerender) |

**Spec coverage — Step 15 (avatars and profile), the preset half:**

| Spec task (lines 587–592) | Where |
|---|---|
| `avatarUrl` field plus preset options requiring no upload | Task 1 — the column exists; this adds the ref vocabulary and eight presets |
| Custom upload with crop, validation and object storage | **Not built, by the overview's own carve-out.** Plan D, gated behind `AVATAR_CONFIG.uploads`, entering as one more `AvatarRef` case. Ruling 4 |
| Curated presets as a zero-effort default | Task 1, plus the initials fallback that means a user who chooses nothing still has a face |
| Render the chosen avatar everywhere identity is text-only, as an explicit audit list | Task 3, list written before it is satisfied, with one decided omission (ruling 8) |
| Design-system standing rule for upload/display states, a11y, copy | Tasks 2 and 3, panel at Task 3 step 5 |
| Tests: bad upload rejected, valid round-trips, no-avatar user falls back sensibly | Upload cases are Plan D's with the upload. The buildable equivalents are here: Task 1's hostile-value cases (the write path's version of "rejected"), Task 2's round-trip, and Task 1's initials fallback asserted in the primitive |

**Spec coverage — Step 16 (chat depth), the GIF half:**

| Spec task (lines 621–626) | Where |
|---|---|
| `GifProvider` adapter interface, real API behind a key env var, typed error if unconfigured | Task 10 (`src/gifs/**`, Giphy adapter, registry returning null for `none` and failing fast on unknown) |
| GIF picker in the composer, rendered inline in the stream via the event taxonomy | Task 10 steps 4 and 5 — inline rendering yes, `chat.gif` no, ruled at 17 |
| Voice messages | **Not built.** Needs the object store and the CDN, both Plan D's by the overview's carve-out. Ruling 19 |
| `chat.voice` event type | Not added, for the same reason |
| Design-system rule: loading, error with retry, keyboard operability; captions deferred | Task 10, panel at step 6 |
| Tests: GIF round-trips two SSE clients; chat degrades to text-only when unconfigured | Task 10 step 5 (both), reusing the existing two-client chat pattern |

**Spec coverage — Step 17 (review feed):**

| Spec task (lines 655–661) | Where |
|---|---|
| `Review` model, one per user, edits rather than duplicates, config-driven | Task 9 step 1 (`reviews_user_idx` unique) and step 2 (the edit case) |
| Submission form behind `requireAuth()`, plain-language validation | Task 9 steps 3 and 4 |
| Public feed, newest first, no editorial filter on rating | Task 9 step 2 — asserted against the query's SQL, not only its output |
| Moderation limited to spam/abuse: report, removal, logged with author, moderator, reason, timestamp | Task 9 steps 3 and 5; removal is a row, not a log line, and ruling 18 says where Phase 3 takes over |
| Reviewer's avatar and display name beside their review | Task 9 step 4, using Task 1's `Avatar` |
| Loading, empty and error states, a11y, copy review | Task 9 steps 4 and 6 |
| Tests: any rating appears, removed excluded but logged, no second review without the edit path | Task 9 step 2, all three |

**Plan B's ledgered items this plan answers:**

| Ledgered | Where |
|---|---|
| "the cross-league home EmptyState onboarding fork was EXPLICITLY deferred to Plan C" | Task 5 |
| "EmptyState single CTA nudges create-league when join/browse are equally valid first steps" | Task 5, ruling 7, confirmed in that task's panel |
| "badge/lock vocabulary alignment" | Task 6, checked in that task's panel |
| "commissioner hidden-second-duty hint" and the commissioner's need for in-product explanation | Tasks 3 and 8 |
| Phase 1: "scoring format on cards (contract addition)" | Task 6, ruling 15 |
| Phase 1: "snake/jargon glossary" | Task 6 |
| Phase 1: "member avatars/activity cues" | Task 3 (avatars; activity cues raised in that task's panel, not built) |

**Placeholder scan:** no `TODO`, no `TBD`, no "figure out later", no unnamed file, no step whose expected output is unstated. Every file in the File Structure tables appears in a task's Files block; every symbol in an Interfaces "Produces" line is consumed by a named later task or by a surface in its own task.

**Type consistency:** `AvatarRef` is declared once in `src/identity/avatars.ts` and consumed only through `Avatar`, so no call site holds one. `AvatarPresetKey` is the single source for both the Zod enum (Task 2) and the picker (Task 2), derived from `AVATAR_PRESETS` rather than typed twice. `HelpLevel` is declared in `src/identity/preferences.ts` and mirrored by `helpLevelEnum` in the schema, in the same relationship `GameStatus`/`weekStatusEnum` already have. `LeagueTerms` is declared once in `src/league/terms.ts` and rendered by one component used on two surfaces. `NotificationChannel` and `deliverableChannels()` live together, and `channelStatus` is the only reader of the config array. `ReviewView` is declared in `src/reviews/contract.ts` and imported by the service and the client as the wire shape. `GifResult` is declared in `src/gifs/provider.ts` and reaches the client only through `ChatMessageView.gif`, as a type.

**Boundary check:** `src/identity/**`, `src/help/**` and `src/reviews/**` are pure, import no server module, and are added to the browser-safe exempt list (Tasks 1, 6, 9). `src/account-room/**` is added to the restricted client set and talks to its service only over the wire. `src/gifs/**` is server-only and is imported by routes and `src/chat-service/**`, never by `src/chat-room/**`. `src/league/terms.ts` stays pure inside the already-gated `src/league/**`. Nothing under `src/**` imports `scripts/**`; `scripts/remove-review.ts` imports from `src/**`, which is the allowed direction.

**Founder rules:** six persona panels, each a marked controller step (Tasks 3, 5, 6, 8, 9, 10), covering every new user-facing surface in clusters that share a reader. Every string quoted in this plan for a user-facing surface is em-dash free, and Task 6 turns that rule into a test over the one file that is nothing but copy. `Avatar`, `InfoTip` and `Textarea` are centralized primitives with their existing consumers refactored in the same commit, per the 2026-08-18 correction. No mock data reaches a real surface: the GIF picker renders nothing at all rather than fake results when the seam is unconfigured, and a preset avatar is a real choice a real user made. Nothing here is built in a shape a later phase plans to replace: the avatar ref admits uploads as a case, the notification catalog admits email as a channel, and the review removal row is what Phase 3's audit log will read.
