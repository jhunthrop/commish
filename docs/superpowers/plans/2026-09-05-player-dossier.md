# Player Dossier (Peek + Full Page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The bottom-sheet player peek becomes the founder-approved dense dossier (call card, range rail, role, books, season strip, story, why) and the full player page becomes its uncapped sibling, both built from shared modules over the capsule engine's verified fact sheet.

**Architecture:** One new service seam exposes the per-player fact sheet (the same collectors capsules use) into `PlayerSeasonBody`; a family of small presentational modules in `src/league-room/dossier/` renders it; `player-peek.tsx` and the full page compose the same modules at two depths. Feed-dependent modules (news, injury story) render from the same body and light up as their tables fill — no placeholders, absence renders nothing.

**Tech Stack:** Next.js App Router, React, Drizzle, vitest, design tokens v5 (dark flagship, light same roles).

**Spec:** the approved mock (artifact "The New Player Peek", v2 dossier, 2026-09-05) + `docs/superpowers/specs/2026-09-04-draft-hq-design.md` §9 (capsules on player surfaces) + `docs/research/2026-09-05-availability-injury-type-preregistration.md` §UX rider (talent-vs-games sentence ships regardless of the model gate).

## Global Constraints

- No em-dashes, no semicolons in user-facing copy. No competitor names. UX explains itself, no tooltips.
- Honest data absolute: absence renders nothing or an honest sentence ("not tracked for him", "not posted yet"), never an invented or estimated number.
- EVERY displayed number names its basis: ranks carry "of {qualifierCount}", per-game values name their scoring basis, grades/projections name boardGeneration where shown. This is the fix for the live card's 12.0-vs-14.28 defect (two scoring bases, neither labeled).
- Color discipline: verdict channel (positive/negative) only on the call, accent only on "our number" and controls, magnitude channel for trend direction. Design guards (`src/design/*.source.test.ts`) bind.
- Immutability, files < 800 lines, functions < 50 lines, TDD per task, persona pass at the end.
- The peek stays fast: one request, no gateway calls at read time (the capsule is read from `player_capsules`).

## File map

- Modify: `src/league-service/player.ts` — `PlayerSeasonBody` gains `dossier: PlayerDossierFacts | null`
- Create: `src/league-service/dossier-facts.ts` (+test) — single-player fact assembly reusing the capsule collectors
- Create: `src/capsules/collect-one.ts` (+test) — narrowed single-player collector (also closes the flagged whole-board-read-per-peek performance debt)
- Create: `src/league-room/dossier/` — `call-card.tsx`, `range-rail.tsx`, `role-module.tsx`, `books-module.tsx`, `season-strip.tsx`, `story-module.tsx`, `why-groups.tsx` (+tests each)
- Modify: `src/league-room/components/player-peek.tsx` — compose the dossier
- Modify: `src/app/app/(shell)/leagues/[leagueId]/players/[playerId]/page.tsx` (+ its body component) — the uncapped composition
- Modify: `src/league-room/outlook/verdict.ts` consumers only as needed (verdict sentence feeds the call card unchanged)

---

### Task 1: The single-player collector

**Files:**
- Create: `src/capsules/collect-one.ts`
- Test: `src/capsules/collect-one.test.ts`

**Interfaces:**
- Consumes: the same queries `src/capsules/collect.ts` runs board-wide (board rows, props snapshot, vegas, usage facts, trends, season stories, news) — read its docblocks; every sub-query already exists.
- Produces: `collectPlayerFacts(db, playerId, asOf?): Promise<PlayerFacts | null>` returning exactly the `PlayerFacts` shape `buildPlayerFacts` yields for that player, `null` when the board never ranked him. MUST be row-scoped where the store allows (player-scoped WHERE clauses), falling back to the board-wide read only where no narrower query exists, with a docblock naming each remaining wide read.

- [ ] **Step 1: Failing test** — seeded fixture player: `collectPlayerFacts` equals the matching entry from `collectAllPlayerFacts` (deep-equal, factsHash included); unknown player returns null.
- [ ] **Step 2: red** (`npx vitest run src/capsules/collect-one.test.ts`)
- [ ] **Step 3: implement** (extract shared per-source helpers from collect.ts rather than duplicating queries — collect.ts keeps its tests green)
- [ ] **Step 4: green + `npx vitest run src/capsules`**
- [ ] **Step 5: commit** `feat(capsules): single-player fact collection, row-scoped`

### Task 2: Dossier facts on the player body

**Files:**
- Create: `src/league-service/dossier-facts.ts` + test
- Modify: `src/league-service/player.ts`

**Interfaces:**
- Consumes: Task 1's `collectPlayerFacts`; the existing body loaders in player.ts.
- Produces: `PlayerDossierFacts` — a serialization-safe projection of `PlayerFacts` for the client: `{ market, projection (incl. perGamePoints, perGamePositionRank + qualifierCount), availability, usage, trend, books, lastSeasonStory, injury, newsCount, basis: { boardGeneration, scoringLabel } }`. Derive `perGamePoints = projectedPoints / expectedGames` and rank it among the position's board players (one board read, reused from the collector's data). `PlayerSeasonBody.dossier` carries it; null when unranked.

- [ ] **Step 1: failing service test** — body carries dossier with per-game rank + qualifier count; unranked player gets null; every rank field carries its qualifier count.
- [ ] **Step 2-4: red, implement, green** (`npx vitest run src/league-service`)
- [ ] **Step 5: commit** `feat(dossier): the fact sheet rides the player body, per-game rank derived`

### Task 3: Call card + range rail modules

**Files:**
- Create: `src/league-room/dossier/call-card.tsx` + test, `src/league-room/dossier/range-rail.tsx` + test

**Interfaces:**
- Consumes: `verdictLine` (`src/league-room/outlook/verdict.ts`) for the big line; dossier market/projection/availability facts.
- Produces: `CallCard({ verdict, market, ourBoard, gap })` — verdict channel color by gap sign, three price columns with bases stated ("pick 24.3 · experts 23rd" / "WR24 · 54th overall · 197 pts" / "-20 points vs his price") plus the TALENT-VS-GAMES sentence from the pre-registration UX rider: "Per game he projects like a {POS}{perGameRank}. The question is games: our model expects {expectedGames}." — rendered only when both facts exist. `RangeRail({ projection, availability })` — the five-point rail (tails, band, median tick) with the expected-games chip; labels "an injury year" / "most seasons land in the band · {median} is our number" / "the smash case".

- [ ] **Step 1: failing component tests** — verdict color by sign, all bases printed, talent-vs-games sentence present/absent honestly, rail points positioned by value, copy rules asserted (no em-dash/semicolon)
- [ ] **Step 2-4: red, implement, green + `npx vitest run src/design`**
- [ ] **Step 5: commit** `feat(dossier): the call card and range rail, every number with its base`

### Task 4: Role, books, season strip, story modules

**Files:**
- Create: `src/league-room/dossier/role-module.tsx`, `books-module.tsx`, `season-strip.tsx`, `story-module.tsx` (+tests each)

**Interfaces (from the approved mock, binding):**
- `RoleModule({ usage, trend })`: share bars with "{pct}% · {POS}{rank} of {n}", absent shares say "not tracked for him"; trend line "18.1 a game in 2024 fell to 14.3 in 2025, down 3.8. A real move, not noise." only when `material`, magnitude-channel color on the delta.
- `BooksModule({ books })`: props chips via the existing `PROP_MARKET_LABELS` map (`src/capsules/render.ts` — import, don't duplicate), "{line} a game" phrasing; win total absent → "not posted yet"; ADP-trend slot renders only once `adp_snapshots` holds 3+ days for the player (sparkline; before that, nothing — the mock's explanatory sentence was mock-only).
- `SeasonStrip({ story, weeks, scoringLabel })`: five facts (games, finish of {n}, a game + basis, best week, rec yds rank), right-sized bar chart with flat ticks for missed weeks, season switcher preserved.
- `StoryModule({ seasonEnd, injury })`: renders `deriveSeasonEndingAbsence` output when present ("His {season} season ended after week {n}. The report said {primaryInjury}." + source line), current designation pill when the feed carries one; absent both → renders nothing. (Feed lands with the injuries branch; the module ships dark and lights up.)

- [ ] **Step 1: failing tests per module** incl. every absence path
- [ ] **Step 2-4: red, implement, green + design guards**
- [ ] **Step 5: commit** `feat(dossier): role, books, season and story modules, absence as absence`

### Task 5: Peek composition

**Files:**
- Modify: `src/league-room/components/player-peek.tsx` (+test)
- Modify: `src/league-room/outlook/outlook.tsx` only if the why-groups extraction (Task 6) requires a prop change

**Interfaces:** compose per the mock's order: header (unchanged identity + designation + bye moved up) → CallCard → grid(RangeRail | RoleModule) → grid(capsule read | BooksModule) → grid(SeasonStrip | StoryModule+news) → why groups → totals/log/news below the fold unchanged. Mobile stacks in that order. Loading and failure states preserved from the current peek.

- [ ] **Step 1: failing composition test** — module order, dossier-null falls back to today's layout (a player without board facts still gets season/log/news), mobile stack
- [ ] **Step 2-4: red, implement, green** (`npx vitest run src/league-room`)
- [ ] **Step 5: commit** `feat(dossier): the peek becomes the dossier`

### Task 6: The full page

**Files:**
- Modify: `src/app/app/(shell)/leagues/[leagueId]/players/[playerId]/page.tsx` + its body component (+tests)
- Create: `src/league-room/dossier/why-groups.tsx` (+test) — the Outlook's grouped evidence restyled as the mock's sentence groups, uncapped here, capped at five in the peek (replacing the peek's current `capped` Outlook usage)

**Interfaces:** the full page = the same modules, uncapped: full capsule Read (`bodyFull` from player_capsules) instead of compact; every why group; all seasons' strips via the switcher; the complete game log; league-scoring section — the existing league-scored totals/log KEEP their place with the basis labeled "under this league's scoring", beside the dossier facts labeled with the board basis. Both bases named wherever both appear (the 12.0/14.28 fix made visible).

- [ ] **Step 1: failing page tests** — full Read rendered when stored, both scoring bases labeled, why groups uncapped, peek still capped
- [ ] **Step 2-4: red, implement, green**
- [ ] **Step 5: commit** `feat(dossier): the full page, uncapped, both bases named`

### Task 7: Gates, personas, e2e-lite

- [ ] **Step 1:** full sweep `npx vitest run src/league-room src/league-service src/capsules src/design`, `npx tsc --noEmit`, `npx eslint src/league-room src/league-service src/capsules`
- [ ] **Step 2:** one targeted Playwright spec: open a peek from league players, assert call card + rail + role render with real seeded data, open full page, assert full Read + both bases (follow existing league-room e2e patterns; targeted spec only)
- [ ] **Step 3:** persona pass recorded in the report (veteran: bases and log; casual: verdict first; commissioner: unchanged depth; first-timer: no unexplained numbers)
- [ ] **Step 4: commit** `feat(dossier): gates and persona pass`

---

## Self-review notes

- Mock coverage: every v2 module has a task (call/rail T3, role/books/season/story T4, read T5/T6 via stored capsule, why T6). ADP sparkline honestly gated on real snapshot depth. Talent-vs-games rider T3, basis-naming law in Global Constraints and T6.
- Types consistent: `PlayerDossierFacts` named once (T2), consumed T3-T6. `collectPlayerFacts` (T1) feeds T2 only.
- Dependencies: T1→T2→(T3,T4 parallel-safe but dispatched sequentially)→T5→T6→T7.
- No placeholders; feed-dependent modules ship dark by design, which is behavior, not TODO.
