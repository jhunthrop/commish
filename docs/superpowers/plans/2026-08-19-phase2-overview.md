# Phase 2 — Plan split

**Spec:** `plans/phase-2-accounts-and-data-foundation.md` (17 steps)
**Roadmap:** `plans/00-roadmap.md`
**Written:** 2026-08-19, immediately after Phase 1 closed (all six plans A–F merged to `main`, 1308 tests, e2e 5/5 twice).

This file does one job: it says which of Phase 2's 17 steps land in which plan, and it names, per plan, the real-world resources the founder has to supply before that plan can start. It is not itself an implementation plan. Each plan gets its own file written in full writing-plans discipline when its turn comes.

---

## First: three of the 17 steps are already done

The Phase 2 spec was drafted against a Phase 1 that had not been built yet. Phase 1 as actually built overshot the spec's assumptions in three places, and the plan split has to say so out loud rather than quietly re-doing work or quietly skipping it.

| Spec step | Status | Evidence in the codebase today |
|---|---|---|
| **Step 1 — Postgres migration & persistence hardening** | **Done.** SQLite was never shipped. | `docs/conventions.md` pins "Postgres 17 via Drizzle ORM (`drizzle-orm/postgres-js`, `postgres` driver)" and records *why* SQLite was dropped. `src/db/schema.ts` is `pg-core` throughout; `docker-compose.yml` runs `postgres:17-alpine` for dev (5432) and a tmpfs `postgres-test` (5433); `drizzle/0000`–`0010` are committed Postgres migrations; every persistence test already runs against the real dockerized Postgres via `createTestDb()`. There is no `scripts/migrate-sqlite-to-postgres.ts` to write because there is no SQLite data to migrate. **Residual carried into Plan A:** the spec's own "connection pooling sized conservatively for now — this is a placeholder" task. `src/db/config.ts` hardcodes `defaultMaxConnections: 10` with no documented methodology. Plan A's PgBouncer task replaces it. |
| **Step 4 — User accounts, authentication & sessions** | **Done, by a different and better route.** | The spec proposes hand-rolling email+password with argon2id, a `Session` table, and `getCurrentUser()`. What shipped is **WorkOS AuthKit** (`@workos-inc/authkit-nextjs`) behind exactly the `getCurrentUser()` / `requireCurrentUser()` seam the spec asked for (`src/lib/auth/current-user.ts`), with `users.id` **being** the WorkOS user id and `src/middleware.ts` redirecting pages but never redirecting API/SSE routes. Founder memory is explicit: *"Auth is WorkOS — never roll our own authn/authz."* **Consequence for Step 2:** the spec's index list names `Session(token)` and `Session(userId)`. There is no `sessions` table and there will not be one. Those two indexes are struck, with the reason recorded, not silently dropped. |
| **Step 5 — Retrofit authenticated identity through league / team / draft / chat** | **Done.** | `teams.user_id` is a NOT NULL FK to `users` with a unique `(league_id, user_id)`. `src/lib/leagues/membership.ts` is the one auth+membership gate every `/api/leagues/**` route goes through. `docs/conventions.md`: *"`teamId` is always resolved from the authenticated session, never from a request body."* Chat sender identity comes from the validated session (`src/chat-service/chat.ts`). The Playwright suite drives two separately-authenticated WorkOS contexts. |

Nothing in the remaining 14 steps is skipped. The steps that *look* partly done (Step 6's `StatsProvider` interface exists; Step 12's rate limiter has a first instance in `src/lib/api/rate-limit.ts`) are called out inside the plan that finishes them.

---

## The split

Four sequential plans. The ordering rule is **founder-gate last**: everything buildable with nothing but this laptop and Docker comes first, so the build loop never stalls waiting on an account signup.

### Plan A — Data foundation & the stats-provider seam
**File:** `docs/superpowers/plans/2026-08-19-phase2-plan-a-data-foundation.md`
**Spec steps:** **2** (data-layer hardening: indexes, balance-rollup convention, per-draft locking, PgBouncer) and **6** (stats-data provider adapter interface), plus the **Phase 1 residual hygiene backlog** ledgered at the end of `.superpowers/sdd/2026-08-18-phase1-plan-f-matchmaking-and-e2e/progress.md`: browse filters pushed into SQL, the `src/**` → `scripts/**` layering escape, missing `error.tsx` / `not-found.tsx`, and the `useLeagueChat` resync flake.
**Prerequisites:** **none.** Docker Compose gains a `pgbouncer` service; the Tank01 adapter is built and tested against committed fixtures, so no API key is needed to write it, review it, or merge it.
**Explicitly deferred out of this plan:** the founder's Tank01/RapidAPI key. The adapter is written so that supplying `TANK01_API_KEY` and setting `STATS_PROVIDER=tank01` activates it with no code change, and `scripts/record-tank01-fixtures.ts` re-records the committed fixtures from the live API on the first run that has a key.

### Plan B — Live-scoring ingestion, caching & the cross-league home
**Spec steps:** **7** (ingestion worker, delta diff, inverted `playerId → rosters` index, `score.update` fan-out, Redis computed-score cache, cache-outage degradation) and **8** (multi-league `/dashboard`).
**Prerequisites:** **none.** Step 7 runs entirely against Plan A's provider seam plus the local Postgres/Redis already in `docker-compose.yml`. Step 8 is a Next.js route over data that already exists.
**Depends on Plan A for:** the `StatsProvider` registry (Step 7 polls through it), the indexes and the rollup convention (the spec makes Step 8's cross-league query the worked example of that convention), and the per-draft lock (the ingestion worker is the second writer that makes multi-writer safety load-bearing).

### Plan C — Onboarding, identity and the trust surfaces
**Spec steps:** **14** (first-run onboarding fork + one-time draft-room tour), **17** (unfiltered review feed), **15** *(preset avatars only — the `avatarUrl` column already exists on `users`; render the chosen avatar across dashboard, draft seats, chat, standings and the review feed)*, **16** *(the `GifProvider` adapter seam and its unconfigured-degrade path only)*.
**Prerequisites:** **none for the scope listed above.** Every surface is a persona-panel surface, so this plan carries four panel passes.
**Carved out to Plan D, with the resource each one needs named:** Step 15's **custom avatar upload** needs an object store (S3 / Cloudflare R2 / equivalent bucket + credentials). Step 16's **GIF search** needs a Giphy or Tenor API key; Step 16's **voice messages** need the same object store plus the CDN in front of it.

### Plan D — Deploy, observe, harden, prove
**Spec steps:** **3** (backups, PITR, DR runbook + executed drill), **9** (hosting), **10** (observability), **11** (auth/session security hardening), **12** (deployment hardening: SIGTERM, split liveness/readiness, CDN, general rate limiting), **13** (load testing: the four named Sunday-concurrency scenarios) — plus Plan C's two carve-outs and the activation of Plan A's Tank01 adapter against the live API.
**Prerequisites — every one of these is a founder action, not a coding task:**

| Resource | Which step needs it | Why it cannot be faked locally |
|---|---|---|
| Fly.io (or equivalent) account with a payment method | 9 | Step 9's exit criterion is "reachable at a real public URL, not just localhost". |
| Managed Postgres with WAL archiving / PITR enabled | 3 | The exit criterion is an **executed** restore drill with a measured RTO. A `pgBackRest` drill against a laptop container measures the laptop, not the RPO/RTO the product will actually have. |
| Managed Redis with AOF persistence | 3, 9 | Step 3 decides Redis's persistence policy for the *production* instance; Step 9 provisions it to match. |
| Sentry (or equivalent) DSN | 10 | Error tracking is externally hosted by definition. |
| An external uptime monitor | 10 | "Polling `/api/health` **from outside** the deployed environment" is the whole point. |
| A CDN in front of static assets | 12 | Exit criterion is verifying CDN response headers against the deployed URL. |
| Object-store bucket + credentials | 12 (CDN target), 15 (avatar upload), 16 (voice) | Uploaded media must not live on the app server. |
| Giphy **or** Tenor API key | 16 | The `GifProvider` seam ships unconfigured in Plan C and degrades to text-only; a key is what turns the picker on. |
| RapidAPI / Tank01 key | activation of Plan A's adapter | Plan A proves the mapping against fixtures. Only a key proves the fixtures match today's live payloads. |
| A staging environment k6 can point at | 13 | "Run each scenario against a staging-equivalent environment (Step 9's deployed infra, **not localhost**)". |

**Ordering note the spec is explicit about:** Step 13 is the one true joining point of Phase 2 — it needs 2, 3, 7, 9, 10 and 12 all done. Nothing above it counts as "Sunday-ready" until it passes. And Step 3 must land **before Phase 4 introduces real money**, which is why it sits in this plan rather than being pushed into Phase 8.

---

## Cross-plan dependency graph

```
Phase 1 (complete)
   │
   ├─→ Plan A  (Steps 2, 6 + Phase 1 hygiene)      no founder resources
   │       │
   │       ├─→ Plan B  (Steps 7, 8)                no founder resources
   │       │
   │       └─→ Plan C  (Steps 14, 17, 15a, 16a)    no founder resources
   │               │      (Plan C's Step 14 links the dashboard Plan B builds,
   │               │       so Plan C follows Plan B rather than racing it)
   │               │
   └───────────────┴─→ Plan D (Steps 3, 9, 10, 11, 12, 13 + 15b, 16b)
                                                    FOUNDER-GATED — see the table above
```

Plans B and C touch disjoint files and could run in parallel worktrees if the loop wants speed, with one caveat: Plan C's onboarding fork (Step 14) extends the zero-leagues empty state of the `/dashboard` Plan B builds (Step 8). Running them concurrently means Plan C owns that empty state and Plan B must not also design it. Sequential is the safer default.

## Founder rules binding all four plans

- **No MVP.** End-state choices from day one. Phases sequence scope, not quality.
- **No em-dashes in user-facing copy.** Not in component text, not in error strings, not in seed data. Source comments may use them; the codebase already does.
- **Persona-panel pass on every new user-facing surface**, marked as an explicit step in the plan that ships it.
- **Centralized primitives always.** No raw hex, no raw px, no one-off component that duplicates something in `src/components/ui/`.
