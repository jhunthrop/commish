# Blueprint: Commish — Phase 9: Dynasty & Keeper Depth

**Objective:** Make the strategy doc's own first-listed differentiator actually true. Extend the existing `DraftEngine` (Phase 1 Step 3) with a dynasty startup draft and a separate annual rookie draft, extend the `League`/`Roster` domain model with keeper eligibility and season-to-season carry-over, extend `TradeProposal` (Phase 1 Step 9) so future draft picks are real tradeable assets, build a pick-value-aware trade calculator on top of Phase 3's existing trade-fairness analyzer, and build an orphan-team marketplace for abandoned dynasty rosters. Then reopen Phase 1 Step 10's public-matchmaking filter, which was deliberately closed to dynasty because none of this existed yet.

**Honesty note — read this before citing strategy doc §4 anywhere external:** Strategy doc §4's first-listed principle is *"One draft engine, every format — snake, auction, and dynasty startup drafts run natively in the same live room."* §1.5 and §4 also name "dynasty-specific depth (trade calculators, rookie-pick trading UI, a real keeper/orphan-team marketplace)" as a top-3-ranked, ESPN-can't-do-this differentiator. As of Phase 1 through Phase 8, **none of that is true.** Phase 1 Step 3 implements exactly two formats — snake and auction — and Phase 1 Step 10's matchmaking UI explicitly excludes dynasty from the joinable-format list with the comment "since the draft engine can't run it yet." No phase before this one ever revisits that. This phase is what closes the gap; until every step below has actually shipped, product marketing and sales positioning should not represent dynasty/keeper support as live. Treat "every format" as aspirational-but-unbuilt language until Phase 9 lands, not as a currently-shippable claim.

**Source strategy doc:** `docs/research/2026-08-16-beating-apex-strategy.md` (§1.5 item 1 and item 13, §4 first bullet and "Dynasty-specific depth" bullet) — read both before starting any step in this phase.

**Depends on:**
- **Phase 1** (`plans/fantasy-mvp-prototype.md`) — at minimum. Step 1 (domain model, roster-eligibility, timing rule, design system), Step 3 (`DraftEngine` reducer), Step 7 (league management, standings — needed for rookie-draft ordering), Step 9 (`TradeProposal` type + `analyzeTradeFairness`), and Step 10 (public matchmaking, which Step 6 of this phase edits).
- **Phase 3** (`plans/phase-3-trust-and-integrity.md`) — needed additionally by **Step 4** (the trade calculator reuses Phase 3 Step 3's `TradeFairnessFlagService`, which itself reuses Phase 1 Step 9's analyzer — this phase adds zero new fairness-scoring logic).
- **Phase 4** (`plans/phase-4-payments.md`) — needed additionally by **Step 5** (the orphan marketplace's mid-season buy-in proration needs a real ledger). Phase 4 does not need to be complete for this phase to execute — see Step 5's adapter-interface treatment below, which follows the exact pattern Phase 4 itself uses for its own unresolved banking-partner dependency.

This phase can execute as soon as Phase 1 is done. Step 4 additionally needs Phase 3. Step 5's core marketplace mechanic (listing/claiming a free-league orphan team) needs only Phase 1 and this phase's own Step 2; only its paid-proration sub-case needs Phase 4, and that sub-case is deliberately isolated behind an adapter so it never blocks the rest of the step.

**Mode:** Same as Phase 1 and Phase 3 — direct execution against the existing repo, TDD per the user's global testing rules, no git branch/PR workflow assumed unless repo state at execution time says otherwise.

**A word on scope discipline:** every step below is an *extension* of something Phase 1, 3, or 4 already built — the reducer, the roster-eligibility functions, the timing rule, the trade analyzer, the ledger/adapter pattern, the matchmaking filter. No step in this phase reimplements draft turn-order logic, fairness scoring, or payment-adapter plumbing that already exists elsewhere. Where this phase must fill a real gap the earlier phases left open (see Step 3's context brief — trade *execution*, as opposed to trade *analysis*, was never actually built anywhere), that gap is named explicitly, not silently patched over.

---

## New config surface introduced in this phase — `src/config/dynasty.ts`

Per the user's "config over hardcoding" rule and matching Phase 3's `src/config/integrity.ts` precedent, every threshold in this phase lives here as named, documented constants:

- `ROOKIE_DRAFT_ORDER: 'reverse-standings' | 'random'` + `ROOKIE_CLASS_SIZE` (Step 1)
- `ROOKIE_DRAFT_CLOCK_SCHEDULE` — a separate, shorter schedule from Phase 1 Step 3's `DRAFT_CLOCK_SCHEDULE`, since rookie drafts run a handful of rounds, not 15+ (Step 1)
- `MAX_KEEPERS`, `KEEPER_ROUND_ESCALATION_PER_YEAR`, `KEEPER_YEARS_OWNED_LIMIT` (Step 2)
- `PICK_VALUE_CHART` — base value per future-pick round, adjusted by projected standing (Step 4)
- `ORPHAN_INACTIVITY_WEEKS_THRESHOLD` (Step 5)

Each constant carries a code comment explaining what it means in plain language, matching Phase 3's precedent — these are the numbers most likely to need commissioner-facing tuning post-launch.

## Explicitly out of scope for this phase

- Real money changing hands for orphan-team proration — Step 5 builds this against a mock adapter unless Phase 4 has already landed; see Step 5.
- A general RBAC/permissions rework for who can list/claim an orphan team — reuses whatever minimal role model Phase 2/3 already established (league commissioner or `isAdmin`), not a new permissions framework.
- Dynasty-specific AI advisory features beyond pick-value estimation (e.g., a full rebuild-vs-contend season-long strategy advisor) — named in strategy doc §4.2 as a *future paid-tier* feature, not part of this phase's scope.
- Auto-tightening draft clocks as a concept — already built in Phase 1 Step 3; this phase only adds a second, shorter schedule constant for rookie drafts, not a new clock mechanism.

---

## Dependency Graph (adjacency list)

- Step 1 (dynasty startup + rookie draft engine) → depends on: Phase 1 Step 1, Step 3, Step 7
- Step 2 (keeper designation & roster carry-over) → depends on: Step 1, Phase 1 Step 1
- Step 3 (tradeable draft-pick asset + trade execution) → depends on: Phase 1 Step 1, Step 9
- Step 4 (dynasty trade calculator UI) → depends on: Step 3, Phase 3 Step 3, Phase 1 Step 9
- Step 5 (orphan-team marketplace) → depends on: Step 2; Phase 4 Step 3 only for the real (non-mock) proration adapter
- Step 6 (supersede Phase 1 Step 10's dynasty exclusion) → depends on: Step 1, Step 2, Phase 1 Step 10

**Parallel opportunities:** Step 3 ∥ {Step 1, Step 2} — the pick-asset/trade-execution track and the draft-engine/keeper track touch disjoint files and share only the `League`/`Draft` domain types Phase 1 Step 1 already owns. Step 4 ∥ Step 2 (once Step 3 lands, Step 4 doesn't need Step 2 at all). Step 5 ∥ Step 4 (once Step 2 lands). Step 6 should run last among {1, 2} and can run in parallel with {3, 4, 5} — it only needs Steps 1–2, not the trade-asset track.

```
Phase 1 (Step 1, 3, 7, 9, 10)  Phase 3 Step 3  Phase 4 Step 3
        │                            │  (Step 4 only)   │ (Step 5 real proration only)
        ▼                            │                  │
Step 1 ──┬─────────────→ Step 6      │                  │
        │                            │                  │
        ▼                            │                  │
Step 2 ──────────────────────────────┼───→ Step 5 ───────┘
                                      │        ▲ (mock adapter until Phase 4 lands)
Step 3 ───────────────────────────────→ Step 4
```

---

## Step 1 — Dynasty startup draft + annual rookie draft in the existing `DraftEngine`

**Model tier:** strongest (extends the concurrency-sensitive reducer from Phase 1 Step 3; a mistake here risks the same class of correctness bug that step was written to avoid)
**Depends on:** Phase 1 Step 1, Step 3, Step 7
**Parallel with:** Step 3

### Context brief
Read `docs/conventions.md` and Phase 1 Step 3's `DraftEngine` reducer before writing anything. **Design decision, stated explicitly per this phase's brief:** a dynasty startup draft is **not** a third value alongside `format: 'snake' | 'auction'`. It reuses `format` unchanged — a commissioner picks snake or auction for a startup draft exactly as they would for a redraft league today. Justification: turn order, nomination, bidding, and pick validation are mechanically identical whether or not the league is dynasty; the only thing that differs is what happens *after* the draft (keeper/carry-over rules apply from then on, owned by Step 2) and roster size (already config-driven via Phase 1 Step 1's roster-slot count — no new mechanism needed). Adding a third `format` value would conflate two independent axes — turn mechanics vs. season-carry-over rules — and force every existing `format` consumer (Steps 4, 5, 6, 10 of Phase 1) to grow a dynasty branch it doesn't actually need. The correct new axis is `League.leagueType`.

The **rookie draft** is genuinely new: a smaller pool (incoming rookies only) and an order tied to prior-season standings rather than a fresh random/manual order. This still reuses the existing reducer, `validateRosterAdd`/`validateLineup`, and the timing rule (`timestamp`-carrying actions, no `Date.now()`) unchanged — it only needs a different turn-order generator and a filtered player pool feeding into the same `MAKE_PICK`/`TIMER_EXPIRE` actions.

### Tasks
- [ ] Add `League.leagueType: 'redraft' | 'dynasty' | 'keeper'` to Phase 1 Step 1's `League` domain type, defaulting to `'redraft'` so every existing Phase 1/2/3 fixture and test remains valid unmodified
- [ ] Add `Draft.draftKind: 'startup' | 'annual' | 'rookie'` to the `Draft` domain type — `'annual'` is the default for ordinary non-dynasty drafts (zero behavior change from today); `'startup'` marks a dynasty league's initial full-pool draft (mechanically identical to `'annual'`, tagged only for reporting/UI purposes); `'rookie'` is the new incoming-rookies-only mode
- [ ] Add `draftClassYear: number` to the `Player` domain type (Phase 1 Step 1) — needed to filter the pool to a single incoming rookie class
- [ ] Implement `filterToRookiePool(players, draftClassYear): Player[]` — a pure function, no new reducer action
- [ ] Implement `computeRookieDraftOrder(priorSeasonStandings, orderMode): TeamId[]` — pure function; `ROOKIE_DRAFT_ORDER: 'reverse-standings' | 'random'` (config, `src/config/dynasty.ts`) with `'reverse-standings'` as the default (worst record picks first, matching real-world dynasty convention), reading Phase 1 Step 7's standings data
- [ ] Enforce at draft-construction time that `draftKind: 'rookie'` may only pair with `format: 'snake'` — reject `'auction'` with a clear error; this is a stated product convention (real dynasty leagues run rookie drafts as snake), not an engine limitation
- [ ] Wire `computeRookieDraftOrder`'s output into the existing reducer's turn-order initialization — no new `DraftEngine` action types, no new state-transition logic beyond turn-order seeding
- [ ] Add `ROOKIE_DRAFT_CLOCK_SCHEDULE` to `src/config/dynasty.ts`, a shorter `DRAFT_CLOCK_SCHEDULE`-shaped array (Phase 1 Step 3's existing auto-tightening mechanism, reused unchanged — this is a second config value, not a second mechanism)
- [ ] Extend the mock dataset/seed generator (Phase 1 Step 1's `src/data/seed/`) to add a small, deterministic rookie class per season (`ROOKIE_CLASS_SIZE` in config), tagged with `draftClassYear`, so rookie-draft tests have real data to draft from
- [ ] Tests: a startup draft run in a `leagueType: 'dynasty'` league produces byte-identical turn-order/validation behavior to Phase 1 Step 3's existing snake/auction tests, proving no behavior fork exists between redraft and dynasty startup drafts
- [ ] Tests: a full mock rookie draft (12 teams, 4 rounds) using a seeded rookie class and seeded prior-season standings produces the correct reverse-standings order, rejects any non-rookie-class player from the pool, and rejects `draftKind: 'rookie'` + `format: 'auction'` at construction

### Verification
```bash
npm test -- src/draft-engine
npm run lint
npm run typecheck
```

### Exit criteria
- Phase 1 Step 3's existing test suite passes unmodified — this step introduces zero regressions to snake/auction drafting
- A full mock rookie draft runs end-to-end via the existing reducer with correct reverse-standings turn order and correct rookie-only pool enforcement
- `leagueType` and `draftKind` both default in a way that leaves every pre-existing fixture and test valid with no changes required to them

### Rollback
Additive fields with safe, non-breaking defaults (`leagueType: 'redraft'`, `draftKind: 'annual'`) — Phase 1/2/3 code paths are untouched if this step is reverted.

---

## Step 2 — Keeper designation, cost model & season-to-season roster carry-over

**Model tier:** strongest (season-transition logic is data-integrity-critical in the same way Phase 4 Step 3's ledger schema is — a mistake here corrupts a league's roster history across a year boundary, and retrofitting after real dynasty leagues exist is far more expensive than getting it right now)
**Depends on:** Step 1 (needs `League.leagueType`), Phase 1 Step 1
**Parallel with:** Step 3, Step 4

### Context brief
Read `docs/conventions.md` and this phase's Step 1 output first. This step is the actual "keeper league" feature: which players a team can hold onto across a season boundary, what that costs them, and what happens to everyone else's roster when a new season starts. Build this as config-driven data-model logic — no magic numbers, no hardcoded escalation rate, per the user's global coding-style rule — with a thin UI layer on top reusing Phase 1 Step 1's design-system primitives, not a new visual system.

### Tasks
- [ ] Define `src/domain/keeper.ts`: `KeeperConfig` (`leagueId`, `maxKeepers`, `costModel: 'draft-round-escalation' | 'flat-fee' | 'auction-value-escalation'`, `yearsOwnedLimit?: number`) and `KeeperSelection` (`teamId`, `playerId`, `seasonYear`, `costBasis`, `yearsKept`)
- [ ] Implement `computeKeeperCost(costModel, originalAcquisition, yearsKept): CostBasis` — for `'draft-round-escalation'`, cost is `max(1, originalDraftRound - KEEPER_ROUND_ESCALATION_PER_YEAR * yearsKept)` (an earlier, more expensive round each year kept, floored at round 1); rate and floor both read from `src/config/dynasty.ts`, never inlined
- [ ] Implement `isKeeperEligible(selection, config, currentYearsKept): { eligible: boolean; reason?: string }` enforcing `maxKeepers` per team and `KEEPER_YEARS_OWNED_LIMIT` — a player kept past the configured limit is forced back into the following redraft pool, which is what keeps the format from degenerating into permanent ownership
- [ ] Implement `SeasonTransitionService.transitionLeagueToNextSeason(leagueId, nextSeasonYear)`, branching on `League.leagueType`:
  - `'redraft'`: clears all rosters into a fresh draft pool for next season (the first place this transition is named as its own explicit function — Phase 1 never needed to name it since it only ever ran one season)
  - `'dynasty'`: carries the entire roster forward automatically (marking each carried player `carriedOver: true`) except explicit team-submitted cuts made before a configured cutoff date; generates next season's rookie-draft pick-ownership defaults (each team owns its own picks per round, unless Step 3's traded-pick records say otherwise)
  - `'keeper'`: carries forward only players present in a valid `KeeperSelection` for that team (bounded by `isKeeperEligible`); every other rostered player returns to next season's startup-style redraft pool
- [ ] Build a minimal keeper-selection UI (per-team, pre-season) using Phase 1 Step 1's shared UI primitives — form-driven selection against `isKeeperEligible`, showing computed cost per candidate; no new visual system, loading/empty/error states included per Phase 1's standing UI-step rule
- [ ] Tests: config-driven cost escalation — changing `KEEPER_ROUND_ESCALATION_PER_YEAR` changes computed cost with no code change, matching Phase 3's config-test precedent
- [ ] Tests: `yearsOwnedLimit` boundary (one year under, exactly at, one year over)
- [ ] Tests: a full season-transition test for each of the three `leagueType` values, asserting correct next-season roster state from a seeded prior-season fixture
- [ ] Test proving `transitionLeagueToNextSeason` is the only place roster carry-over/clearing logic lives — no duplicate season-rollover code path exists elsewhere

### Verification
```bash
npm test -- src/keeper
npm run lint
npm run typecheck
```

### Exit criteria
- Cost-escalation and eligibility rules are fully config-driven, verified by tests proving config changes alone change outcomes
- A season-transition test passes for `redraft`, `dynasty`, and `keeper`, each producing the correct next-season roster from a seeded fixture
- A keeper past `KEEPER_YEARS_OWNED_LIMIT` is correctly forced back into the draft pool, verified by test

### Rollback
Additive tables/functions; `League.leagueType` defaults to `'redraft'`, so existing leagues are unaffected if this step is reverted.

---

## Step 3 — Tradeable draft-pick asset type + real trade execution

**Model tier:** strongest (this closes a real correctness gap — ownership transfer must be atomic and race-free, the same class of risk as Phase 4 Step 3's ledger correctness)
**Depends on:** Phase 1 Step 1, Step 9
**Parallel with:** Step 1, Step 2

### Context brief
Read Phase 1 Step 9's `TradeProposal` type and its exported interface before writing anything. **A real gap exists in the base plan, and this step must close it, not paper over it:** Phase 1 Step 9 built `TradeProposal` as a players-only, advisory/non-executable analysis input — "Trade execution is explicitly out of scope for this step." Phase 3 Step 3, however, subscribes to a `TRADE_ACCEPTED` audit event and assumes a trade accept/reject flow already exists somewhere. Neither Phase 1 nor Phase 3 ever actually builds it. This phase cannot ship "rookie-pick trading" without one, since a pick isn't really tradeable if nothing ever transfers its ownership — so this step builds the general trade-execution path (not a dynasty-specific one), because a pick-only execution path would fork the trade system into two implementations Phase 3's audit subscriber can't sit cleanly on top of.

### Tasks
- [ ] Confirm Phase 1 Step 9's exact `TradeProposal` shape and its analyzer's call signature before changing anything
- [ ] Extend `TradeProposal`'s per-side asset list from players-only to `ReadonlyArray<PlayerAsset | DraftPickAsset>` — `PlayerAsset { kind: 'player', playerId }`; `DraftPickAsset { kind: 'pick', leagueId, season, round, originalTeamId, currentOwnerTeamId }`. `DraftPickAsset` deliberately does not reference a concrete `Draft`/`draftId` row, since a future season's draft instance doesn't exist yet — only `season` + `round` + current ownership do
- [ ] Add a `draft_pick_ownership` Drizzle table as the durable record of who currently owns each future round in each season; seed it at league creation and at each `transitionLeagueToNextSeason` call (Step 2) with each team defaulting to owning its own picks
- [ ] Implement `executeTrade(proposal): Promise<void>` — the actual accept path Phase 3 Step 3 assumed exists. Atomically, inside one DB transaction: reassigns roster ownership for every `PlayerAsset` and `currentOwnerTeamId` for every `DraftPickAsset` on both sides, then emits `TRADE_ACCEPTED` via Phase 3 Step 1's `AuditLogger` if it's present at execution time — behind a presence check, since this phase may run before or after Phase 3; if `AuditLogger` isn't available, log a structured warning and still complete the trade (fail-open on the audit write only, never on the trade itself — the same ordering discipline Phase 1 Step 1 established for `publishEvent`)
- [ ] Enforce no-partial-trade: either every asset on both sides transfers, or none do
- [ ] Reject, before any write, a trade attempting to include a pick the proposing team does not currently own per `draft_pick_ownership`
- [ ] Tests: a pick-only trade transfers ownership correctly and is reflected when Step 1's `computeRookieDraftOrder`/ownership lookup runs for that future draft
- [ ] Tests: a mixed player+pick trade executes atomically; a simulated failure partway through rolls back both sides, not just one
- [ ] Test proving Phase 1 Step 9's original advisory-only analyzer flow still produces zero ownership changes on its own — analysis and execution remain fully separate, execution is opt-in and explicit

### Verification
```bash
npm test -- src/trade
npm run lint
npm run typecheck
```

### Exit criteria
- `TradeProposal` supports pick assets end to end, verified by tests
- `executeTrade` is the only function that mutates `draft_pick_ownership` or performs a roster-swap for a trade — grep-verifiable, matching Phase 3 Step 3's "only one function computes X" precedent
- A rookie pick traded before its draft correctly determines who picks in that slot when Step 1's rookie draft runs, verified by an integration test spanning both steps

### Rollback
Additive table + new execution function; Phase 1 Step 9's existing advisory-only analyzer path is untouched, verified by test.

---

## Step 4 — Dynasty trade calculator (pick-value-aware, built on Phase 3's fairness analyzer)

**Model tier:** strongest for the pick-value-estimation design and the analyzer-reuse integration (getting this wrong means silently forking fairness-scoring logic a second time, the exact failure Phase 3 Step 3 was written to avoid the first time); default for the surrounding UI plumbing
**Depends on:** Step 3, Phase 3 Step 3, Phase 1 Step 9
**Parallel with:** Step 2, Step 5

### Context brief
Read Phase 3 Step 3 and Phase 1 Step 9 before writing anything — confirm their exported signatures. Strategy doc §4.2: "the same model that tells a member whether a trade is fair... One AI investment, two product surfaces." This step is a *third* surface on the same investment, not a new one — near-zero marginal AI cost, since the fairness-scoring model already exists twice over (member-facing advisory in Phase 1 Step 9, automatic collusion-flagging in Phase 3 Step 3). The only genuinely new logic this step adds is pick-value estimation: the existing analyzer's context assembly has no concept of a future pick's value, because a pick isn't a player with stat lines to read from the mock dataset.

### Tasks
- [ ] Implement `estimatePickValue(pick: DraftPickAsset, leagueContext): number` — a config-driven value curve (`PICK_VALUE_CHART` in `src/config/dynasty.ts`): a base value per round, adjusted by the current-owner team's standing-derived pick-slot projection (a future 1st-round pick owned by a last-place dynasty team is worth more than one owned by a title contender). This is a value *estimate* feeding the existing analyzer's context — it is explicitly not a new fairness-scoring model; the analyzer still produces the actual verdict
- [ ] Extend (wrap, do not fork) Phase 1 Step 9's context-assembly function so a `TradeProposal` containing `DraftPickAsset`s has each pick's `estimatePickValue` output folded into the same structured payload already used for players — the analyzer's call signature does not change
- [ ] Build the trade-calculator UI (`src/dynasty/trade-calculator/`): a two-sided asset builder (players and picks on either side), calling the existing reused analyzer and rendering its fairness verdict plus an explicit per-asset value breakdown so a user sees *why*, not just a score — Phase 1 design-system primitives, full loading/empty/error/success state coverage, a11y pass, per Phase 1's standing UI-step rule
- [ ] Wire "propose this trade" from the calculator into Step 3's `TradeProposal`/`executeTrade` flow — calculate, then propose, then accept, extending Phase 1 Step 9's original propose→analyze pattern rather than replacing it
- [ ] Test: a repo-wide search/grep proves only one function computes trade fairness (Phase 1 Step 9's analyzer, called transitively through Phase 3 Step 3 and this step) — this step adds zero duplicate scoring logic
- [ ] Test: a pick-inclusive trade's fairness score changes when `PICK_VALUE_CHART` config changes, with no code change
- [ ] Test: a players-only trade (no picks) run through this UI produces an identical result to running it through Phase 1 Step 9's original flow directly — proving no regression to the non-dynasty case

### Verification
```bash
npm test -- src/dynasty/trade-calculator
npm run lint
npm run typecheck
npm run dev   # manual: build a mixed player+pick trade and confirm the fairness verdict and value breakdown render correctly
```

### Exit criteria
- The grep-verifiable single-source-of-fairness-logic test passes
- Config-driven pick valuation is proven by a test, matching Phase 3's config-test precedent
- Players-only trades produce identical results through this UI and through Phase 1 Step 9's original flow

### Rollback
Additive UI + a pure value-estimation function on top of Step 3; disabling it does not touch the underlying analyzer or Step 3's execution path.

---

## Step 5 — Orphan-team marketplace

**Model tier:** default; route through **security-reviewer** before merge given this step touches account-claim and payment-adjacent flows, matching Phase 4 Step 6/7's precedent
**Depends on:** Step 2; Phase 4 Step 3 only for the real (non-mock) proration adapter
**Parallel with:** Step 4

### Context brief
Dynasty/keeper leagues are multi-year commitments; a manager going inactive mid-dynasty is a real, named gap (strategy doc §1.5 item 13, §4). This step needs Phase 4's ledger for exactly one sub-case — prorating a paid league's buy-in when a new manager claims an abandoned team partway through a season — and Phase 4 may not exist yet when this phase executes. **Follow the same discipline Phase 4 uses for its own unresolved dependency (the banking partner in Phase 4 Step 1):** build against an adapter interface with a mock implementation now; swap in a real implementation once Phase 4 Step 3's ledger exists. Do not gate the core marketplace mechanic — listing and claiming a team — on this. Only the paid-proration sub-case is gated.

### Tasks
- [ ] Define `BuyInProrationAdapter` (`src/dynasty/orphan-marketplace/proration-adapter.ts`): `computeProratedAmount(originalEntryFeeCents, seasonStartDate, claimDate, seasonEndDate): number`, `chargeProration(userId, contestId, amountCents): Promise<{ status: 'charged' | 'skipped' }>` — mirrors Phase 4 Step 2's `PaymentProviderAdapter` shape (integer cents, never floats; async status, not a synchronous assumption)
- [ ] Implement `MockBuyInProrationAdapter`: `computeProratedAmount` is real, correct pure math (available regardless of Phase 4's status); `chargeProration` is a no-op returning `status: 'skipped'` — the claim proceeds free in any Phase-4-less environment, and both the code and the UI copy state this explicitly ("proration charge simulated — no real payment collected"), so nobody mistakes a pre-Phase-4 environment for a working billing path
- [ ] Implement `computeTeamActivityStatus(teamId): 'active' | 'inactive'` against `ORPHAN_INACTIVITY_WEEKS_THRESHOLD` (config, `src/config/dynasty.ts`) — no lineup changes and no logins for N consecutive weeks. Reads Phase 3 Step 1's audit log if Phase 3 has landed (session/lineup-change events already recorded there); falls back to Phase 1's own `Roster`/lineup-change timestamps if Phase 3 hasn't landed — same fail-soft, don't-hard-block-on-a-later-phase discipline as Step 3's audit write
- [ ] Build the listing surface: a commissioner (or a scheduled job) marks a team `LISTED_FOR_CLAIM`, showing its roster/keeper context to browsing users — reuse Phase 1 Step 10's matchmaking-style filter/browse UI pattern rather than inventing a parallel one
- [ ] Build the claim flow: a new manager claims a listed team. For a free/mock-stake league, ownership transfers immediately. For a paid league, `computeProratedAmount` shows the charge up front, `chargeProration` is called (mock or real, depending on which adapter is wired at deploy time), and ownership transfers only on a `'charged'` result (or, in mock mode, on the explicitly-labeled-simulated `'skipped'` result)
- [ ] Tests: inactivity detection crosses `ORPHAN_INACTIVITY_WEEKS_THRESHOLD` correctly, boundary-tested, config-driven
- [ ] Tests: the mock proration adapter computes correct prorated amounts for early-, mid-, and late-season claims
- [ ] Tests: a claim on a free/mock-stake league never calls the proration adapter at all; a claim on a paid league is blocked if `chargeProration` rejects

### Verification
```bash
npm test -- src/dynasty/orphan-marketplace
npm run lint
npm run typecheck
npm run dev   # manual: list an inactive seeded team, claim it as a different seeded user, confirm the simulated-proration copy is visible
```

### Exit criteria
- The core listing/claim mechanic works fully in a Phase-4-less environment, proven by tests using only the mock adapter
- `computeProratedAmount`'s math is independently correct and covered regardless of which adapter is wired
- A documented follow-up (mirroring Phase 4's own "Post-Phase: What Actually Unblocks Real Money" note) states that real proration charging requires a `RealBuyInProrationAdapter` built once Phase 4 Step 3's ledger exists, reusing its `postDoubleEntryTransaction` primitive rather than inventing a second ledger

### Rollback
Gated behind a feature flag; disabling it removes the marketplace surface without affecting Steps 1–2's core dynasty roster/draft logic.

---

## Step 6 — Supersede Phase 1 Step 10's dynasty exclusion in public matchmaking

**Model tier:** default
**Depends on:** Step 1, Step 2, Phase 1 Step 10
**Parallel with:** Step 3, Step 4, Step 5

### Context brief
Phase 1 Step 10 shipped with a deliberate, correct-at-the-time exclusion: *"Filter by `format` using only `'snake' | 'auction'`... do not surface dynasty or best-ball as joinable, since the draft engine can't run them yet."* That stopped being accurate the moment this phase's Step 1 landed. **This step supersedes that exclusion.** It is a real code change to the matchmaking source Phase 1 Step 10 built (`src/matchmaking/`) — not an edit to any phase blueprint file. Blueprint-file reconciliation across phases (including updating Phase 1's own text and the roadmap's phase table) is handled by a separate process; this step's scope is strictly the application code Phase 1 Step 10 produced.

### Tasks
- [ ] Locate Phase 1 Step 10's format-filter implementation in `src/matchmaking/` and its `League.format` filter options
- [ ] Surface `League.leagueType` (`redraft` / `dynasty` / `keeper`) as its own filter dimension alongside the existing `format` filter — a browsing user cares about both independently, since a dynasty league still runs its startup draft as snake or auction (Step 1's design decision)
- [ ] Remove the now-inaccurate exclusion comment and any code path that hides `leagueType: 'dynasty'` leagues from the browse list
- [ ] Update Phase 1 Step 10's public-league seed fixtures (`src/data/seed/`) to include at least one seeded public dynasty league, so the new filter path has real fixture data, not just a type-level change
- [ ] Add a public-dynasty-league join test mirroring Phase 1 Step 10's existing join-flow test, proving a user can filter to, browse, and join a public dynasty league end to end

### Verification
```bash
npm test -- src/matchmaking
npm run lint
npm run typecheck
npm run dev   # manual: filter to leagueType=dynasty, browse, and join a seeded public dynasty league
```

### Exit criteria
- Filtering by `leagueType: 'dynasty'` correctly narrows the visible public-league list
- Joining a public dynasty league succeeds through the same join path Phase 1 Step 10 built, verified by a test
- Strategy doc §4's "every format... including dynasty" claim is now literally true for public matchmaking, not only for privately-created leagues

### Rollback
A filter-list and seed-data change only; reverting restores Phase 1 Step 10's original snake/auction-only exclusion without touching Steps 1–5 of this phase.

---

## Post-Phase: What This Unlocks, and What's Still Deferred

Once Steps 1–4 and 6 land, strategy doc §4's "every format" claim and §1.5/§4's dynasty-depth bullet are both actually true in the product, not just in the strategy doc. Step 5's core mechanic is also true (listing/claiming an abandoned dynasty team) even before Phase 4 exists — only its paid-proration sub-case remains mock until Phase 4 Step 3's ledger is real, exactly mirroring how Phase 4 itself stays mock-only until its own Step 1 (banking partner) closes.

**Deliberately still deferred, not silently dropped:** a full AI-driven "should I keep this player" or "rebuild vs. contend" strategy advisor (strategy doc §4.2 names this as a future paid-tier feature, not part of this phase); a real `RealBuyInProrationAdapter` implementation (tracked as follow-up work once Phase 4 Step 3 exists, same pattern as Phase 4's own tracked follow-up for a real `PaymentProviderAdapter`); dynasty-specific league-history/dynasty-lineage reporting across multiple seasons (a nice-to-have surfaced by real dynasty leagues once several seasons of Step 2's carry-over data accumulate, not needed for this phase's exit criteria).
