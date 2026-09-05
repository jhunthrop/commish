# Draft HQ Phase 3 — The Room (Assistant, Beats, Grades, Debrief) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The live draft room gains an Assistant that argues (the call with make-it-back odds simmed from THIS room, run detection, tier countdowns, bye collisions, stack suggestions, a reach guard), a post-pick beat, and every completed draft gets cited-component grades — room-wide on league home for real leagues, private-to-the-manager in the mock debrief.

**Architecture:** The Assistant is a Quilt drawer tab (the snake room deliberately has no right rail — the Quilt's tab machinery is the native mount). Heavy derivations (the call: `recommendPick` + a micro-sim continuation of the live `DraftState`) compute server-side behind one membership-guarded API route, refetched on `draft.pick` SSE events; light derivations (runs, tier countdowns, byes, reach guard) are pure client modules over `RoomState` data the room already holds. Grades are a pure engine invoked two ways: a job hooked at the draft-completion post-commit block writes `draft_grades` rows for real drafts, and the mock debrief computes the manager's own grade at read time (mocks are retention-swept, nothing stored).

**Tech Stack:** Next.js App Router, TypeScript strict, Drizzle/Postgres, vitest, the owned Postgres job system, the existing draft engine and sim service.

**Spec:** `docs/superpowers/specs/2026-09-04-draft-hq-design.md` (§6 Assistant, §9 grades, §13 phase 3). Ruling 2 (§15) moves auction Simulator + auction Assistant into phase 3 — that is a SEPARATE follow-on plan (`draft-hq-auction`), not this one; this plan is the snake room. Ruling 3: grades league-visible by default with per-league opt-out; mock grades private to the manager always.

## Global Constraints

- No em-dashes and no semicolons in any user-facing copy (validator-enforced in capsules; manual here). No competitor names in product copy.
- Honest data absolute: never fabricate a number. Every displayed number traces to a law, the availability model, a sim distribution, or a real market snapshot. Missing data degrades with honest copy, never interpolation.
- The assistant never auto-acts; it argues. Autopick remains the separate existing system (spec §6 last line).
- Sim determinism: every sim number reproducible from `{config, seed}` alone; no `Date.now()` inside sim paths (`SIM_INSTANT` pattern in `src/draft-service/sim/run.ts`).
- New background work registers a job in the owned job system, never cron/setInterval (memory: job-system-owned-postgres).
- Immutability, files < 800 lines, functions < 50 lines, explicit error handling, TDD per task.
- Design guards (`src/design/*.source.test.ts`) bind all UI work; run them in every task that touches components.
- 2026 season data stays held out of every fit; sims run on the evidence board (already governed).

## Plan-level rulings (recorded so the build runs unattended)

- **R-1 (make-it-back is a micro-sim):** spec §6 mandates odds "simmed live from THIS room's actual picks so far (a background micro-sim, not a stale ADP table)". The closed-form `survivalProbabilities` (`src/projections/decide/survival.ts`) self-describes its noise constants as "honest guesses, not measurements" — the micro-sim continuation over the real `DraftState` with the real bot sampler is the honest instrument. `recommendPick` keeps its internal closed-form ordering; the DISPLAYED odds come from the micro-sim.
- **R-2 (mock letter grades):** `src/draft-room/components/mock-results.tsx` carries a docblock "No letter grade, ever" from the 2026-08-26 mock-results pass. Spec §9 (2026-09-04, founder-ruled) is newer and mandates grades after any draft, mock included, private to the manager. The original objection was an uncited letter; the new grade cites its components on the same card, which answers it. The docblock is amended in Task 11 to record this supersession explicitly.
- **R-3 (asking-seat convention in continuation runs):** each continuation run has the asking seat pick its best available EXCLUDING the measured shortlist, so every shortlist candidate's survival to the next turn answers exactly "if you pass on him now, is he there when you are back". Deterministic, well-defined denominators.
- **R-4 (grade board basis):** grades use the evidence pool current at computation time and stamp its `boardGeneration` on the row. The card's fine print names the basis. An after-the-fact board change never rewrites a stored grade.

## File map

- Create: `src/draft-service/sim/continue.ts` (+test) — continuation runner over a live `DraftState`
- Create: `src/draft-service/sim/make-it-back.ts` (+test) — shortlist survival odds from N continuations
- Create: `src/draft-service/assistant/call.ts` (+test) — the call payload (recommendations + odds + winning shapes)
- Create: `src/app/api/drafts/[draftId]/assistant/route.ts` — membership-guarded GET
- Create: `src/draft-room/assistant/reads.ts` (+test) — run detection, tier-break countdown (pure, client)
- Create: `src/draft-room/assistant/roster-fit.ts` (+test) — bye collisions, stack note, reach guard (pure, client)
- Create: `src/draft-room/assistant/beat.ts` (+test) — post-pick beat derivation (pure)
- Create: `src/draft-room/quilt/components/drawer-assistant-tab.tsx` (+test) — the tab body
- Create: `src/draft-room/assistant/use-assistant.ts` — fetch/refetch hook keyed to pick events
- Create: `src/draft-service/grades/engine.ts` (+test) — pure grade computation
- Create: `src/jobs/defs/draft-grades-job.ts` (+test) — computes + stores grades for a completed real draft
- Create: `src/league-room/components/grade-board.tsx` (+test) — league home card
- Modify: `src/draft-service/sim/run.ts` — extract the drive loop `continue.ts` shares
- Modify: `src/draft-room/quilt/state/collapse.ts` (`DRAWER_TABS`), `quilt/components/drawer-handles.tsx` (`TAB_LABEL`), `quilt/components/pool-drawer.tsx` (dispatch), `quilt/components/mobile-room.tsx` (`MOBILE_TABS`)
- Modify: `src/draft-service/store.ts` (post-commit block ~:600) — enqueue grades job
- Modify: `src/db/schema.ts` + new migration — `draft_grades` table, `leagues.draft_grades_visible`
- Modify: `src/integrity/notices.ts` + `src/integrity/test-support.ts` — `draft_grades_ready` notice
- Modify: `src/mock-draft-service/debrief.ts` + `src/draft-room/components/mock-results.tsx` — your-grade card
- Modify: `src/app/app/(shell)/draft/assistant/page.tsx` — replayed-room demo replaces arriving-soon

---

### Task 1: Sim continuation seam

**Files:**
- Create: `src/draft-service/sim/continue.ts`
- Test: `src/draft-service/sim/continue.test.ts`
- Modify: `src/draft-service/sim/run.ts` (export the bot-drive step it already contains)

**Interfaces:**
- Consumes: `admitCommand`, `reduceDraft`, `teamOnClock`, `isComplete` from `@/draft-engine`; `assignArchetypes` (`@/mock-draft/archetypes`), `chooseBotPick` (`@/mock-draft/bots`), `rngFor` (`@/mock-draft/rng`); `SIM_INSTANT` and the `submit` helper pattern from `run.ts`.
- Produces: `continueDraft(input: ContinueDraftInput): ContinueDraftResult` where

```typescript
export interface ContinueDraftInput {
  /** A live snake DraftState mid-draft — the room's replayed state, never re-fetched here. */
  readonly state: DraftState;
  /** The seat asking. Continuation stops the moment this seat is back on the clock (or the draft completes). */
  readonly askingTeamId: string;
  /** Players the asking seat must NOT take in this run (ruling R-3). */
  readonly excludeFromAskingSeat: ReadonlySet<string>;
  readonly seed: number;
}
export interface ContinueDraftResult {
  /** Player ids still undrafted when the asking seat came back on the clock. */
  readonly undrafted: ReadonlySet<string>;
  /** True when the draft completed before the asking seat's next turn (no next pick exists). */
  readonly draftEnded: boolean;
}
```

Behavior: while not complete and `teamOnClock(state) !== askingTeamId` (after at least one advance when the asking seat is currently on the clock — the asking seat's own current pick is played first, from the board minus `excludeFromAskingSeat`, using `bestAvailableFor` semantics via `chooseBotPick` with a fixed neutral archetype), submit `MAKE_PICK` for the seat on the clock via `chooseBotPick` with archetypes dealt by `assignArchetypes(seed, teamIds)` and per-pick `rngFor(seed, `${teamId}:cont:${pickNumber}`)`. Timestamps are `SIM_INSTANT`. Never mutate the caller's state (the reducer already returns new state).

- [ ] **Step 1: Write the failing test** (`continue.test.ts`): build a 4-team, 3-round live state by replaying 5 picks through the real engine (reuse the state-building helper pattern from `run.test.ts`), then:

```typescript
it("continues a live state to the asking seat's next turn, deterministically per seed", () => {
  const a = continueDraft({ state, askingTeamId: "t2", excludeFromAskingSeat: new Set(["p9"]), seed: 7 });
  const b = continueDraft({ state, askingTeamId: "t2", excludeFromAskingSeat: new Set(["p9"]), seed: 7 });
  expect(a.undrafted).toEqual(b.undrafted);
  expect(a.undrafted.has("p9") || a.draftEnded || !poolIds.has("p9")).toBe(true); // excluded player was never taken by t2's own current pick
});
it("stops with draftEnded when no next turn exists", () => { /* state at the final round's last picks */ });
it("never submits a command the engine refuses", () => { /* same regression guard as run.test.ts */ });
```

- [ ] **Step 2: Run it, watch it fail** (`npx vitest run src/draft-service/sim/continue.test.ts`)
- [ ] **Step 3: Implement `continue.ts`** (share `submit` by exporting it from `run.ts` or duplicating the 6-line helper with a pointer comment — exporting is preferred, DRY)
- [ ] **Step 4: Tests pass, plus `npx vitest run src/draft-service/sim` all green**
- [ ] **Step 5: Commit** `feat(sim): continueDraft drives a live state to a seat's next turn`

### Task 2: Make-it-back odds

**Files:**
- Create: `src/draft-service/sim/make-it-back.ts`
- Test: `src/draft-service/sim/make-it-back.test.ts`

**Interfaces:**
- Consumes: `continueDraft` (Task 1).
- Produces:

```typescript
export const MAKE_IT_BACK_RUNS = 200; // measured cheap: a continuation is <2 rounds of picks
export interface MakeItBackInput {
  readonly state: DraftState;
  readonly askingTeamId: string;
  readonly shortlistIds: readonly string[];
  readonly seed: number;
  readonly runs?: number; // default MAKE_IT_BACK_RUNS
}
export interface MakeItBackOdds {
  readonly playerId: string;
  /** Fraction of runs where he was still undrafted at your next turn — null when the draft ends first. */
  readonly survival: number | null;
  readonly runs: number;
}
export function makeItBackOdds(input: MakeItBackInput): readonly MakeItBackOdds[];
```

Each run uses `seed + runIndex` and `excludeFromAskingSeat = new Set(shortlistIds)` (ruling R-3). Runs where `draftEnded` count toward a separate tally: when EVERY run ends the draft, survival is `null` (no next pick exists — the "no_further_turn" case).

- [ ] **Step 1: Failing test**: seeded state where a shortlist player is board-top for other seats (low survival expected) vs a deep-board player (high survival); assert `survival` in [0,1], reproducibility across two identical calls, `null` at the draft's tail, and `runs` echoed.
- [ ] **Step 2: Fail run**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Pass + suite green**
- [ ] **Step 5: Commit** `feat(sim): make-it-back odds from live-room micro-sims`

### Task 3: The call service + API route

**Files:**
- Create: `src/draft-service/assistant/call.ts`
- Create: `src/app/api/drafts/[draftId]/assistant/route.ts`
- Test: `src/draft-service/assistant/call.test.ts`

**Interfaces:**
- Consumes: `recommendPick`, `Recommendation`, `PickReason` (`@/projections/decide/draft`); `makeItBackOdds` (Task 2); `evidencePoolFor` (`sim/evidence.ts`); the draft-service store's state read (same seam the room GET route uses — follow `src/app/api/drafts/[draftId]/route.ts` for the membership guard and state load); `findCachedRun` + `StoredSimSummary` (`sim/store.ts`) for winning shapes; `classifyBuild` (`sim/classify.ts`).
- Produces:

```typescript
export interface AssistantCandidate {
  readonly playerId: string;
  readonly position: Position;
  readonly reasons: readonly PickReason[];       // rendered to sentences client-side
  readonly makeItBack: MakeItBackOdds | null;     // null when he IS your forced last pick
}
export interface AssistantCallView {
  readonly pickNumber: number;                    // the pick this call was computed at
  readonly onTheClock: boolean;                   // asking seat is up now
  readonly candidates: readonly AssistantCandidate[]; // top 3
  readonly yourBuild: readonly BuildLabel[];      // classifyBuild over your picks so far
  readonly winningBuilds: readonly BuildOutcome[] | null; // from your cached league sim, null when none exists
  readonly computedBasis: string;                 // boardGeneration, for the fine print
}
export async function assistantCall(db: Db, draftId: string, userId: string): Promise<AssistantCallView | null>; // null: not a member / no seat / draft not in progress
```

Seed = a stable hash of `${draftId}:${pickNumber}` (reuse the config-hash helper style from `sim/store.ts`) — same pick, same odds, no flicker on refetch. Mapping: `evidencePoolFor` supplies `SimPlayerEvidence` rows; build `DraftCandidate`s (`valueOverReplacement` via the same valuation path `recommendPick`'s callers use — follow `src/projections/decide/replacement.ts` `LeagueShape` construction from the league's roster config, exactly as `src/draft-hq/board/service.ts` builds it). Roster = your committed picks so far with their `valueOverReplacement`. Top 3 of `recommendPick(...)`, then `makeItBackOdds` once for those 3.

Route: `GET /api/drafts/[draftId]/assistant` — standard envelope, 403 non-member, 200 `{ ok: true, data: AssistantCallView }`. Force-dynamic.

- [ ] **Step 1: Failing service test** (in-memory db harness the sim service tests already use): seeded league + live draft, assert 3 candidates ordered by `expectedValueAdded`, every candidate carries reasons and odds, determinism across two calls at the same pick, `null` for a non-member.
- [ ] **Step 2: Fail run**
- [ ] **Step 3: Implement service + route**
- [ ] **Step 4: Pass + `npx vitest run src/draft-service` green**
- [ ] **Step 5: Commit** `feat(assistant): the call — top three with reasons and live make-it-back odds`

### Task 4: Room reads (runs, tier countdowns)

**Files:**
- Create: `src/draft-room/assistant/reads.ts`
- Test: `src/draft-room/assistant/reads.test.ts`

**Interfaces:**
- Consumes: the room view's completed picks (`RoomState.view.picks` shape — see `src/draft-room/state/apply-event.ts`), `reasons: ReadonlyMap<string, BoardReason[]>` (already in `RoomState`), positions from `playersById`.
- Produces:

```typescript
export const RUN_WINDOW = 7;
export const RUN_THRESHOLD = 5;
export interface PositionRun { readonly position: Position; readonly count: number; readonly window: number; }
export function detectRun(recentPositions: readonly Position[]): PositionRun | null; // last RUN_WINDOW picks, >= RUN_THRESHOLD same position
export interface TierCountdown { readonly position: Position; readonly playersLeftInTier: number; readonly dropToNextTier: number; }
export function tierCountdowns(undraftedIds: readonly string[], reasons: ReadonlyMap<string, BoardReason[]>): readonly TierCountdown[];
// one row per position, from the best undrafted player's tier_cliff reason where present
```

- [ ] **Step 1: Failing tests**: 5-of-7 RB window detects, 4-of-7 does not, window shorter than 7 early in the draft uses actual length and never fires below threshold; tier countdown reads `tier_cliff` reasons and skips positions without one (absence is absence, never a made-up number).
- [ ] **Step 2-4: red, implement, green**
- [ ] **Step 5: Commit** `feat(assistant): run detection and tier-break countdowns from room data`

### Task 5: Roster fit (byes, stacks, reach guard)

**Files:**
- Create: `src/draft-room/assistant/roster-fit.ts`
- Test: `src/draft-room/assistant/roster-fit.test.ts`

**Interfaces:**
- Consumes: `byeWeeks` map from `RoomState`; your roster picks; `laws` from `RoomState` (stack suggestions only where a law supports the correlation — if no stacking law exists in the room payload, the stack note renders NOTHING, honest absence); `survivalProbability` (`@/projections/decide/survival`, pure, imported client-side) for the reach guard's fallback wording when the hovered player is outside the call's shortlist.
- Produces:

```typescript
export interface ByeCollision { readonly week: number; readonly count: number; readonly wouldMake: number; } // "he'd make it four"
export function byeCollisionFor(candidateId: string, byeWeeks: ReadonlyMap<string, number>, rosterIds: readonly string[]): ByeCollision | null;
export interface ReachInput { readonly candidateAdp: number | null; readonly currentPick: number; readonly makeItBack: number | null; }
export function reachSentence(input: ReachInput): string | null; // null unless ADP is >= REACH_THRESHOLD_PICKS past current pick
export const REACH_THRESHOLD_PICKS = 12;
```

Reach copy pattern (no em-dash, no semicolon): `"The market has him going about ${n} picks from now. Our sims make it ${odds} he is still here at your next turn."` — omit the second sentence entirely when odds are unknown, never estimate inline.

- [ ] **Step 1: Failing tests** for each function incl. the null/absence paths
- [ ] **Step 2-4: red, implement, green**
- [ ] **Step 5: Commit** `feat(assistant): bye collisions, law-gated stack notes, the quiet reach guard`

### Task 6: The Assistant drawer tab

**Files:**
- Create: `src/draft-room/quilt/components/drawer-assistant-tab.tsx`
- Create: `src/draft-room/assistant/use-assistant.ts`
- Test: `src/draft-room/quilt/components/drawer-assistant-tab.test.tsx`
- Modify: `src/draft-room/quilt/state/collapse.ts` (`DRAWER_TABS` gains `"assistant"`), `src/draft-room/quilt/components/drawer-handles.tsx` (`TAB_LABEL.assistant = "Assistant"`), `src/draft-room/quilt/components/pool-drawer.tsx` (dispatch branch), `src/draft-room/quilt/components/mobile-room.tsx` (`MOBILE_TABS` + label)

**Interfaces:**
- Consumes: Tasks 3-5. `useAssistant(draftId, pickNumber, myTeamId)` fetches `/api/drafts/[draftId]/assistant` via the room's `fetchJson` dep (`src/draft-room/hooks/deps.tsx`), refetches when `pickNumber` changes (the SSE fold already advances it), keeps the PREVIOUS call while loading (no spinner flash mid-room). Mock rooms use the same route (mock drafts hit the same draft-service store).
- Produces: the tab body — the call (three rows: name, reason sentences from `PickReason` rendered by a `reasonSentence(reason): string` helper in the component file, make-it-back line), then run/tier strip (Task 4), bye/stack note on the focused candidate (Task 5). Copy rules bind. Commissioner (no seat) sees the honest line "You have no seat in this draft. The assistant argues for a seat."

- [ ] **Step 1: Failing component test** (testing-library, mock `useAssistant`): renders three candidates with odds sentences ("about 3 in 4" style — round to quarters via a tested `oddsPhrase(survival): string`), renders run alert when present, renders nothing where data is absent, mock room renders identically, no-seat copy for commissioner.
- [ ] **Step 2-4: red, implement, green** — include `npx vitest run src/design` (guards) and the collapse-state tests (`quilt/state/collapse.test.ts` updated for the new tab).
- [ ] **Step 5: Commit** `feat(assistant): the Assistant tab lands in the quilt, desktop and phone`

### Task 7: Post-pick beat

**Files:**
- Create: `src/draft-room/assistant/beat.ts`
- Test: `src/draft-room/assistant/beat.test.ts`
- Modify: `src/draft-room/quilt/components/drawer-assistant-tab.tsx` (beat line at top after your pick), `src/draft-room/assistant/use-assistant.ts` (capture the pre-pick call)

**Interfaces:**

```typescript
export interface BeatInput {
  readonly pickedPlayerId: string;
  readonly prePickCall: AssistantCallView;      // the call captured at your pick
  readonly playerName: (id: string) => string;
}
export function postPickBeat(input: BeatInput): string | null;
// "Best available." when picked == candidates[0]
// "Our board had ${name} first. ${oddsPhrase} he is still there at your next turn." when passed-on top candidate has odds
// null when the pre-pick call never loaded (absence, not invention)
```

- [ ] **Step 1: Failing tests** covering all three branches + copy rules (no em-dash/semicolon assertion on output)
- [ ] **Step 2-4: red, implement, green**
- [ ] **Step 5: Commit** `feat(assistant): the post-pick beat, one honest line after your pick`

### Task 8: Grades engine (pure)

**Files:**
- Create: `src/draft-service/grades/engine.ts`
- Test: `src/draft-service/grades/engine.test.ts`

**Interfaces:**
- Consumes: `bestStartingLineupPoints` (`sim/lineup-score.ts`), `boardRanks`/pick-delta idea from `src/draft-room/state/pick-review.ts` (import, don't duplicate), `byeStackWeek` (`src/draft-room/state/debrief.ts`).
- Produces:

```typescript
export interface GradeComponents {
  readonly valueCaptured: number;        // sum over your picks of (pick's board value minus best-available board value at that pick), <= 0 is honest
  readonly startingSlotsFilled: number;  // of startable slots
  readonly startingSlotsTotal: number;
  readonly byeCollisions: number;        // weeks with 3+ shared starters' byes
  readonly projectedPoints: number;      // bestStartingLineupPoints under league slots
}
export interface TeamGrade {
  readonly teamId: string;
  readonly letter: "A" | "B" | "C" | "D";
  readonly components: GradeComponents;
  readonly projectedRank: number;        // 1-based by projectedPoints within the room
}
export function gradeDraft(input: { picks, rosters, slotConfig, pointsByPlayerId, valueByPlayerId, byeWeeks }): readonly TeamGrade[];
```

Letter mapping: quartile of `valueCaptured` within THIS room (A = top quartile ... D = bottom), tie-broken by projectedPoints — a room-relative, component-cited claim, never a universal judgment. No F: the copy law is honest, not cruel, and the bottom quartile is already named D.

- [ ] **Step 1: Failing tests**: 4-team fixture with hand-computable values, quartile letters, projected rank ordering, a team that punted value grades D with negative `valueCaptured` shown as-is, determinism.
- [ ] **Step 2-4: red, implement, green**
- [ ] **Step 5: Commit** `feat(grades): the pure grade engine, room-relative letters with cited components`

### Task 9: Grades storage, job, completion hook, notice

**Files:**
- Modify: `src/db/schema.ts` (+ `drizzle` migration): `draft_grades` (id, draftId FK, leagueId, teamId, letter, components jsonb, projectedRank int, boardGeneration text, computedAt) unique on (draftId, teamId); `leagues.draftGradesVisible boolean notnull default true`
- Create: `src/jobs/defs/draft-grades-job.ts` (+test) — payload `{draftId}`, one step: load committed picks/rosters, `evidencePoolFor`, run `gradeDraft`, upsert rows (idempotent re-run safe)
- Modify: `src/jobs/registry.ts` (register)
- Modify: `src/draft-service/store.ts` post-commit block (~:600, beside `sweepQuietly`): `enqueueJob` for real (non-mock) completions
- Modify: `src/integrity/notices.ts` + `src/integrity/test-support.ts`: notice type `draft_grades_ready` (context `{leagueName}`, body "Draft grades are up on your league home. Every grade shows its work.") sent to each seated member by the job, respecting `draftGradesVisible`

**Interfaces:** job name `DRAFT_GRADES_JOB_NAME = "draft-grades"`; follows `defs/sim-job.ts` shape exactly (terminal vs retryable split).

- [ ] **Step 1: Failing job test** (pattern: `defs/capsule-sweep-job.test.ts` harness): completed seeded draft → rows written with letters + boardGeneration, re-run idempotent, mock draft never enqueued (assert at the store hook test level: `src/draft-service/store` completion tests extended), opt-out league writes rows but sends no notices
- [ ] **Step 2-4: red, implement (schema + migration first), green** — run the full `src/jobs` suite
- [ ] **Step 5: Commit** `feat(grades): draft_grades written by a job at completion, notice respects the league toggle`

### Task 10: League home grade board + settings toggle

**Files:**
- Create: `src/league-room/components/grade-board.tsx`
- Test: `src/league-room/components/grade-board.test.tsx`
- Modify: `src/app/app/(shell)/leagues/[leagueId]/room-data.ts` (load grades when present + visible), the stage that renders cards (`src/league-room/components/room-stage-attention.tsx` deck or `room-stage-live.tsx` — match whichever the league's post-draft state renders; the implementer verifies with the room-shell tests), league settings surface (find the commissioner settings component via `rg "draftGradesVisible|league settings" src/league-room src/league-service`) + `src/league-service` write path for the toggle

**Interfaces:** `GradeBoard({ grades: readonly TeamGrade[] & {teamName}, basis: string })` — a dense table (letter, team, value captured, projected finish), fine print naming the basis ("graded against our board of {basis}"), every letter expandable to its components. Hidden entirely when `draftGradesVisible` is false or no rows exist.

- [ ] **Step 1: Failing component test**: renders rows sorted by projectedRank, expandable components, absent when empty, toggle-off renders nothing; settings test asserts commissioner-only write.
- [ ] **Step 2-4: red, implement, green** + design guards
- [ ] **Step 5: Commit** `feat(grades): the morning-after grade board on league home, commissioner toggle`

### Task 11: Mock debrief grade (private, supersession)

**Files:**
- Modify: `src/mock-draft-service/debrief.ts` (`summarizeCompletedMock` gains `yourGrade: TeamGrade | null` computed at read time via `gradeDraft` — the caller already has picks/rosters), `src/draft-room/components/mock-results.tsx` (your-grade card, components cited inline, AMEND the "No letter grade, ever" docblock to record ruling R-2 and cite the spec)
- Test: extend `src/mock-draft-service/debrief.test.ts` + `src/draft-room/components/mock-results.test.tsx`

Private always: only the requesting manager's own grade, never other seats' (ruling 3, spec §15). Nothing stored (mock retention sweep unaffected).

- [ ] **Step 1: Failing tests**: debrief carries your grade with components, other seats absent from the payload, results card renders letter + components + basis line, absence renders nothing
- [ ] **Step 2-4: red, implement, green**
- [ ] **Step 5: Commit** `feat(grades): your mock grade in the debrief, cited and private`

### Task 12: Assistant demo page, e2e, reconciliation

**Files:**
- Modify: `src/app/app/(shell)/draft/assistant/page.tsx` (+ client component `src/draft-hq/assistant-demo/demo.tsx`, +test)
- Create/extend: one Playwright spec exercising a mock room's Assistant tab end to end (follow `e2e` mock-draft spec patterns)

Demo: a REPLAYED room (spec §6 first line) — `runOneDraft` with a fixed seed builds a 10-team draft; the page steps through picks 1..N with the pure client modules (Tasks 4/5/7) rendering live and a canned `AssistantCallView` per step precomputed at build of the fixture (deterministic — the demo's numbers are real sim numbers, labeled "a replayed room, seeded and reproducible"). No gateway, no network.

- [ ] **Step 1: Failing demo component test** (step forward/back, panes update, replay label present)
- [ ] **Step 2-4: red, implement, green**
- [ ] **Step 5: e2e**: mock room → Assistant tab shows three candidates before your pick, beat line after; run targeted spec only (memory: dont-run-full-e2e-every-time)
- [ ] **Step 6: Full gates**: `npx vitest run src/draft-room src/draft-service src/jobs src/league-room src/mock-draft-service src/design`, `tsc`, `eslint`, targeted e2e
- [ ] **Step 7: Commit** `feat(assistant): the guided demo on a replayed room, e2e coverage`

---

## Self-review notes

- Spec §6 coverage: the call (T3/T6), make-it-back (T1/T2), runs + tier countdown (T4), roster shape vs winning shapes (T3 payload + T6), bye collisions (T5), stack suggestions (T5, law-gated), reach guard (T5/T6), post-pick beat (T7), auction mode → follow-on auction plan, never-auto-acts (engine argues only, no submit path in any assistant file).
- Spec §9 grades: engine (T8), storage + job + completion hook (T9), room-wide board on league home (T10), mock private grade (T11), accountability loop (register grades page linkage already exists, the basis line names the board). Grade blurb persona (capsule voice) deliberately NOT an LLM surface here — grades are deterministic components, no prose generation, so no gateway dependency.
- Types consistent: `AssistantCallView`/`MakeItBackOdds`/`TeamGrade` names match across tasks.
- No placeholders remain. Auction depth is explicitly out (own plan).
