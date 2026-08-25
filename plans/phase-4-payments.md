# Blueprint: Commish — Phase 4: Payments & Money Movement

> **SUPERSEDED (2026-08-24):** this 8-step sketch was rebased into the executed plan, `docs/superpowers/plans/2026-08-24-phase4-money-foundations.md`, whose supersession table maps every step below to its fate. The built system is documented in `docs/money.md`; the decision record is `docs/decisions/money-foundations.md`. Read those first — this file is kept as the historical sketch only.

**Objective:** Turn the prototype's mock stake tiers (`plans/fantasy-mvp-prototype.md`, Step 9) into real entry fees, real prize pools, and real payouts, following the FBO/agent-of-payee architecture in `docs/research/2026-08-16-beating-apex-strategy.md` §3. This phase adds: a payment-provider adapter interface with a mock/sandbox implementation, a double-entry per-user/per-state ledger, entry-fee collection wired to the join flow, prize-pool escrow and payout, deposit/withdrawal UI with risk-based staged KYC/CIP, and an AML/OFAC sanctions-screening adapter.

**Source strategy doc:** `docs/research/2026-08-16-beating-apex-strategy.md`, primarily §3 ("Tax & Payments, Built In From Day One") — §3.3 (FBO/agent-of-payee model, banking partners) and §3.4 (engineering checklist) are load-bearing for this entire phase. §2.4 (public-league experience-tier rules) and §4.1 (public-league integrity tooling) are referenced where payout settlement needs to respect Phase 3's collusion flags.

**Depends on:**
- **Phase 2 (real user accounts).** You cannot hold a real money balance against an anonymous or mock session — every ledger entry in this phase is keyed to a real, authenticated `userId`.
- **Phase 3 (anti-collusion / integrity tooling).** The strategy doc's own reasoning (§4.1, §1.1) is that money and integrity tooling ship together, not money-before-integrity: a public league's payout flow (Step 5 below) must be able to hold or exclude a collusion-flagged entrant's payout, which requires Phase 3's flagging to already exist.

**Explicitly NOT this phase (deferred to Phase 5 or later):**
- Actual signed banking/BaaS partner integration — see Step 1. Until that business decision closes, every step below runs only against sandbox/mock implementations.
- W-9/TIN collection, backup withholding, and 1099-MISC/1099-K generation (strategy doc §3.1, §3.4 items 1/4/5) — that's Phase 5 (tax compliance). This phase's ledger schema (Step 3) is deliberately built to support Phase 5 without a rewrite, but the tax-filing logic itself is out of scope here.
- State-by-state legal/licensing enforcement and geofencing at contest entry (strategy doc §2) — assumed handled by an earlier phase or explicitly stubbed; this phase consumes a `stateOfEntry` value, it does not produce one.
- Real KYC/AML vendor contracts — same "adapter now, vendor later" treatment as the banking partner (see Steps 6 and 7).

**Mode:** Direct, following Phase 1's conventions (TypeScript strict, Next.js 15 App Router, Vitest, Drizzle ORM/SQLite for local dev). No new runtime dependencies are required for this phase's mock/sandbox work — real provider SDKs (Column, Increase, Stripe Treasury, etc.) are deliberately *not* installed until Step 1 resolves, so this phase doesn't accumulate dependencies on an API that might not be the one eventually chosen.

**Revision note (v2):** v1 was checked against a full adversarial scaling review and a full adversarial UX-completeness review (`docs/research/2026-08-16-scaling-review.md` finding I1; `docs/research/2026-08-16-ux-review.md` finding C8). v2 fixes both. **Step 4** (entry-fee collection) closes two concurrency races the idempotency key alone didn't cover — a review found it only prevents the *same* user double-submitting, not two *different* users racing for a league's last seat, or two concurrent joins to *different* contests both reading the same pre-debit balance; fixed with row-level locking (`SELECT ... FOR UPDATE`, or an atomic conditional `UPDATE`) plus a `CHECK (balance_cents >= 0)` backstop. **Step 5** (payout) now also locks the contest row for the duration of settlement so a late join or reversal racing concurrently with it can't leave escrow non-zero. **A new Step 8, "Wallet & money-trust UX,"** is added — a review found this phase was backend-correct with almost no designed user experience for what strategy doc §4 calls the highest-anxiety moment in the product: no balance breakdown display, the strategy doc's "always-on escrow indicator" reduced to a per-contest afterthought, only one withdrawal method ever specified (contradicting the stated goal of beating Underdog's "no credit-card withdrawal" complaint), and staged KYC with no user-facing flow. **Step count is now 8; Steps 1–7 keep their existing numbers**, so any cross-reference to this file from another phase file by step number remains valid — only Step 8 is new, appended after Step 7.

> **Step-number reconciliation:** this file was drafted against an earlier draft of Phase 1 that had 9 steps, where public-league matchmaking (the mock stake-tier join flow referenced above) was Step 9. Phase 1 was later rewritten to 11 steps and matchmaking is now **Step 10**. See `plans/00-roadmap.md` for the full old→new mapping before executing any step below.

---

## A note on the central constraint of this phase

Every other phase in this plan is bounded by engineering effort. This one is not. **Step 1 is a business/legal prerequisite, not a coding task**, and most of the code in Steps 2–7 cannot move real money until it resolves. This is not a scheduling inconvenience to route around — it's named explicitly so that:

1. No engineer mistakes "the mock adapter works" for "we can process real entry fees" — those are different milestones, and only the second one requires Step 1 to be done.
2. Every code step after Step 1 is built against an **adapter interface**, never against a specific provider's SDK or API shape. That's what makes it possible to build and fully test this entire phase today, in sandbox, and swap in a real implementation later as a bounded, low-risk change — one new class per adapter, not a rewrite.
3. "Done" for this phase means "correct against the mock," not "processing real money." Real-money go-live additionally requires Step 1 to have closed, plus a real adapter implementation (out of scope for this phase's tasks — tracked as follow-up work once a partner is signed).

## Dependency Graph

```
Step 1  [BUSINESS PREREQUISITE — not code]
        (runs in parallel with every step below; nothing here is blocked waiting on it,
         and it may still be open when the rest of this phase reaches "done against mock")

Step 2 — Payment provider adapter interface + mock/sandbox implementation
   │
   ▼
Step 3 — Double-entry per-user/per-state ledger  (foundation for Phase 5 — see Step 3 brief)
   │
   ├────────────────────────────────┐
   ▼                                ▼
Step 4 — Entry-fee collection    Step 6 — Deposit/withdrawal UI + staged KYC/CIP
   │                                │           (also depends on Step 2, for the
   ▼                                │            adapter's deposit/withdrawal calls)
Step 5 — Prize-pool escrow          │
         & payout flow              │
   │                                │
   └───────────────┬────────────────┘
                    ├──────────────────────────┐
                    ▼                          ▼
       Step 7 — AML/OFAC sanctions       Step 8 — Wallet & money-trust UX
                screening adapter          (depends on Steps 3, 4, 5, 6 —
       (extends Step 5's payout gate       the balance/escrow/withdrawal/
        and Step 6's CIP gate)             KYC surfaces those steps expose)
```

**Parallel opportunities:** Step 1 runs alongside everything (it's not code). Once Step 3 (ledger) lands, Step 4→5 (entry fee → payout chain) and Step 6 (deposit/withdrawal + KYC) touch different files and can proceed in parallel. Step 7 and Step 8 can both start once Steps 3–6 are all done: Step 7 hooks into Step 5's payout settlement and Step 6's CIP completion (its integration points don't exist until those are built), and Step 8 reads the same four steps' existing state to build the wallet/trust UI. They touch different files — Step 7 extends gating logic, Step 8 builds new UI surfaces — and can run in parallel with each other.

---

## Step 1 — [BUSINESS PREREQUISITE, NOT CODE] Select and sign a banking/BaaS partner

**Model tier:** N/A — this is a business/legal decision step, not a coding task. No agent should attempt to "implement" this step; its job is to produce a decision artifact (an ADR) and, ideally, a signed agreement or sandbox credentials.
**Depends on:** nothing
**Parallel with:** Steps 2–8 (all of them — none of this phase's code is blocked waiting on this step to close)

### Context brief
Strategy doc §3.3: pooling entry fees and paying out prizes is money transmission in most states unless structured through an **FBO ("for benefit of") account** held by a bank or well-capitalized BaaS partner, combined with the **agent-of-payee exemption** (confirmed in detail only for California per DFPI guidance — must be independently verified state-by-state, not assumed nationwide). This is a real banking relationship with underwriting, contracts, and compliance review — it cannot be "built," only negotiated and signed, and it is realistically the longest lead-time item in this entire phase.

Candidate partners named in the strategy doc, roughly in order of directness: **Column** (chartered bank, programmatic FBO accounts directly — fewest intermediary layers), **Increase**, **Stripe Treasury** (platform/Connect-style), **Trustly** (open-banking deposit rails, purpose-built for iGaming-adjacent use cases), **Sightline Payments** (cashless wallet infrastructure already used by DraftKings/FanDuel/BetMGM). The strategy doc also flags a cautionary example: **Synapse**, a BaaS middleware layer, collapsed in 2024 — prefer a direct bank-chartered partner or a well-capitalized BaaS layer with a clearly disclosed sponsor bank, not an opaque middleware stack.

**Why this doesn't block Steps 2–7:** every downstream step is written against an adapter interface (Step 2). The interface's shape is derived from the *common* concepts across all these providers (account provisioning, deposit/payout intents, transaction status, balance reconciliation) — not from any one provider's specific API. That means Steps 2–7 can be fully built and tested today against a mock, and the eventual real integration becomes "write one more class that implements `PaymentProviderAdapter`," not a redesign.

### Tasks
- [ ] Build a comparison matrix across candidate partners: fee structure, chartered-bank vs. BaaS-with-sponsor-bank, state coverage, integration/API quality, minimum volume commitments, and time-to-sandbox-access
- [ ] Engage gaming/banking counsel specifically to verify the agent-of-payee / closed-loop-stored-value exemption in each Tier 1 launch state (strategy doc §2.3) — California's DFPI guidance is the only one confirmed in detail; do not assume it generalizes
- [ ] Confirm each candidate partner's contractual AML program requirements (strategy doc §3.3's "four-pillar" requirement: written policies, designated compliance officer, ongoing training, independent audit) — this affects Step 7's scope, not just Step 1's
- [ ] Select a partner and either execute a signed agreement or, as an interim step, obtain sandbox/developer API access under an LOI
- [ ] Record the decision as an ADR (e.g., `docs/decisions/0001-fbo-banking-partner.md`): options considered, why the chosen one won, known open risks (e.g., "agent-of-payee exemption unconfirmed outside CA as of [date]")
- [ ] File a tracked follow-up item (not part of this phase's coding tasks) for "implement `ColumnPaymentProviderAdapter`" (or whichever partner is chosen) once Step 2's interface exists

### Verification (manual, non-code)
- [ ] ADR exists and is committed
- [ ] Either a signed agreement is in place, or sandbox credentials have been obtained under an LOI, or the ADR explicitly records this as still open with a next-review date
- [ ] Counsel has confirmed (in writing, attached or linked from the ADR) the agent-of-payee exemption's applicability in at least the Tier 1 launch states

### Exit criteria
This step's exit criteria are decoupled from the rest of the phase's "done" definition:
- **For this phase's coding work:** not required to be complete — Steps 2–7 are considered done when they pass their own tests against the mock adapter.
- **For enabling real money movement in production:** a partner must be signed, a real adapter implementing Step 2's interface must exist (tracked separately, not a task in this phase), and counsel must have signed off state-by-state.

### Rollback
N/A — this is a business decision, not a code change. If a partner choice turns out to be wrong post-signing, that's a renegotiation/re-selection process, not a git revert. This is precisely why the adapter interface in Step 2 exists: to make that scenario a contained, single-implementation swap rather than an architecture change.

---

## Step 2 — Payment provider adapter interface + mock/sandbox implementation

**Model tier:** strongest (this interface is the seam every other step in this phase builds against — a mistake here propagates through Steps 3–8 and makes the eventual real-provider integration harder than it needs to be)
**Depends on:** Phase 1 (project scaffold)
**Parallel with:** Step 1

### Context brief
This is the abstraction that makes it possible to build this entire phase without a signed banking partner. The interface must capture the operations common across Column, Increase, Stripe Treasury, Trustly, and Sightline — account provisioning, deposit intents, payout/withdrawal intents, async transaction status, and balance reconciliation — without leaking any one provider's specific request/response shape into product code. Product code (Steps 4, 5, 6) must only ever call this interface, never a concrete implementation directly, so that swapping in a real provider later (once Step 1 closes) is a single new class, not a search-and-replace across the codebase.

### Tasks
- [ ] Write tests first (per TDD workflow) for a shared **adapter contract test suite** — a reusable set of behavioral tests any implementation (mock today, real provider later) must pass: e.g., "a successful deposit intent eventually resolves to a `completed` status with a matching amount," "a failed payout intent surfaces a typed error, not a thrown exception the caller has to guess at"
- [ ] Define the `PaymentProviderAdapter` interface in `src/payments/adapter.ts` (or similar) with, at minimum: `createFboSubAccount(userId)`, `initiateDeposit(userId, amountCents, method)`, `initiateWithdrawal(userId, amountCents, destination)`, `getTransactionStatus(transactionRef)`, `getFboPoolBalance()` (for Step 5's reconciliation job) — all amounts as integer cents, never floats
- [ ] Implement `MockPaymentProviderAdapter` — SQLite- or in-memory-backed, simulates realistic async behavior (deposits/withdrawals move through `pending` → `completed`/`failed` states, not instantaneously) and exposes configurable failure injection (decline a deposit, time out a payout) so error-handling paths are testable, not just happy paths
- [ ] Implement a webhook/callback simulation (a function the mock calls internally, or an endpoint the mock can be configured to hit) mirroring how a real provider notifies the platform of async status changes — this is the shape Step 5 and Step 6 will actually integrate against
- [ ] Add a short in-code doc comment on each interface method noting which real-provider concept it maps to (e.g., "conceptually maps to Column's Transfers API") — informational only, not a hard dependency
- [ ] Write a `docs/payments/adding-a-real-provider.md`-style note (or a README section) showing the contract test suite is what a real implementation must pass before it can replace the mock

### Verification
```bash
npm test -- payment-adapter
npm run lint
npm run typecheck
```

### Exit criteria
- `MockPaymentProviderAdapter` passes the full adapter contract test suite
- Failure-injection paths (declined deposit, timed-out withdrawal) have explicit tests, not just happy-path coverage
- No product code anywhere imports `MockPaymentProviderAdapter` directly outside of test setup / dependency-injection wiring — everything goes through the `PaymentProviderAdapter` interface type

### Rollback
Isolated module — safe to revert without affecting any other subsystem, since nothing outside this step exists yet to depend on it.

---

## Step 3 — Double-entry per-user, per-state transaction ledger

**Model tier:** strongest (this schema is the foundation Phase 5's tax compliance work builds directly on top of — get the shape right now; retrofitting a ledger schema after tax-reporting logic is built on top of it is far more expensive than doing it correctly here)
**Depends on:** Step 2
**Parallel with:** nothing (this is the single foundation Steps 4–8 all build on)

### Context brief
Strategy doc §3.2: state privilege-tax regimes tax **net revenue** (entry fees minus prizes) computed by player location **at time of entry**, not the address on file. Strategy doc §3.4 item 3 calls for "a real-time, per-user, per-state ledger: running annual net-profit-per-user... and running per-state net-gaming-revenue." This step builds that ledger as the single source of truth for all money movement in the product — every entry fee and every payout is a row here, and nothing else in the system should maintain its own separate "balance" number that could drift from it.

**This is explicitly the foundation Phase 5 (tax compliance: 1099-MISC/1099-K, backup withholding, per-state privilege tax filings) will build directly on top of.** That phase will need, without a schema migration: (a) a per-user running annual net profit figure to check against the 1099-MISC threshold, (b) per-state net-revenue aggregation for privilege-tax filings, (c) each transaction tagged with the state the player was actually in at the moment of that transaction. Build all three in now, even though this phase doesn't use them for tax filing yet — Phase 5 should be able to build purely additive tables (withholding records, 1099 filings) that reference this ledger by ID, not duplicate or restructure it.

Double-entry means every transaction is posted as a balanced set of entries (debits and credits summing to zero) inside a single DB transaction — never as a single mutable "balance" field. This also satisfies the user's global immutability preference at the data layer: ledger rows are append-only; corrections happen via new reversing entries, never `UPDATE`/`DELETE` on a posted row.

### Tasks
- [ ] Write tests first for the core invariant: `postDoubleEntryTransaction(entries[])` must reject any batch where entries don't sum to zero, and must post the entire batch atomically (all-or-nothing) inside a DB transaction
- [ ] Design the Drizzle schema for `ledger_entries`: `id`, `userId`, `contestId` (nullable — null for pure deposit/withdrawal entries), `entryType` (`entry_fee` | `prize_payout` | `deposit` | `withdrawal` | `adjustment` | `reversal` — an enum/config table, not a free-text string), `amountCents` (integer, never float), `direction` (`debit` | `credit`), `stateOfEntry` (required, 2-letter state code — sourced from a geolocation input parameter, not looked up from the user's profile), `providerTransactionRef` (nullable, links to Step 2 adapter transaction IDs), `taxYear` (derived from `createdAt`, stored explicitly so Phase 5 doesn't have to recompute it from timestamps later), `createdAt`
- [ ] Enforce append-only at the code layer: no update/delete function exists for `ledger_entries`; corrections are always a new `reversal` entry referencing the original by ID
- [ ] Implement `getUserBalance(userId): Promise<number>` computed by summing the user's ledger entries — never a separately cached/mutable balance column that can drift from the ledger
- [ ] Implement `getUserAnnualNetProfit(userId, taxYear): Promise<number>` (prizes − entry fees + bonuses, cumulative for the year) — used by this phase's UI now (e.g., showing a user their own activity), reused directly by Phase 5 for 1099-MISC threshold checks
- [ ] Implement `getStateNetRevenue(state, periodStart, periodEnd): Promise<number>` (in-state entry fees minus in-state prizes) — reused directly by Phase 5 for privilege-tax filings
- [ ] Table-driven tests: multi-state, multi-user seeded fixture proving per-user and per-state aggregation is correct; a test proving a reversal entry correctly nets out an erroneous original without deleting it

### Verification
```bash
npm test -- ledger
npm run lint
npm run typecheck
```

### Exit criteria
- Every posted transaction is provably balanced (debits = credits) via an automated test, and an unbalanced batch is rejected before any row is written
- No code path exists that updates or deletes a `ledger_entries` row — grep-verifiable (no `UPDATE`/`DELETE` against that table anywhere outside migration tooling)
- `getUserAnnualNetProfit` and `getStateNetRevenue` return correct values against a seeded multi-state, multi-user fixture
- A short checklist confirming schema readiness for Phase 5 is satisfied: `taxYear` present, `stateOfEntry` required (not nullable) on every entry, `entryType` distinguishes entry fees from payouts from deposits/withdrawals

### Rollback
Schema changes in this step are additive-only relative to Phase 1's DB. If a design mistake is found, correct it via a new migration — never rewrite or delete historical ledger rows, even in development, since that undermines the append-only guarantee the rest of the phase depends on.

---

## Step 4 — Entry-fee collection wired to the league-join / draft-join flow

**Model tier:** default
**Depends on:** Step 3
**Parallel with:** Step 6

### Context brief
Phase 1's Step 9 (public league matchmaking UI) built a join flow where stake tier is cosmetic/mock — no real money changes hands. This step makes it real: joining a paid contest debits the user's ledger balance. Critically, this flow calls **Step 3's ledger function, not Step 2's payment adapter directly** — entry-fee collection is an internal balance movement (the user's funds are already sitting in the FBO pool from a prior deposit, per Step 6), not a new external money movement. Only deposits and withdrawals touch the Step 2 adapter; joining a contest never does.

The join-and-debit action must be atomic — a user must never end up joined-but-uncharged, or charged-but-not-joined. Insufficient balance must block the join outright with a clear error; this product never extends credit or allows a negative balance.

**A scaling review found that single-request atomicity above is necessary but not sufficient — wrapping join+debit in one transaction prevents partial state within one request, but does nothing about two different requests racing each other.** Two distinct races exist and the existing idempotency guard (below) doesn't cover either of them, since it only stops the *same* user double-submitting: (a) two *different* users each read the league's fill count as "one seat left," both pass the capacity check, and both commit — overfilling a fixed-size league; (b) a user opens two joins to two *different* contests at the same instant, both read the same pre-debit balance, both pass the sufficient-balance check, and both commit — leaving the user's balance negative, which this product explicitly promises never happens.

### Tasks
- [ ] Write tests first for `collectEntryFee(userId, contestId, amountCents, stateOfEntry)`: posts a double-entry transaction (debit user, credit a contest-escrow ledger entity) via Step 3's `postDoubleEntryTransaction`
- [ ] Extend the join flow (from Phase 1's league/contest join) to call a balance check before allowing join; block with a specific, user-facing "insufficient balance" error rather than a generic failure
- [ ] Wrap "join contest" + "collect entry fee" in a single DB transaction so both succeed or both roll back together — no partial state
- [ ] Add an idempotency guard (e.g., a client-supplied idempotency key, or a uniqueness constraint on `(userId, contestId, entryType='entry_fee')`) so a double-click or network retry cannot double-charge
- [ ] **Lock league capacity during join — a review found the idempotency key above does nothing to stop two different users racing for the same last seat.** Fix: either `SELECT ... FOR UPDATE` on the league row before the seat-count check, inside the same transaction as the fee debit, or (simpler, and preferred where the schema allows it) an atomic `UPDATE leagues SET fill_count = fill_count + 1 WHERE id = $1 AND fill_count < max_teams`, treating zero-rows-affected as "league full" and aborting the join with the same user-facing capacity error
- [ ] **Lock the user's balance rollup row during the sufficient-balance check — a review found two concurrent joins to two different contests can otherwise both read the same pre-debit balance and both pass.** Fix: `SELECT ... FOR UPDATE` on the balance rollup row before the check, in the same transaction as the debit, plus a `CHECK (balance_cents >= 0)` constraint on the ledger/balance table as a backstop against any locking gap the code doesn't yet cover
- [ ] Tests: successful join with sufficient balance debits correctly and creates the roster/team entry; join attempt with insufficient balance is rejected with no ledger writes and no roster created; two concurrent join attempts for the same user/contest (simulated race) result in exactly one charge, not two
- [ ] **Concurrency test (league capacity):** seed a league with exactly N-1 open seats, fire N simultaneous join attempts from N different users, assert exactly N-1 succeed and the Nth is rejected with the "league full" error — never an overfilled league or a duplicated seat
- [ ] **Concurrency test (balance race):** seed a user with a balance sufficient for exactly one of two contests, fire simultaneous join attempts at both contests, assert exactly one join succeeds, the other is rejected as insufficient balance, and the user's resulting balance is never negative

### Verification
```bash
npm test -- entry-fee
npm run lint
npm run typecheck
```

### Exit criteria
- Joining a paid contest with sufficient balance atomically produces both a correctly balanced ledger debit and a joined roster
- Insufficient balance blocks the join with zero ledger writes and zero roster writes — verified by a test asserting no partial state
- A concurrency test proves double-submission cannot result in a double charge
- A concurrency test proves two different users racing for a league's last seat results in exactly one winner, with the league never overfilled
- A concurrency test proves two concurrent joins to different contests draining the same balance result in exactly one success, with the user's balance never negative — backed by the `CHECK (balance_cents >= 0)` constraint

### Rollback
Feature-flaggable: real entry-fee collection can be disabled, falling back to Phase 1's cosmetic/mock stake-tier join flow, without touching the Step 3 ledger schema.

---

## Step 5 — Prize-pool escrow and payout flow

**Model tier:** strongest (money-out is the highest-risk direction in this entire phase — an error here means real funds credited to the wrong user or released to a collusion-flagged account)
**Depends on:** Step 3, Step 4
**Parallel with:** Step 6 (different files; Step 7 later extends this step's payout gate)

### Context brief
Step 4 established a per-contest escrow ledger entity funded by entry fees. This step distributes that escrow to winners at contest/season settlement, and separately (via Step 2's adapter) moves funds out of the FBO pool when a user actually withdraws (Step 6 handles the user-initiated withdrawal UI; this step handles getting the *prize* into the winner's platform balance in the first place). Distinguish the two money movements clearly: crediting a winner's platform balance from escrow is a pure internal ledger operation (no Step 2 adapter call); only an eventual user-initiated withdrawal calls the adapter to send money outside the platform.

Per strategy doc §4.1 and Phase 3's integrity tooling, a collusion-flagged entrant's payout must be held for manual review, not auto-paid — settlement logic needs an explicit hook for this, not an afterthought. Per strategy doc §3.4 item 7, daily reconciliation between the ledger's view of the FBO pool and the actual (or, here, simulated) bank balance is both an operational safeguard and a contractual requirement of the banking relationship — build a first version of this now, in sandbox, so its logic and alerting are already proven before Step 1 closes.

**A scaling review found a second race at this same seam: a late join or a reversal racing concurrently with settlement can leave escrow non-zero** — e.g., a join commits (crediting escrow) after settlement has already read the entrant list and distributed the pool, or a reversal fires mid-settlement and its entries interleave incorrectly with the escrow debit. Fix: lock the contest row (`SELECT ... FOR UPDATE`) for the duration of settlement, so no join, reversal, or second concurrent settlement attempt can commit against that contest until the lock releases.

### Tasks
- [ ] Write tests first for `settleContestPayouts(contestId, payoutStructure)`: computes winner(s) and amounts from a **configurable** payout structure (e.g., winner-take-all, top-N split — defined in config/DB, not hardcoded percentages in code), posts double-entry transactions crediting each winner and debiting the contest escrow to exactly zero
- [ ] Implement the collusion-hold path: if a winning entrant is flagged by Phase 3's integrity tooling, their payout is posted to a `held_for_review` ledger state instead of being credited to their withdrawable balance — settlement for other, unflagged winners proceeds normally
- [ ] **Lock the contest row during settlement — a review found a late join or a reversal concurrent with settlement can otherwise leave escrow non-zero.** `SELECT ... FOR UPDATE` on the contest row for the full duration of `settleContestPayouts`, so a concurrent join (Step 4) or reversal targeting the same contest either blocks until the lock releases or is rejected as "contest is settling"
- [ ] Implement `reconcileLedgerToProvider()`: compares the ledger's aggregate internal balance to Step 2 adapter's `getFboPoolBalance()`, logs and alerts on any drift beyond a configurable tolerance (zero, in a correctly functioning sandbox — any drift is a bug to catch now)
- [ ] Build a payout-status surface (escrow-in / escrow-out / pending / held-for-review) — this is the "funds-in-escrow indicator" trust UI element the strategy doc calls for (§4), not just an internal admin view; Step 8 promotes this from a per-contest surface to also being reflected in a global, always-on indicator
- [ ] Tests: standard payout structures (winner-take-all, top-3 split) settle correctly against a seeded multi-entrant contest; a tie-handling test; a collusion-flagged winner is held, not paid, while other winners are paid normally; an intentionally injected drift is caught by the reconciliation job
- [ ] **Concurrency test:** fire a late join attempt at the same instant as settlement for the same contest, and assert one of two outcomes only — the join is rejected because the contest is settling, or the join fully completes (including its escrow credit) before settlement proceeds — never a state where settlement leaves escrow non-zero

### Verification
```bash
npm test -- payout
npm run lint
npm run typecheck
```

### Exit criteria
- A full contest-settlement test (seeded contest, multiple entrants, a known payout structure) results in an escrow debited to exactly zero and winners credited correctly
- A collusion-flagged entrant's payout is provably held rather than credited, without blocking other winners' payouts
- The reconciliation job correctly detects a deliberately injected balance drift in a test
- The concurrency test proves a late join or reversal racing with settlement never leaves escrow non-zero

### Rollback
Settlement is purely additive ledger entries (per Step 3's append-only rule) — an incorrect settlement is corrected via reversing entries referencing the erroneous ones, never by deleting or editing them.

---

## Step 6 — Deposit/withdrawal UI + risk-based staged KYC/CIP

**Model tier:** default for UI/plumbing; route through **security-reviewer** before merge given this step handles identity and financial data
**Depends on:** Step 2, Step 3
**Parallel with:** Step 4, Step 5

### Context brief
Before a user can hold a real balance, the platform needs a minimum viable Customer Identification Program (CIP) — this is distinct from the W-9/TIN tax collection in strategy doc §3.4 item 1, which is Phase 5's job; this step is about anti-money-laundering identity verification, not tax reporting. Like the banking partner in Step 1, a real identity-verification vendor (e.g., Persona, Alloy, Trulioo) is also a business decision that hasn't been made yet — so this step follows the same pattern as Step 2: build an `IdentityVerificationAdapter` interface with a mock/sandbox implementation, not a hardcoded call to a specific vendor's API.

Strategy doc §1.4 and §4 are explicit that this should be **risk-based and staged**, not maximal friction for every user: light verification (legal name, DOB, address, last-4 SSN) at the point a user first tries to hold a positive real balance or enter a paid contest — not forced on every signup regardless of whether they ever deposit. Deeper verification (full SSN/ID document, liveness check) is triggered only at a **configurable** large-withdrawal threshold, never hardcoded, and never applied indiscriminately.

### Tasks
- [ ] Write tests first for `IdentityVerificationAdapter` interface: `submitVerification(userId, identityData)`, `getVerificationStatus(userId)`, `escalateToEnhancedVerification(userId)`
- [ ] Implement `MockIdentityVerificationAdapter`: auto-approves standard test inputs, supports configurable rejection/pending states for testing both happy and unhappy paths
- [ ] Gate real-balance activity on light CIP: a user can browse/mock-play freely, but the first deposit attempt or first paid-contest join triggers a light-CIP collection step if not already on file — implement this as a guard, not a blanket signup requirement
- [ ] Build a configurable enhanced-verification threshold (stored in config/DB, not a hardcoded constant) — a withdrawal above this amount is blocked until enhanced verification (full ID + liveness) passes
- [ ] Build the deposit UI: amount entry → calls Step 2 adapter's `initiateDeposit` → on confirmed callback/webhook, posts a `deposit` ledger entry via Step 3
- [ ] Build the withdrawal UI: amount entry → balance check → threshold check (enhanced verification required above the configured threshold) → calls Step 2 adapter's `initiateWithdrawal` → posts a `withdrawal` ledger entry, shows pending/complete status
- [ ] Tests: a user with no CIP on file cannot reach a positive real balance; first deposit attempt correctly triggers light CIP; a withdrawal above the configured threshold is blocked pending enhanced verification; a withdrawal below the threshold proceeds with only light CIP on file

### Verification
```bash
npm test -- kyc
npm test -- deposit-withdrawal
npm run lint
npm run typecheck
npm run dev   # manual: walk through signup → light CIP → deposit → withdrawal-below-threshold → withdrawal-above-threshold
```

### Exit criteria
- A user cannot hold a positive real balance without completing light CIP — verified by a test, not just a UI gate
- A withdrawal above the configured enhanced-verification threshold is blocked in a test until that verification passes
- Deposit and withdrawal both produce correctly balanced Step 3 ledger entries end-to-end against the mock adapter
- No user is required to complete any CIP step before they ever attempt to deposit or join a paid contest (verifies the "light at signup" half of the risk-based principle)

### Rollback
Additive UI + adapter, independent of the core ledger/entry-fee logic — can be disabled via feature flag to fall back to Phase 1's no-KYC mock-balance mode.

---

## Step 7 — AML/OFAC sanctions screening adapter

**Model tier:** default; route through **security-reviewer** before merge (compliance-sensitive, handles identity data and gates real money release)
**Depends on:** Step 5, Step 6
**Parallel with:** Step 8 — different files (this step extends gating logic in Steps 5 and 6; Step 8 builds new UI reading Steps 3–6's existing state) and neither blocks the other

### Context brief
Strategy doc §3.3: "AML/OFAC screening... remain the operator's responsibility" regardless of the FBO structure — every banking partner will contractually require it. Strategy doc §3.4 items 4 and 8 call for OFAC status checks at every payout and continuous velocity/structuring monitoring, not a one-time signup check. Like Steps 2 and 6, the actual sanctions-screening vendor (e.g., ComplyAdvantage, LexisNexis, Trulioo) is an unmade business decision — build against an adapter interface with a mock/sandbox implementation, for the same reason.

Screening must run at **two** points, not one: at CIP completion (Step 6) and again at every payout (Step 5) — sanctions lists change over time, so a clean check at signup doesn't guarantee a clean check months later at a large payout.

### Tasks
- [ ] Write tests first for `SanctionsScreeningAdapter` interface: `screenIdentity(identity): Promise<ScreeningResult>`, `getScreeningStatus(screeningId)`
- [ ] Implement `MockSanctionsScreeningAdapter` with a small configurable test "watchlist" (a few fixed fake names/aliases that always flag as a hit) so both hit and no-hit code paths are testable deterministically
- [ ] Wire a screening call into Step 6's CIP-completion flow: a hit blocks account activation for real-balance activity and surfaces a manual-review state — never silently allows the account through
- [ ] Wire a second screening call into Step 5's payout settlement: a hit on a specific payout routes that payout into the `held_for_review` ledger state (reusing the same mechanism Step 5 built for collusion holds) rather than crediting the user — other unflagged payouts in the same settlement proceed normally
- [ ] Implement basic velocity/structuring detection using Step 3's ledger data: flag (not block — this needs human review) rapid sequences of deposits/withdrawals clustered just under the enhanced-verification threshold within a short window
- [ ] Implement an append-only screening audit log (who/what was screened, result, timestamp) — a real four-pillar AML program requires this, and Phase 5 will likely reuse it
- [ ] Tests: a known "hit" test identity is blocked at both CIP completion and at payout time; a clean test identity passes both checkpoints; a seeded structuring pattern trips the velocity flag; every screening call produces exactly one audit-log row, with no code path that can skip logging

### Verification
```bash
npm test -- sanctions-screening
npm run lint
npm run typecheck
```

### Exit criteria
- The mock adapter's test-watchlist identities are blocked at both CIP-completion and payout-time, verified by tests
- A clean test identity passes both checkpoints without friction
- A seeded structuring/velocity pattern is flagged (not silently missed) by the detection logic
- Every screening decision produces an audit-log entry — no code path bypasses logging, verified by test or by grep-level review

### Rollback
Additive adapter plus gating logic on top of Steps 5 and 6 — can be disabled via feature flag to fall back to "always mock-pass" for continued development, but that state must be clearly logged/labeled as non-production-safe, since disabling this step removes a contractually required control.

---

## Step 8 — Wallet & money-trust UX

**Model tier:** default (UI-heavy, low architectural risk — this step introduces no new money-movement logic; every figure and status it shows already exists in Steps 3–6's read APIs)
**Depends on:** Step 3, Step 4, Step 5, Step 6
**Parallel with:** Step 7 — different files (Step 7 extends gating logic in Steps 5 and 6; this step builds new UI reading their existing state) and neither blocks the other

### Context brief
A UX-completeness review found Phase 4 was "pure ledger engineering with a UI bolted on" — backend-correct, but with almost no designed user experience for what strategy doc §4 calls the highest-anxiety moment in the product: a real user watching their real money move. Four specific gaps, each addressed below: (1) no balance display is designed anywhere; (2) the strategy doc's "always-on escrow indicator... an always-on UI element" was reduced to a per-contest afterthought in Step 5; (3) only one withdrawal method is ever specified, directly contradicting the stated goal of beating Underdog's "no credit-card withdrawal" complaint; (4) staged KYC (Step 6) is a backend gate with no user-facing flow explaining why it's happening or what happens if it fails. This step is a UI/UX layer on top of Steps 3–6's existing read APIs — it introduces no new money-movement logic of its own; every number and status shown here already exists in the ledger (Step 3), payout/escrow status (Step 5), or KYC status (Step 6). Read `docs/design-system.md` (Phase 1 Step 1) first — every primitive here reuses those tokens/components, none are invented locally.

### Tasks
- [ ] **Persistent balance breakdown — a review found no balance display was designed anywhere.** Build a `WalletSummary` component, visible from any authenticated page as app chrome (not buried in a settings page): total balance, withdrawable balance, held-in-escrow (sum of open contest entries), and held-for-review (Step 5/7's `held_for_review` ledger state) — each figure computed from Step 3's `getUserBalance`/ledger queries directly, never a separately cached number that could drift. Each figure ships with a plain-language one-line explanation (e.g. "Held in escrow — entered in contests that haven't settled yet"), not a bare number
- [ ] **Global, always-on escrow indicator — a review found the strategy doc's "always-on UI element" had been reduced to a per-contest afterthought.** Promote it to persistent app chrome (e.g. a header badge showing total escrowed amount across all open contests), additive to — not a replacement for — the per-contest tracker below
- [ ] **Per-contest live prize-pool tracker** — surface Step 5's payout-status surface (escrow-in / escrow-out / pending / held-for-review) on each contest's own page, not just in an admin view, so a user watching their own contest sees the pool fill and settle in real time
- [ ] **Multiple withdrawal methods — a review found only one method was ever specified, directly contradicting the stated goal of beating Underdog's "no credit-card withdrawal" complaint.** Extend Step 6's withdrawal UI to offer at least two destination method types against the mock adapter (e.g. linked bank/ACH and debit card push), each showing its fee and estimated arrival time *before* the user commits — extend `MockPaymentProviderAdapter` (Step 2) to report method-specific fee/ETA if it doesn't already model that
- [ ] **Self-explaining KYC flow with a real rejection path — a review found staged KYC was a backend gate with no user-facing flow.** Build: a "why we're asking" screen shown before first collection, naming the legal reason in plain language (identity verification is required to hold a real balance, per AML regulation — never "we need more info"); a progress indicator across the light/enhanced stages; an explicit pending state showing expected completion time; and a rejection/appeal path — a rejected verification shows the reason (as far as the mock adapter can convey it) and a concrete next action (resubmit corrected info, contact support), never a dead end
- [ ] Loading/empty/error states for every surface above, per Phase 1's design-system standing rule — an empty wallet (no transactions yet), a failed balance load, and a KYC-pending state each need their own designed treatment, not a spinner or a blank screen
- [ ] Copy review pass: no raw ledger enum values (`held_for_review`, `entry_fee`), provider error codes, or other unexplained jargon surfaced directly to a user anywhere in this step's UI
- [ ] Component/integration tests for each surface: `WalletSummary` renders correct totals against a seeded multi-state ledger fixture; the global escrow indicator updates correctly when a contest is joined and when it settles; the withdrawal flow shows the correct fee/ETA per method before commit; the KYC flow correctly renders each of its states (not-started, pending, enhanced-required, rejected, approved)
- [ ] Accessibility + responsive pass per Phase 1's standing rule: automated a11y check, a keyboard-only walkthrough of the withdrawal and KYC flows specifically (the highest-stakes flows in the product), and correct rendering at the 360px minimum viewport

### Verification
```bash
npm test -- wallet-ux
npm run lint
npm run typecheck
npm run dev   # manual: walk through the balance breakdown, the global escrow indicator, a two-method withdrawal showing fee/ETA, and the full KYC "why we're asking" → pending → rejection/appeal flow
```

### Exit criteria
- `WalletSummary` correctly shows total/withdrawable/escrow/held-for-review against a seeded fixture, each with a plain-language explanation, verified by a test
- The global escrow indicator is reachable from every authenticated page and updates correctly on contest join/settle, verified by a test
- At least two withdrawal destination method types are selectable, each showing fee and ETA before commit, verified by a test
- The KYC flow renders a "why we're asking" explanation, a progress indicator, a pending state with expected-completion time, and a rejection/appeal state that offers a concrete next action — none of these states are a dead end, verified by a test for each state
- Automated a11y check and keyboard-only walkthrough pass for the withdrawal and KYC flows

### Rollback
Purely additive UI on top of Steps 3–6's existing read APIs and money-movement logic — reverting this step touches no ledger, escrow, payout, or KYC-gating logic, since it introduces none of its own.

---

## Post-Phase: What Actually Unblocks Real Money

Completing Steps 2–8 against the mock/sandbox adapters proves the product, ledger, and wallet-UX logic is correct — it does **not** mean the platform can move real money. Real go-live additionally requires, outside this phase's scope:

1. Step 1 closing: a signed banking/BaaS partner, with counsel-confirmed agent-of-payee exemption coverage in each launch state.
2. A real `PaymentProviderAdapter` implementation for the chosen partner, passing Step 2's existing contract test suite.
3. A real `IdentityVerificationAdapter` implementation for a chosen KYC/CIP vendor, and a real `SanctionsScreeningAdapter` implementation for a chosen AML/OFAC vendor — both are separate vendor decisions from Step 1's banking partner and are not assumed to resolve on the same timeline.
4. Phase 5 (tax compliance) building on top of this phase's ledger: W-9/TIN collection, automated backup withholding, and 1099-MISC/1099-K generation — deliberately deferred, but unblocked by design because Step 3's ledger schema already carries `taxYear`, per-user net-profit aggregation, and required `stateOfEntry` on every row.
