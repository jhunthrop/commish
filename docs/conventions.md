# Commish — Engineering Conventions

**Read this first** before working on any step of the build plan (`plans/00-roadmap.md`). It is the single source of truth for how this repo is laid out and the rules every step assumes. `docs/design-system.md` is its visual counterpart for anything user-facing.

## Directive: no MVP

The founder's standing direction (2026-08-17): *"I don't want an MVP. Let's work towards the end solution."* Phases sequence **scope** (money, tax, native apps come later), not quality. Nothing gets built in a form a later phase plans to throw away. If a plan step still says "prototype-only" or "stub", read it through this directive.

## Stack (pinned)

| Concern | Choice | Notes |
|---|---|---|
| App | Next.js 15 (App Router), React 19, TypeScript strict | `"type": "module"` in `package.json` |
| Database | **Postgres 17** via Drizzle ORM (`drizzle-orm/postgres-js`, `postgres` driver) | Pure-JS wire protocol, no native compilation. SQLite was dropped (better-sqlite3 segfaults on this dev machine; and no-MVP directive). |
| Real-time | **Redis 7 Streams → Server-Sent Events** | The one and only real-time mechanism. See below. |
| Auth | **WorkOS AuthKit** (`@workos-inc/authkit-nextjs`) — hosted sign-in/up, sessions, MFA, OAuth | We do not roll our own auth. Local `users` row keyed by the WorkOS user id holds app-owned fields. |
| Validation | Zod v4 (`z.email()`, not the deprecated `z.string().email()`) | At every boundary. Zod schemas will also drive OpenAPI generation for native clients (Phase 7). |
| Tests | Vitest + happy-dom + @testing-library/react + vitest-axe | jsdom was dropped (broken ESM/CJS transitive deps across two major versions). |
| Local infra | `docker-compose.yml`: postgres (5432), postgres-test (5433, tmpfs), redis (6379, AOF everysec) | `npm run infra:up` |

`docker-compose.yml` pins a top-level `name: fantasy`, so every git worktree of this repo
resolves to the **same** Compose project instead of a `<directory-name>_default` derived from
each worktree's own path — without it, an agent working in a worktree spins up its own
redundant postgres/redis stack on the same host ports. Run `docker compose up -d` /
`npm run infra:up` from any worktree; they all talk to one shared stack.
| LLM | `@anthropic-ai/sdk` behind `src/lib/llm/` | Optional — every AI surface must degrade gracefully with no key. |

## Directory map

```
src/
  app/                    Next.js routes. API routes under app/api/**.
  app/app/drafts/[draftId]/       The live draft room (snake + auction).
  app/draft/[draftId]/board/      The read-only large-format TV draftboard.
  domain/                 Pure domain types + pure functions. NO I/O, NO Date.now(). readonly everywhere.
  draft-engine/           Pure draft reducer (snake + auction), clock schedule, selectors. 100% coverage.
  draft-service/          Durable replay-based draft store, commit seam, clock ticker, draft authz,
                          queue.ts (SET_QUEUE service seam), nudge.ts/nudge-copy.ts (AI draft
                          moderator — see docs/draft-moderator.md).
  draft-room/             The browser half of the draft: pure view reducer (state/, 100% coverage),
                          the useDraftRoom hook (hooks/), every room component (components/), and
                          id→display-name lookups (lib/). Imports from draft-engine are TYPE-ONLY —
                          no draft rule runs in React. See docs/draft-room.md.
  league/                 Pure league rules: schedule generation, standings, clinch, lineup
                          eligibility, invite codes, LEAGUE_CONFIG. NO I/O. 100% coverage.
  league-service/         League read/write service layer over Postgres: creation, invites,
                          schedule, lineups, results/standings. Consumed directly by app/api/leagues/**
                          route handlers and by app/**/*.tsx Server Components.
  league-room/            The browser half of the league: the create/join/invite client
                          components (components/), the fetchJson deps seam (hooks/), and
                          id→display-name lookups (lib/, re-exported from src/lib/display).
                          Imports from league/league-service are TYPE-ONLY — no league rule runs
                          in React.
  db/                     schema.ts (Drizzle, pg-core), client.ts (createDb/getDb), test-db.ts
  lib/
    auth/                 current-user.ts (server identity seam over WorkOS), user-sync.ts (profile upsert)
    realtime/             publish.ts, subscribe.ts, sse.ts, redis.ts, publisher.ts, events.ts, config.ts
    api/                  respond.ts — the JSON envelope + parseJson boundary validation
    display/              id→display-name lookups (teamsById/playersById/teamName/playerName)
                          shared by the draft room and the league room, so a second `.find(...)`
                          closure per room never appears.
    llm/                  shared Anthropic client (to be built)
  data/seed/              the ONE seeding entry point (`npm run seed`); later steps add seeders here
  design/                 tokens (to be built — see design-system.md)
  components/ui/          shared primitives (to be built — see design-system.md)
drizzle/                  generated SQL migrations (committed)
docs/                     conventions.md (this), design-system.md, draft-engine.md, draft-room.md,
                          draft-moderator.md, research/
plans/                    the phase blueprints
```

## Rules

### Immutability
Domain types are `readonly`; use `readonly T[]` / `Readonly<Record<…>>`. Update by spreading into new objects. (An ESLint `functional/*` rule for `src/domain/**` is pending — see `eslint.config.pending.mjs`.)

### Timing — no ambient clock in domain/reducer code
Anything time-dependent takes a `Clock` (`src/domain/timing.ts`) and calls `clock.now()`. Actions carry an explicit ISO `timestamp`. Tests inject a fixed clock. `Date.now()` / `new Date()` are only allowed at the outermost edge (route handlers, `current-user.ts`, `publisher.ts`).

### Identity — one seam, WorkOS underneath
- **WorkOS AuthKit owns authentication** (credentials, sessions, MFA, OAuth, password reset). We never store passwords or mint sessions.
- Server code reads "who is this" **only** via `getCurrentUser()` / `requireCurrentUser()` from `src/lib/auth/current-user.ts`. Nothing else imports `@workos-inc/authkit-nextjs` for identity — the seam is what lets us swap or extend the provider later.
- `users.id` **is** the WorkOS user id. `/callback` upserts the local row on every sign-in (`user-sync.ts`); app-owned fields (`displayName`, `experienceTier`, `avatarUrl`) are never clobbered by a sync.
- `src/middleware.ts` (composable `authkit()`/`handleAuthkitProxy`): pages under `/app` redirect to hosted sign-in; **API and SSE routes never redirect** — they return a JSON 401 themselves.
- Routes: `/sign-in`, `/sign-up` (hosted), `/sign-out` (POST), `/callback`, `GET /api/auth/me`.
- Env: `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD` (≥32 chars), `NEXT_PUBLIC_WORKOS_REDIRECT_URI`. Dashboard: Redirect URI `…/callback`, sign-in endpoint `…/sign-in`.

### Real-time — one mechanism
- **Writes are plain HTTP.** Validate → persist to Postgres → then `getPublisher().publish(...)`. Postgres is authoritative; publishing is best-effort and must never fail the write.
- **Delivery is Redis Streams over SSE.** Stream key `league:<id>:events`. Read with plain `XREAD BLOCK` from a per-connection cursor. **Never `XREADGROUP`** — consumer groups partition entries across consumers; a draft room needs every viewer to see every pick.
- **Resume** is via the standard `Last-Event-ID` header (the SSE `id:` is the stream entry id). Full-state refetch is the fallback only when a gap outlasts stream retention.
- **Event types** are enumerated once in `src/lib/realtime/events.ts` (`draft.*`, `chat.*`, `score.update`). Add there, nowhere else.
- **Draft events** (`draft.pick`, `draft.nominate`, `draft.bid`, `draft.timer_expire`, `draft.status`, `draft.queue`, `draft.nudge`) ride the **league** stream — there is no per-draft stream. Their payload contracts live in `docs/draft-engine.md`. `draft.nudge` is the one exception to "derived from the action log": it is published directly by the nudge scheduler on the ticker's own schedule, not by `draftEventsFor`. See `docs/draft-moderator.md`.
- **On the browser side there is exactly one consumer:** `useDraftRoom` (`src/draft-room/hooks/`),
  built on a native `EventSource`. The browser's own reconnect and `Last-Event-ID` are the whole
  reconnect mechanism — **no retry loop, no backoff timer, no polling.** A full refetch of
  `GET /api/drafts/[draftId]` is the documented fallback, and fires on a sequence gap or a
  reconnect. See `docs/draft-room.md`.
- No Socket.io, no managed realtime vendor, no second transport — ever.

### Draft state — the action log is the source of truth
An in-progress draft's state is *derived*, by replaying `draft_actions` through the pure
reducer in `src/draft-engine/`. Any in-memory materialization is a cache and must be safe to
drop at any moment. Every accepted action is persisted before it is cached or published, and
`teamId` is always resolved from the authenticated session, never from a request body.
See `docs/draft-engine.md`. `draft_nudges` (keyed on `(draftId, sequence)`) sits beside
`draft_actions` for a different job: it is the AI moderator's durable once-per-turn claim, not
part of replay — see `docs/draft-moderator.md`.

### Client boundary
Everything under `src/draft-room/**` and `src/league-room/**` is BROWSER code — the pure
state reducer/formatters, the hooks, and the client components that render the draft room and
the league room respectively. Each talks to its service layer ONLY over the wire
(`GET`/`POST /api/drafts/[draftId]*`, `GET`/`POST /api/leagues/**`,
`GET /api/leagues/[leagueId]/events`) — never by importing `@/draft-engine`, `@/draft-service`,
`@/league`, `@/league-service`, `@/db*` or `@/lib/realtime*` as VALUES. An ESLint
`@typescript-eslint/no-restricted-imports` rule (`eslint.config.mjs`, scoped to
`src/draft-room/**/*.{ts,tsx}` and `src/league-room/**/*.{ts,tsx}` only) enforces this;
`import type` stays allowed, since sharing a TYPE (e.g. `DraftStateView`, `LeagueSummary`)
costs nothing at runtime and is how the client and server sides of the wire stay in sync.

The rule is deliberately **not** applied to `src/app/**`: pages and layouts there are Next.js
Server Components (`page.tsx`, `layout.tsx`) and route handlers (`route.ts`), which are
allowed — and already do, in this codebase's existing draft and league routes — import
service-layer code (`@/draft-engine`, `@/draft-service`, `@/league`, `@/league-service`)
directly; that is the idiomatic Next.js pattern, not a boundary violation. A page can't be
told apart from a client component by its filename alone, so a glob covering `src/app/**`
would either miss real client code elsewhere or wrongly flag a legitimate server import. Any
client interactivity a page needs is a `"use client"` component imported FROM
`src/draft-room/**` or `src/league-room/**`, not inlined into the page file.
See `docs/draft-room.md` for the draft room's full fetch → SSE → apply → gap → refetch contract.

### API responses
Every JSON route returns the envelope from `src/lib/api/respond.ts`: `{ ok: true, data }` or `{ ok: false, error }` with a meaningful HTTP status. Bodies are parsed with `parseJson(request, ZodSchema)`; a bad body is a 400 naming the field. Error strings are user-facing plain language — never raw DB/exception text.

### Config over magic numbers
Thresholds, limits, durations, key formats live in a `config.ts` next to the module that uses them (`AUTH_CONFIG`, `REALTIME_CONFIG`, …). No inline literals for tunables.

### Tests
- **Test-first.** Every step's tests are written before its implementation.
- Tests live beside the code: `src/<feature>/**/*.test.ts`. Verification commands filter by directory: `npm test -- src/scoring`, never by a guessed filename.
- Integration tests hit the **real** test Postgres / Redis from docker-compose — not mocks. Use `createTestDb()` + `truncateAll(db)` in `beforeEach`. Test files run serially (`fileParallelism: false`) because they share that DB.
- Coverage threshold: 100% for `src/scoring/**`, `src/draft-engine/**` and `src/draft-room/state/**` (configured in `vitest.config.mts` with `coverage.include`, so unimported files count as 0%). Verify with an **unfiltered** `npm run test:coverage` — a path-filtered coverage run reports the other gated directories at 0%.
- Any step shipping a user-visible surface additionally requires: a design review against `docs/design-system.md`; loading/empty/error/success states all designed; an automated a11y check plus a keyboard-only walkthrough of the primary flow; a plain-language copy review; renders and operates at 360px width.

### Migrations
`ADD COLUMN … NOT NULL` without a `DEFAULT` is acceptable only while the table is empty (pre-first-deploy, as in `drizzle/0001`); once deployed, add with a DEFAULT or backfill in a separate migration.

### Commits
Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`). Commit after every completed step; commit bodies explain *why* and record any deviation from the plan.

### Environment
`.env.example` is committed; `.env.local` is gitignored. Required: `DATABASE_URL`, `REDIS_URL`, `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`, `NEXT_PUBLIC_WORKOS_REDIRECT_URI`; test-only: `TEST_DATABASE_URL`; optional: `ANTHROPIC_API_KEY`. Fail fast with a clear message when a required var is missing (see `db/client.ts`, `realtime/redis.ts`).

## Verification commands (every step)

```bash
npm run typecheck && npm run lint && npm test && npm run build
```
