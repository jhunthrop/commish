# Phase 4 — Money foundations: the ledger, the seam, and the doors money walks through

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the money core of a real-money season-long fantasy platform without moving a real dollar: an append-only double-entry money ledger that is the book of record for a pooled FBO account, a `PaymentsProvider` seam with a mock that models the failure the industry actually eats (an ACH deposit that succeeds and then reverses days later), entry fees wired into the join paths that already exist, refunds wired into the release and dissolution paths, an operator-triggered season payout against a published prize table, a KYC-before-deposit gate, a state-enablement config that ships **empty**, and a wallet in the account room. Every league stays free until the founder names a launch state with counsel: **money ships dark**, and a free league never touches the ledger at all.

**Architecture:** Two seams, exactly as the dossier draws them. **Seam A, `PaymentsProvider`** (`src/payments-provider/`), covers external money motion only — deposits, withdrawals, their async status changes — mirroring the `STATS_PROVIDER` machinery (`src/stats/registry.ts`): a fail-fast registry selects the implementation from env, and one adversarial contract suite runs against every implementation including the mock. **Seam B, the internal money ledger** (`src/money/` pure vocabulary + `src/money-service/` Postgres writers), covers everything else: entry fee, escrow, prize, refund, rake are internal double-entry postings that never cross Seam A. The ledger is append-only with trigger-enforced immutability (the audit chain's migration-0021 precedent), every row carries `stateOfEntry` and `taxYear`, and every money writer appends to the audit chain **in the same transaction**, anchor last, leagues first, per the two standing lock laws. KYC is its own narrow interface (`KycProvider`) inside the same seam directory — argued in ruling 4. The word "ledger" never appears in a module or table name, because `src/stats-pipeline/budget.ts` already owns that word for API budgets (dossier §1.1): the family is **money** — `money_accounts`, `money_entries`, `money_transactions`.

**Tech Stack:** Unchanged. TypeScript strict · Next.js 15 App Router · React 19 · Drizzle ORM over Postgres 17 (`drizzle-orm/postgres-js`) through PgBouncer in transaction mode · Redis 7 (Streams → SSE) · WorkOS AuthKit (authn only — WorkOS is not a KYC vendor) · Zod v4 · Vitest · Playwright. **This plan adds no runtime dependency**: no provider SDK is installed until the founder signs a partner (founder decision 2), which is the whole point of the seam.

**Spec:** `docs/research/2026-08-24-phase4-payments-research.md` (the payments dossier: seam audit §1, provider landscape §2, two-seam design §3, compliance split §4, founder questions §5), together with the ten founder decisions recorded 2026-08-24 and restated verbatim below. **This plan supersedes `plans/phase-4-payments.md`** (the old 8-step sketch); the supersession table near the bottom maps every sketch step to its fate.

**Depends on Phase 3.6 merged to `main`** — the design pass (`2026-08-23-phase3p6-design-v2.md`) and its addendum. It builds directly on those surfaces: the `(shell)` layout, `Panel`/`Meter`/`StatPill`, the seat hold, roll-until-full, seat release, and the account room. Nothing here regresses their behavior.

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied from the codebase's own rules and from verification policy v4, restated in full.

**Verification policy v4 (supersedes the per-step full battery older plans carried):**

- **Per-task verification is changed-files scope:** `npm test -- <changed directories>` plus `npm run typecheck && npm run lint`. Never the full suite per task.
- **`npm run build` only when the task changes routes, layouts, middleware, or config** (Tasks 5, 6, 9, 10, 12, 13 here).
- **e2e only at cluster checkpoints, and only the specs that walk touched surfaces:** checkpoint 1 after Task 11 (`league-lifecycle`, `formats-and-lobby` — the join path moved under them), checkpoint 2 after Task 13 (`whole-site`, `mobile-360`, `design-v2`, plus the new `money-dark` spec). The closing battery in Task 14 is the one full pass.
- **TDD per task: the failing test is Step 1 of every task**, and refusal paths of any transaction that has written anything get the no-write-took-place helper class (`expectNoPostingTookPlace`, `expectNoSettlementTookPlace`, `expectNoDissolutionTookPlace` here), asserted on **every** refusal path of their writer.

**From `docs/conventions.md` (the standing laws that bind money hardest):**

- **The global lock law:** any transaction touching `leagues` + `drafts` takes the `leagues` row lock FIRST, as its own statement. **Every money transaction that touches a league** (entry fee, refund, dissolution, settlement) therefore opens with `leagues[id] FOR UPDATE` before any money row — `joinLeagueInTx` (`src/league-service/join.ts:91-99`) is the documented shape to extend, not replace.
- **The audit law (ruling 4):** `AuditLogger.record(tx, input)` in the same transaction as the business write; an append failure FAILS the money transaction — no catch, no best-effort (`src/integrity-service/audit-logger.ts:85-95`).
- **The anchor law (ruling 3):** the chain anchor is the LAST lock a transaction takes, and "lock" includes implicit `FOR KEY SHARE` from FK references. Money's order is therefore: **leagues row (if any) → business rows → money rollup rows (sorted, see Task 3) → chain anchor**. Every money writer enumerates its FK lock acquisitions by name in its own docblock, and `src/integrity-service/lock-order.test.ts` grows one entry per writer — the executing task reads the suite's current count off the file, never off this plan.
- **PgBouncer transaction pooling forbids advisory locks and session state.** Exclusion comes from row locks and guarded writes only.
- **Immutability:** domain types `readonly`; `src/domain/**` is enforced by `eslint-plugin-functional`. Money vocabulary is `as const` tuples with unions derived from them.
- **Timing:** no ambient clock. Every money writer takes a `Clock` (`src/domain/timing.ts`); `taxYear` is derived from `clock.now()` at the write and stored.
- **Identity:** server code reads "who is this" only via `getCurrentUser()`/`requireCurrentUser()`. Amounts and account ids are always resolved server-side; a request body never names an account id.
- **Client boundary:** `src/account-room/**` and the other room directories talk to services only over the wire. `src/money` joins the pure exempt directory list (ruling 3 below); `src/money-service` and `src/payments-provider` join the banned value-import list.
- **API envelope:** every JSON route returns `{ ok: true, data }` or `{ ok: false, error }` via `src/lib/api/respond.ts`; bodies parse with `parseJson(request, ZodSchema)`; error strings are user-facing plain language.
- **Config over magic numbers:** every ceiling, floor, threshold and key format in this plan lives in `MONEY_CONFIG` or `MONEY_STATES` (`src/money/config.ts`, `src/money/states.ts`), never inline.
- **Tests beside the code**, integration tests against the real docker-compose Postgres/Redis (`createTestDb()` + `truncateAll(db)`), `fileParallelism: false`.
- **Coverage:** the gate list in `vitest.config.mts` holds 21 directories today (counted off the file). This plan adds **three gates**: `src/money/**`, `src/money-service/**`, `src/payments-provider/**`, each with `include` AND a `thresholds` block at 100%.
- **Migrations:** the latest is `drizzle/0034_roll_until_full.sql`; this plan ships `0035_money_foundations.sql` and `0036_money_audit_events.sql`. `ADD COLUMN … NOT NULL` without DEFAULT only while the table is empty; nothing uses `CONCURRENTLY`.
- **Commits:** conventional commits, one per completed step, bodies explain why.
- **Environment:** this plan adds two env vars, `PAYMENTS_PROVIDER` and `KYC_PROVIDER` (both default `mock` via `envOr` — `src/lib/env.ts`'s empty-string rule), documented in `.env.example`.

**From `docs/design-system.md` and the copy rulebook:**

- No raw hex, no raw px; tokens only. Both themes are first-class: every new component's tests run through `renderSurface` and its light pairing is designed, not inherited.
- **Copy:** no contractions (the one recorded exception is the just-seated "You're in"), no em or en dashes, active voice, nothing in `INTEGRITY_CONFIG.notices.accusatoryTerms` or `passiveConstructions`. The five copy sweeps enforce this; every new component joins `src/integrity/rendered-copy.test.tsx`'s roster in the task that creates it. Money errors say what happened to the money, first: *"Your deposit did not go through. No money left your bank account."*
- Never a dead end: every refusal state offers an action.
- Mobile-first, 360px minimum, WCAG 2.2 AA.

**Founder rules (binding):** no MVP — end-state architecture from day one; centralize UI primitives the first time; persona-panel pass on every new user-facing surface; no mock data on real surfaces (a wallet figure is a ledger query or it does not render); verification agents never write review artifacts and never commit.

---

## Founder decisions (recorded 2026-08-24 — these bind verbatim)

1. **Custody:** custodial FBO wallet. Players hold balances; one pooled FBO account at a partner bank; **our double-entry ledger is the book of record.**
2. **FBO partner:** pursue **Column** first. **NO signature or spend in this phase without founder approval** — bank integration lands as a provider implementation behind the seam, gated.
3. **Rails:** BOTH — Aeropay-class pay-by-bank AND a gaming-gateway merchant application for cards (**Paysafe first, Nuvei alternate**), application started at phase kickoff because underwriting is the long pole.
4. **Cards at launch:** yes, gated on underwriting clearing; launch opens pay-by-bank-only if it has not.
5. **PayPal:** skip.
6. **Tax stack:** build on our ledger. Phase 5 consumes it; Phase 4 only guarantees every row carries `stateOfEntry` and `taxYear` and the 1099 threshold query is answerable.
7. **States:** build the state-enablement config mechanism now, **EMPTY BY DEFAULT.** No state is enabled anywhere until the founder names the list with counsel.
8. **Entry-fee ceiling:** $500 per seat, as config not constant.
9. **Proration:** none. Prizes fixed in advance.
10. **Rake:** fixed platform fee per entry beside a published prize table; **NEVER percent-of-pool** (UIGEA posture). Card-deposit fee treatment (eat vs surface, with pay-by-bank free) is an **OPEN QUESTION** this plan models with numbers and presents to the founder — it does not decide it.

---

## What is already true (read before touching anything)

Checked against this worktree (Phase 3.6 merged). Each row was verified by reading the file named.

| The dossier or sketch assumes | Reality in the code today |
|---|---|
| A payments module exists to extend | **Nothing money-real exists, by design.** `PaymentsProvider` has zero hits in `src/`; the only "ledger" is the Tank01 budget ledger (`src/stats-pipeline/budget.ts`), which is why the money family is named `money_*` throughout this plan. |
| The audit union has 19 events | **It has 16** (`src/domain/audit.ts:12-51`, counted: `league_created` through `review_removed`). The dossier's 19 is stale; this plan's additions are counted against the real file. |
| The audit enum can simply grow | **It is a pg enum** (`src/db/schema.ts:44`, `pgEnum("audit_event_type", AUDIT_EVENT_TYPES)`) that Phase 3 froze by ruling and Phase 3.6 honored via payload outcomes (its ruling 25). Growing it is a phase-level decision with its own migration — argued in ruling 2 below, shipped as `0036` with `ALTER TYPE … ADD VALUE`. |
| Entry fees hook a generic join | **The join transaction is already exactly the right shape.** `joinLeagueInTx` (`src/league-service/join.ts`) opens with `leagues[X] FOR UPDATE`, runs path preconditions inside the transaction, consumes seat holds (`holdOutcome`, Phase 3.6 Task 6), fires `fireWhenFullInTx`, and reaches the audit anchor last. `collectEntryFeeInTx` slots in as one more in-transaction step (Task 8), not a wrapper. |
| Refund-on-dissolution has a dissolution to bind to | **No dissolution path exists.** Phase 3.6 ruling 16 says so in as many words ("cancelling a league, which nothing in this product can do"). The roll is uncapped and the seat release is the member's own door out (`src/league-service/release.ts`, `RELEASE_REFUSALS`). Task 9 therefore **creates** operator-triggered dissolution, because a paid league that can wait forever holding twelve entry fees with no refund path is not shippable. |
| Stake tiers carry money | **Cosmetic only, one disclosure sentence.** `MATCHMAKING_CONFIG.stakeTiers` and `stakeDisclosure` (`src/matchmaking/config.ts:38-45`), consumed by `src/matchmaking/contract.ts:79-80` ("Never an amount of money"), `src/league/terms.ts:227-228`, `src/league-service/schemas.ts:79-83`. Task 13 maps tier → fee band at creation and rewrites the disclosure **only when money is live in some state**. |
| The free season is a banner | **It is a tested sentence:** "Every league is free this season." (`src/league-room/components/front-door-hero.tsx:23`, asserted in `front-door-hero.test.tsx:11` and `src/app/front-door.test.tsx:39`). Task 13 derives it from `moneyIsLive()` so the sentence and the config cannot disagree. |
| A wallet surface exists | **The account room exists and the wallet does not.** `src/account-room/components/` holds profile, avatar, notices, reviews, standing, theme-switcher; the shell page is `src/app/app/(shell)/profile/page.tsx`. Task 12 adds `/app/wallet` inside the `(shell)` group. |
| The seam pattern must be invented | **It ships twice already.** `getCurrentUser()` (`src/lib/auth/current-user.ts:28`) is the interface habit; `createStatsProvider` (`src/stats/registry.ts`) is the full machinery — fail-fast unknown-name error class, env selection via `envOr`, contract suite against every implementation. Tasks 4 and 7 copy it, not just its shape. |
| Collusion holds need a store | **`raiseFlag`/`resolveFlag` exist** (`src/integrity-service/flags.ts`), one-way resolution included. Settlement (Task 10) reads open flags; it does not build a flag system. |
| Coverage and locks are frozen counts | **21 coverage gates** in `vitest.config.mts` (counted); the lock-order suite has grown every phase — Task 3 and every writer task read the current entry count off `src/integrity-service/lock-order.test.ts` before adding theirs. Migrations end at `0034`. The e2e suite is 12 spec files; Task 13 reads the test count off `playwright` output, not off this plan. |

---

## File Structure

**New — pure, browser-safe (`src/money/`, coverage-gated, joins the exempt pure directory list as its ninth member — ruling 3):**

| File | Responsibility |
|---|---|
| `src/money/config.ts` | `MONEY_CONFIG`: entry-fee ceiling ($500 → `50_000` cents), deposit/withdrawal bounds, 1099 thresholds by tax year, account-id formats, refusal sentences shared with the browser. |
| `src/money/states.ts` | `MONEY_STATES`: `enabled: []` (EMPTY — founder decision 7), `neverEligible` (HI ID MT NV WA), the CA counsel note, `minAge` carried per enabled entry so a state cannot be enabled without stating its age. `moneyIsLive()`. |
| `src/money/accounts.ts` | The account vocabulary: `MoneyAccountKind` tuple, asset/liability side per kind, `accountIdFor(...)` builders and parser. |
| `src/money/posting.ts` | Pure posting arithmetic: `MoneyPosting`, `balancedOrRefuse(entries)`, `signedBalance(side, debits, credits)`, cents formatting (`formatUsd`). |
| `src/money/prize-table.ts` | `PrizeTable`, `prizeTableInvariant(feeCents, platformFeeCents, teamCount, table)` — sum(prizes) + fee×seats-of-rake must equal pot exactly (founder decision 10, UIGEA §4.6). Browser-safe so the creation form and the server enforce one rule. |

**New — server-only ledger (`src/money-service/`, coverage-gated, joins the banned value-import list):**

| File | Responsibility |
|---|---|
| `src/money-service/post.ts` | `postMoneyTransaction(tx, input)` — the ONE writer of `money_entries`. Balanced set, sorted rollup locks, audit append in-transaction. |
| `src/money-service/read.ts` | `walletSummary`, `accountBalance`, `getUserAnnualNetProfit(userId, taxYear)` — the Phase 5 guarantee. |
| `src/money-service/deposits.ts` | Deposit initiation, completion, and the ACH-return posting including the `platform_receivable` shortfall path. |
| `src/money-service/withdrawals.ts` | Withdrawal request/completion/return/failure postings. |
| `src/money-service/entry-fee.ts` | `collectEntryFeeInTx`, `refundEntryFeeInTx` — called inside `joinLeagueInTx` / `releaseSeat` transactions. |
| `src/money-service/dissolution.ts` | `dissolveLeague` — operator action, pre-draft only, refunds every seat. |
| `src/money-service/settlement.ts` | `settleSeasonPayouts` — operator-triggered, prize-table input, collusion holds, rake sweep, escrow to zero. `releaseHold`/`confiscateHold`. |
| `src/money-service/reconcile.ts` | `reconcileMoney(db, provider)` — ledger `fbo_pool` vs `getPooledBalanceCents()`. |
| `src/money-service/gates.ts` | The three door guards every money entrance shares: state enablement, KYC, self-exclusion. |
| `src/money-service/schemas.ts` | Zod v4 request schemas, bounds derived from `MONEY_CONFIG`, never retyped. |

**New — Seam A (`src/payments-provider/`, coverage-gated, banned value-import):**

| File | Responsibility |
|---|---|
| `contract.ts` | `PaymentsProvider` interface, `TransferIntent`, `TransferStatus` (`pending / completed / failed / returned`), `MethodDescriptor`. |
| `config.ts` | `PAYMENTS_PROVIDER_CONFIG`: env var names, provider name tuple (`mock` only this phase), webhook signature header name. |
| `registry.ts` | `createPaymentsProvider()` — fail-fast `UnknownPaymentsProviderError`, mirroring `src/stats/registry.ts`. |
| `mock/mock-payments-provider.ts` | Pending→terminal transitions on an injected clock, injectable failures, **and returns-after-completion** (the R01/R10 class). |
| `contract-suite.ts` | The adversarial suite every implementation must pass, mock included. ACH-return modeling is a mandatory case. |
| `kyc-contract.ts`, `kyc-registry.ts`, `mock/mock-kyc-provider.ts` | The `KycProvider` narrow seam (ruling 4) with the same registry machinery. |
| `ingest.ts` | The ONE ingestion point translating provider callbacks into typed internal events, consumed by the webhook route. |

**Modified:** `src/db/schema.ts` (money tables, `users.kyc_status`/`self_excluded_at`, `leagues.entry_fee_cents`/`platform_fee_cents`/`payout_table`), `src/domain/audit.ts` (ten money events), `src/integrity/system-actions.ts` (+`league_dissolved`), `src/integrity/notices.ts` (dissolution + refund templates), `src/integrity-service/lock-order.test.ts` (one entry per money writer), `src/league-service/join.ts`, `release.ts`, `creation.ts`, `schemas.ts`, `src/matchmaking/config.ts` + `contract.ts`, `src/league/terms.ts`, `src/league-room/components/front-door-hero.tsx`, `src/account-room/contract.ts`, `vitest.config.mts` (three gates), `.env.example`, `eslint` boundary config.

**New routes:** `src/app/app/(shell)/wallet/page.tsx`, `src/app/api/wallet/route.ts` (GET), `src/app/api/wallet/deposits/route.ts` (POST), `src/app/api/wallet/withdrawals/route.ts` (POST), `src/app/api/wallet/kyc/route.ts` (POST), `src/app/api/wallet/exclusion/route.ts` (POST), `src/app/api/payments/webhook/route.ts` (POST, signature-checked), `src/app/api/admin/leagues/[leagueId]/dissolve/route.ts`, `src/app/api/admin/leagues/[leagueId]/settle/route.ts`, `src/app/api/admin/holds/[userId]/route.ts`.

**New migrations:** `drizzle/0035_money_foundations.sql`, `drizzle/0036_money_audit_events.sql`.

**New docs:** `docs/decisions/money-foundations.md`, `docs/money.md`. **New e2e:** `e2e/money-dark.spec.ts`.

---

## Task 1: The money vocabulary, pure and browser-safe

Everything downstream imports its words from here. Pure on purpose: the wallet's sentence, the creation form's fee ceiling and the server's enforcement must be the same values, which is the same argument that put the roll's vocabulary in `src/matchmaking`.

**Files:**
- Create: `src/money/config.ts`, `states.ts`, `accounts.ts`, `posting.ts`, `prize-table.ts` (+ tests for each)
- Modify: `vitest.config.mts` (gate `src/money/**`), the eslint boundary config (ninth pure exempt directory), `docs/conventions.md` (both lists)

**Interfaces:**
- Consumes: nothing but TypeScript.
- Produces: `MONEY_CONFIG`, `MONEY_STATES`, `moneyIsLive`, `MoneyAccountKind`, `accountIdFor`, `MoneyPosting`, `balancedOrRefuse`, `PrizeTable`, `prizeTableInvariant`, `formatUsd`, `MONEY_REFUSALS`.

- [ ] **Step 1: Write the failing vocabulary tests**

```ts
// src/money/states.test.ts
it("ships with no state enabled, so money is dark until the founder names a list with counsel", () => {
  expect(MONEY_STATES.enabled).toHaveLength(0);
  expect(moneyIsLive()).toBe(false);
});

it("cannot enable a state without stating its minimum age", () => {
  // The entry shape is { state, minAge }, so the compiler is the enforcement. This test pins
  // the runtime half: the never-eligible five refuse membership even if typed in.
  for (const s of MONEY_STATES.neverEligible) {
    expect(() => assertEnableable(s)).toThrow(/has never permitted paid fantasy/);
  }
});

// src/money/posting.test.ts
it("refuses any posting set whose debits and credits do not match to the cent", () => {
  const out = balancedOrRefuse([
    { accountId: "user_available:u1", direction: "debit", amountCents: 1000 },
    { accountId: "league_escrow:lg1", direction: "credit", amountCents: 999 },
  ]);
  expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.unbalanced });
});

it("refuses a zero or negative amount before it ever reaches Postgres", () => {
  expect(balancedOrRefuse([{ accountId: "user_available:u1", direction: "debit", amountCents: 0 }]).ok).toBe(false);
});

// src/money/prize-table.test.ts
it("accepts only a table where prizes plus rake equal the pot exactly, never approximately", () => {
  // fee 2000c x 12 seats = 24000c pot; rake 200c x 12 = 2400c; prizes must sum to 21600c.
  const table = [{ place: 1, amountCents: 12_000 }, { place: 2, amountCents: 6_600 }, { place: 3, amountCents: 3_000 }];
  expect(prizeTableInvariant(2000, 200, 12, table)).toEqual({ ok: true });
  expect(prizeTableInvariant(2000, 200, 12, [{ place: 1, amountCents: 21_601 }]).ok).toBe(false);
});
```

- [ ] **Step 2: `MONEY_CONFIG` — every number a docblock defends**

```ts
export const MONEY_CONFIG = {
  /** Founder decision 8: $500 per seat, config not constant. */
  entryFeeCeilingCents: 50_000,
  deposit: { minCents: 5_00, maxPerTransferCents: 1_000_00 },
  withdrawal: { minCents: 5_00 },
  /**
   * Founder decision 6 / Phase 5's "Assumed Phase 4 interface": the threshold the ledger must
   * be able to answer, versioned by tax year because it is already legislation-sensitive
   * (strategy §3.1: $600 TY2025, $2,000 TY2026+). Phase 5 files; Phase 4 only answers.
   */
  reportingThresholdCentsByTaxYear: { 2025: 600_00, 2026: 2_000_00 } as const,
  /** How far ledger-vs-bank may drift before the reconcile check alarms: zero. Any drift is a bug. */
  reconcileToleranceCents: 0,
} as const;
```

- [ ] **Step 3: The account vocabulary**

`MoneyAccountKind` is a `readonly` tuple: `fbo_pool`, `provider_clearing`, `platform_receivable`, `user_available`, `league_escrow`, `held_for_review`, `platform_rake`, `platform_forfeiture`. `accountSide(kind)` maps `fbo_pool` and `platform_receivable` to `asset`, the rest to `liability`; balance is `debits − credits` for assets and `credits − debits` for liabilities, and `signedBalance` is the one function that knows that. `accountIdFor` builds `user_available:<userId>`, `league_escrow:<leagueId>`, `held_for_review:<userId>`, `platform_receivable:<userId>` and the four singletons; the parser round-trips, tested property-style over the builders.

- [ ] **Step 4: `MONEY_STATES` and `moneyIsLive`**

`enabled: readonly { state: StateCode; minAge: number }[]` — **empty**. `neverEligible: ["HI", "ID", "MT", "NV", "WA"]` with the dossier citation in the docblock, and the CA note verbatim: CA is not on either list; the 2025 AG opinion reached DFS and explicitly not season-long, and counsel must reconcile that with the DFPI agent-of-payee guidance before CA is ever enabled (Phase 8 item 1). `moneyIsLive()` is `MONEY_STATES.enabled.length > 0`, and it is the single switch the whole phase ships dark behind.

- [ ] **Step 5: Wire the gate and the exempt list; commit**

Add the `src/money/**` 100% gate to `vitest.config.mts`; add `src/money` as the ninth pure exempt directory in the boundary lint config with the same justification the other eight carry (pure, no I/O, no clock); record both in `docs/conventions.md`.

---

## Task 2: The money schema — append-only by trigger, not by promise

**Files:**
- Create: `drizzle/0035_money_foundations.sql`, `drizzle/0036_money_audit_events.sql`
- Modify: `src/db/schema.ts`, `src/domain/audit.ts`, `src/db/index-plans.test.ts`

**Interfaces:**
- Consumes: `AUDIT_EVENT_TYPES`, `MoneyAccountKind`.
- Produces: `moneyAccounts`, `moneyTransactions`, `moneyEntries` tables; ten new `AuditEventType` members.

- [ ] **Step 1: Write the failing immutability tests**

```ts
// src/money-service/schema-invariants.test.ts (integration, real Postgres)
it("refuses UPDATE and DELETE on money_entries at the database, not just in code", async () => {
  await seedOnePosting(db);
  await expect(db.execute(sql`UPDATE money_entries SET amount_cents = 1`)).rejects.toThrow(/append.only/i);
  await expect(db.execute(sql`DELETE FROM money_entries`)).rejects.toThrow(/append.only/i);
});

it("refuses a negative balance on any liability rollup at the database", async () => {
  await expect(
    db.execute(sql`UPDATE money_accounts SET balance_cents = -1 WHERE kind = 'user_available'`),
  ).rejects.toThrow(/check/i);
});
```

- [ ] **Step 2: The three tables**

`money_accounts` — `id text PK` (the vocabulary key, e.g. `user_available:usr_x`), `kind money_account_kind NOT NULL`, `owner_id text NULL` (user or league id; NULL for singletons), `balance_cents bigint NOT NULL DEFAULT 0`, `created_at`. The rollup row exists **solely to be `SELECT … FOR UPDATE`d**; `CHECK (balance_cents >= 0 OR kind IN ('fbo_pool','provider_clearing','platform_receivable'))` backstops the sufficient-balance check (assets and clearing may swing; no player-facing liability ever goes negative — the ACH-return shortfall goes to `platform_receivable` instead, ruling 5).

`money_transactions` — `id`, `kind money_txn_kind NOT NULL` (`deposit`, `deposit_return`, `withdrawal_request`, `withdrawal_complete`, `withdrawal_return`, `withdrawal_fail`, `entry_fee`, `entry_fee_refund`, `settlement`, `hold_release`, `hold_confiscation`, `receivable_settlement`), `league_id text NULL` (no FK — the audit chain's ruling-7 precedent: money history must survive anything), `provider_transfer_ref text NULL`, `idempotency_key text NULL UNIQUE`, `created_at`.

`money_entries` — `id`, `transaction_id` FK → `money_transactions`, `account_id` FK → `money_accounts`, `direction money_direction NOT NULL`, `amount_cents bigint NOT NULL CHECK (amount_cents > 0)`, `state_of_entry char(2) NOT NULL`, `tax_year int NOT NULL`, `created_at`. **`state_of_entry` and `tax_year` are NOT NULL on every row** — founder decision 6, and the whole of what Phase 5 assumes.

Migration `0035` creates all three plus the two triggers (`money_entries_append_only`, `money_transactions_append_only`) copied from the migration-0021 audit-chain precedent (`RAISE EXCEPTION 'money_entries is append-only'`), plus `users.kyc_status kyc_status NOT NULL DEFAULT 'none'`, `users.self_excluded_at timestamptz NULL`, `leagues.entry_fee_cents int NOT NULL DEFAULT 0`, `leagues.platform_fee_cents int NOT NULL DEFAULT 0`, `leagues.payout_table jsonb NULL`. Indexes: `money_entries (account_id, created_at)`, `money_entries (tax_year, state_of_entry)`, `money_transactions (league_id)` — each added to `src/db/index-plans.test.ts` with the query it serves.

- [ ] **Step 3: The audit union grows by ten, in its own migration**

`src/domain/audit.ts` gains, with per-event docblocks naming their publisher task: `deposit_completed`, `deposit_returned`, `withdrawal_requested`, `withdrawal_completed`, `withdrawal_returned`, `entry_fee_collected`, `entry_fee_refunded`, `prize_paid`, `payout_held`, `payout_released`. **The dossier named eight; the shipped list is ten** — `deposit_returned` and `withdrawal_returned` are added because the ACH-return class is this plan's mandatory failure model and a return riding a `*_completed` payload would hide the one event an auditor most wants to find (ruling 2 argues the enum change itself). Migration `0036` is `ALTER TYPE "audit_event_type" ADD VALUE '<each>';` — its own file because an added enum value must not be used by the migration that adds it. League-scoped: `entry_fee_*`, `prize_paid`, `payout_*` (they ride the league chain). Platform-scoped: `deposit_*`, `withdrawal_*` (per-user money is nobody else's feed).

- [ ] **Step 4: Commit** (migration forward-applied against a cold `npm run infra:up` stack first).

---

## Task 3: `postMoneyTransaction` — one writer, four laws

Every money movement in the product goes through this function or it does not happen. It is deliberately boring: the interesting decisions (what to post) live in Tasks 5-10; this task owns *how* a posting becomes rows without deadlocks, drift, or an unaudited hole.

**Files:**
- Create: `src/money-service/post.ts`, `read.ts`, `test-support.ts` (+ tests)
- Modify: `src/integrity-service/lock-order.test.ts`, `vitest.config.mts` (gate `src/money-service/**`), eslint boundary config, `docs/conventions.md`

**Interfaces:**
- Consumes: `DbTx`, `AuditLogger`, `balancedOrRefuse`, `accountSide`, `Clock`.
- Produces: `postMoneyTransaction`, `walletSummary`, `getUserAnnualNetProfit`, `expectNoPostingTookPlace`.

- [ ] **Step 1: Write the failing writer tests**

```ts
it("locks rollup rows in sorted account-id order, so two transactions touching the same pair cannot deadlock", async () => {
  // Two concurrent postings, opposite account orders in their input. Both must complete.
  await Promise.all([
    withTx((tx) => postMoneyTransaction(tx, feePosting("u1", "lg1"), deps)),
    withTx((tx) => postMoneyTransaction(tx, refundPosting("lg1", "u1"), deps)),
  ]);
});

it("fails the whole transaction when the audit append fails, leaving no money rows behind", async () => {
  const failing = { ...deps, audit: alwaysFailingAuditLogger };
  await expect(withTx((tx) => postMoneyTransaction(tx, feePosting("u1", "lg1"), failing))).rejects.toThrow();
  await expectNoPostingTookPlace(db);
});

it("keeps the books balanced: assets equal liabilities after any sequence of postings", async () => {
  await runSeededPostingSequence(db); // deposit, fee, refund, settlement, return — the property harness
  const { assets, liabilities } = await sumBySide(db);
  expect(assets).toBe(liabilities);
});

it("refuses an insufficient balance with zero writes, holding the rollup lock while it decides", async () => {
  const out = await withTx((tx) => postMoneyTransaction(tx, feePosting("brokeUser", "lg1"), deps));
  expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.insufficientBalance });
  await expectNoPostingTookPlace(db);
});
```

- [ ] **Step 2: The writer**

Shape, with its lock order in the docblock and every FK acquisition named (`money_entries` takes `FOR KEY SHARE` on `money_transactions` and `money_accounts`; both are created/locked earlier in the same function, so the acquisition is a re-lock of rows already held — stated, per the Plan C deadlock lesson):

```ts
export async function postMoneyTransaction(tx: DbTx, input: MoneyTransactionInput, deps: PostDeps): Promise<PostOutcome> {
  const balanced = balancedOrRefuse(input.entries);
  if (!balanced.ok) return balanced;
  // 1. Ensure + lock every touched rollup row, in SORTED account-id order (deadlock-free by
  //    total order; the audit anchor stays last because it is not a money_accounts row).
  const ids = [...new Set(input.entries.map((e) => e.accountId))].sort();
  for (const id of ids) await ensureAndLockAccount(tx, id); // INSERT … ON CONFLICT DO NOTHING; SELECT … FOR UPDATE
  // 2. Sufficient-balance check against the locked rollups (liabilities only).
  // 3. INSERT money_transactions row (idempotency_key unique — a replay returns the prior outcome).
  // 4. INSERT money_entries (stateOfEntry from input, taxYear from clock.now()).
  // 5. UPDATE each rollup balance_cents.
  // 6. deps.audit.record(tx, input.auditEvent) — LAST, per ruling 3; a failure throws and rolls back everything.
}
```

`input.stateOfEntry` is required on the type; per-entry state (settlement's many-state case, Task 10) overrides it per entry. Idempotency: a unique-violation on `idempotency_key` is caught with `isUniqueViolation` (`src/db/errors.ts`) and returns the already-committed transaction's outcome — the double-click and the webhook redelivery are the same non-event.

- [ ] **Step 3: The reads**

`walletSummary(db, userId)` returns `{ availableCents, escrowCents, heldCents, owedCents }`, each a SUM over `money_entries` (never the rollup — the rollup is a lock target and a backstop, the entries are the truth; a dedicated test asserts rollup equals entry-sum after the property harness). `getUserAnnualNetProfit(db, userId, taxYear)` is prizes credited minus entry fees debited plus refunds credited for that `tax_year` — the DraftKings/FanDuel annual-net methodology, with a test computing a known fixture by hand, and a companion test reading `MONEY_CONFIG.reportingThresholdCentsByTaxYear` to answer "who crossed the line" — the exact query Phase 5 consumes.

- [ ] **Step 4: Lock-order entries and commit**

Read the current entry count off `src/integrity-service/lock-order.test.ts`, then add the concurrent-pair proof for `postMoneyTransaction` (a posting beside a concurrent join in the same league; a posting beside a concurrent posting sharing one account). Commit.

---

## Task 4: Seam A — `PaymentsProvider`, its mock, and the contract that outlives it

**Files:**
- Create: `src/payments-provider/contract.ts`, `config.ts`, `registry.ts`, `mock/mock-payments-provider.ts`, `contract-suite.ts`, `ingest.ts` (+ tests)
- Modify: `vitest.config.mts` (gate `src/payments-provider/**`), eslint boundary config, `.env.example` (`PAYMENTS_PROVIDER=mock`)

**Interfaces:**
- Consumes: `envOr` (`src/lib/env.ts`), `Clock`.
- Produces: `PaymentsProvider`, `TransferIntent`, `TransferStatus`, `MethodDescriptor`, `createPaymentsProvider`, `runPaymentsProviderContractSuite`, `PaymentsEvent`, `ingestProviderCallback`.

- [ ] **Step 1: Write the contract suite first — it IS the spec of the seam**

```ts
// src/payments-provider/contract-suite.ts — run against EVERY implementation, mock included.
export function runPaymentsProviderContractSuite(name: string, make: () => ProviderHarness): void {
  describe(`PaymentsProvider contract: ${name}`, () => {
    it("moves a deposit pending -> completed with the exact requested amount", async () => { /* … */ });
    it("replays an idempotency key without creating a second transfer", async () => { /* … */ });
    it("surfaces a decline as a typed failed status, never a thrown string", async () => { /* … */ });
    it("models a deposit that COMPLETES and then RETURNS days later, emitting a returned status for the same ref", async () => {
      // The R01/R10 class. Any implementation that cannot represent this cannot be wired in.
      const h = make();
      const ref = await h.depositCompleting(10_00);
      await h.advanceDays(4);
      await h.triggerReturn(ref);
      expect(await h.provider.getTransferStatus(ref)).toBe("returned");
    });
    it("reports fee and ETA per supported method, so the UI never invents either", async () => { /* … */ });
    it("answers getPooledBalanceCents consistently with its own completed transfers", async () => { /* … */ });
  });
}
```

- [ ] **Step 2: The interface** — the dossier's §3.1 shape verbatim, integer cents, `idempotencyKey` required on both initiations, `listSupportedMethods(): readonly MethodDescriptor[]` with `feeCents`/`etaDescription`, `getPooledBalanceCents()`.

- [ ] **Step 3: The mock** — in-memory ledger of transfers on an injected `Clock`; pending transfers resolve on `advance()`; failure injection by amount sentinel and by explicit harness call; **returns after completion** are first-class (`triggerReturn(ref)` flips a completed transfer to `returned` and queues a callback). Two methods reported: `bank` (fee 0) and `card` (fee modeled per the founder question — Task 14 presents the numbers; the mock carries them as config so the UI renders real figures either way).

- [ ] **Step 4: The registry** — `createPaymentsProvider()` copies `createStatsProvider`'s machinery: `UnknownPaymentsProviderError` naming the env var and the valid names, `envOr(PAYMENTS_PROVIDER_CONFIG.envVars.provider, "mock")`, one `build()` switch with only a `mock` arm this phase. The real Column/Aeropay/Paysafe arms are founder-gated future implementations that must pass Step 1's suite before they can be named here — the doc note in `docs/money.md` says exactly that.

- [ ] **Step 5: The ingestion point** — `ingestProviderCallback(raw)` verifies the mock's HMAC-style signature header and translates to a typed `PaymentsEvent` (`deposit_completed | deposit_returned | withdrawal_completed | withdrawal_returned | withdrawal_failed`, with `ref` and `amountCents`). One translator, so Task 5/6's postings never read provider-shaped JSON. Commit.

---

## Task 5: Deposits, and the deposit that comes back

**Files:**
- Create: `src/money-service/deposits.ts`, `gates.ts`, `schemas.ts` (+ tests), `src/app/api/wallet/deposits/route.ts`, `src/app/api/payments/webhook/route.ts` (+ route tests)
- Modify: `src/integrity-service/lock-order.test.ts` (deposit writer entry)

**Interfaces:**
- Consumes: `createPaymentsProvider`, `ingestProviderCallback`, `postMoneyTransaction`, `moneyIsLive`, `MONEY_STATES`, `requireCurrentUser`, `parseJson`, `respond`.
- Produces: `initiateDeposit`, `recordDepositCompleted`, `recordDepositReturned`, `moneyGates`.

- [ ] **Step 1: Write the failing gate and return tests**

```ts
it("refuses a deposit from a user in no enabled state, which today is every user", async () => {
  const out = await initiateDeposit(db, { userId: "u1", amountCents: 50_00, stateOfEntry: "TN", method: "bank" }, deps);
  expect(out).toEqual({ ok: false, status: 403, reason: MONEY_REFUSALS.stateNotEnabled });
});

it("refuses a deposit before KYC is verified, and says why in plain words", async () => {
  const out = await initiateDeposit(db, input, { ...deps, states: enabledTN });
  expect(out).toEqual({ ok: false, status: 403, reason: MONEY_REFUSALS.kycRequired });
  // MONEY_REFUSALS.kycRequired: "Verify your identity first. Federal rules require it before you can hold a balance."
});

it("claws back a returned deposit from the available balance, and books any shortfall as owed, never negative", async () => {
  await verifiedDeposit(db, "u1", 50_00, "TN");           // balance 5000
  await spendOnEntryFee(db, "u1", "lg1", 30_00);          // balance 2000
  await recordDepositReturned(db, eventFor("u1", 50_00), deps);
  const w = await walletSummary(db, "u1");
  expect(w.availableCents).toBe(0);
  expect(w.owedCents).toBe(30_00);                        // platform_receivable:u1
});

it("blocks every paid door while anything is owed", async () => {
  // moneyGates.receivableClear is the fourth guard on deposit-spend paths after a return.
  const out = await joinPaidLeague(db, "u1", "lg2");
  expect(out).toEqual({ ok: false, status: 403, reason: MONEY_REFUSALS.balanceOwed });
});
```

- [ ] **Step 2: The three shared gates** — `moneyGates(db, user, stateOfEntry)` checks, in order and with one refusal sentence each: state enablement + minimum age for that state (`MONEY_STATES`), `kyc_status === "verified"`, `self_excluded_at IS NULL`. Deposit adds the receivable check. Every money door (deposit, paid join) calls this one function — the dossier's §4.2-4.4 as a single choke point, built once. `stateOfEntry` is self-attested at the door this phase and recorded as attested (Phase 5 Step 3 replaces the producer, not the consumer — the sketch's stub, kept).

- [ ] **Step 3: The postings** — initiation calls the provider and stores the intent; **no ledger rows until the completion event** (pending money is the bank's, not the book's). Completion posts `deposit`: debit `fbo_pool`, credit `user_available:<id>`, audit `deposit_completed` (platform scope). Return posts `deposit_return`: credit `fbo_pool`; debit `user_available` up to its balance; debit `platform_receivable:<id>` for any shortfall — audit `deposit_returned`. A later completed deposit while owed posts `receivable_settlement` first (credit `platform_receivable`, remainder to `user_available`). The webhook route is the only caller of `ingestProviderCallback`; an unverifiable signature is a 401 with no body echo.

- [ ] **Step 4: Routes, lock-order entry, changed-files verification + build (route added); commit.**

---

## Task 6: Withdrawals

**Files:**
- Create: `src/money-service/withdrawals.ts` (+ tests), `src/app/api/wallet/withdrawals/route.ts` (+ test)
- Modify: `src/integrity-service/lock-order.test.ts`

- [ ] **Step 1: Failing tests** — a request debits `user_available` and credits `provider_clearing` immediately (audit `withdrawal_requested`), so the money a user asked out can never be spent twice while pending; insufficient balance refuses with `expectNoPostingTookPlace`; completion moves `provider_clearing` → credit `fbo_pool` (audit `withdrawal_completed`); a provider **failure** reverses clearing back to `user_available`; a **return** after completion posts debit `fbo_pool`, credit `user_available` (audit `withdrawal_returned`) — the money came back, the book says so, nobody edits history.
- [ ] **Step 2: The writer and route** — method chosen from `listSupportedMethods()`, fee and ETA rendered from the descriptor before commit (the UI never invents either), amount bounds from `MONEY_CONFIG.withdrawal`, gates reused from Task 5 (a self-excluded user may still withdraw — exclusion closes the doors money enters, never the door it leaves; docblocked and tested).
- [ ] **Step 3: Lock-order entry; commit.**

---

## Task 7: The KYC seam and the self-exclusion flag

**Files:**
- Create: `src/payments-provider/kyc-contract.ts`, `kyc-registry.ts`, `mock/mock-kyc-provider.ts` (+ tests), `src/app/api/wallet/kyc/route.ts`, `src/app/api/wallet/exclusion/route.ts` (+ tests)
- Modify: `src/db/schema.ts` consumers (`users.kyc_status` writer), `.env.example` (`KYC_PROVIDER=mock`), admin-room exclusion control

- [ ] **Step 1: Failing tests** — `KycProvider` is `submitVerification(input): Promise<KycSubmissionRef>` / `getStatus(ref)` with statuses `pending | verified | failed`; the mock verifies fixed test identities and fails one named fixture; a contract suite mirrors Task 4's. `users.kyc_status` is written only by the KYC callback path (`none → pending → verified | failed`, one-way except operator reset); a `failed` status renders a next action, never a dead end.
- [ ] **Step 2: Self-exclusion** — `POST /api/wallet/exclusion` sets `self_excluded_at` for the caller (one-way from the account room; only an operator can clear it, from the admin room, audited as `admin_action`). Checked at deposit and paid join via Task 5's gates, which already exist — this task makes both flag writers real.
- [ ] **Step 3: Commit.**

---

## Task 8: Entry fees at the doors that already exist

The join transaction, the seat release and the roll all shipped in Phase 3.6. This task threads money through them without changing their shape — and proves a free league cannot tell this phase happened.

**Files:**
- Create: `src/money-service/entry-fee.ts` (+ tests)
- Modify: `src/league-service/join.ts`, `release.ts`, `creation.ts`, `schemas.ts`, `src/league-service/house-factory.ts` (+ their tests), `src/integrity-service/lock-order.test.ts`

**Interfaces:**
- Consumes: `joinLeagueInTx`'s existing transaction, `postMoneyTransaction`, `prizeTableInvariant`, `moneyGates`.
- Produces: `collectEntryFeeInTx`, `refundEntryFeeInTx`, `leagues.entry_fee_cents` flowing through creation.

- [ ] **Step 1: Write the failing free-league and race tests**

```ts
it("lets a free league join run without a single money table read or write", async () => {
  // The founder's free-season guarantee as a mechanism: entryFeeCents === 0 short-circuits
  // BEFORE any money code runs. Asserted with a statement-log spy: no money_* table appears.
  const statements = await recordStatements(() => joinLeague(db, freeLeagueInput));
  expect(statements.filter((s) => /money_/.test(s))).toHaveLength(0);
});

it("charges exactly N-1 winners of an N-way race for the last seat, and the loser pays nothing", async () => {
  // Rides joinLeagueInTx's existing leagues FOR UPDATE — the capacity race was solved in
  // Phase 3.5; this asserts money inherited the solution rather than re-solving it.
});

it("refuses a paid join on insufficient balance with no seat taken and no money moved", async () => {
  const out = await joinLeague(db, paidInput({ balanceCents: 0 }));
  expect(out.ok).toBe(false);
  await expectNoPostingTookPlace(db);
  await expectNoSeatTaken(db, paidLeagueId, userId);
});

it("refunds the whole entry fee when a member releases their seat before the draft", async () => {
  await paidJoin(db, "u1", "lg1", 20_00);
  await releaseSeat(db, { leagueId: "lg1", userId: "u1" }, deps);
  expect((await walletSummary(db, "u1")).availableCents).toBe(20_00);
});
```

- [ ] **Step 2: Creation** — `createLeague`/the house factory accept `entryFeeCents` (bounded by `MONEY_CONFIG.entryFeeCeilingCents` in `schemas.ts`, zod bounds derived never retyped), `platformFeeCents`, and a `payoutTable` that must pass `prizeTableInvariant` or creation refuses. House rungs carry their fee and published prize table in `house-catalog.ts` — all rungs stay `0`/free until money is live (the catalog is config; flipping a rung is a one-line founder-visible diff). Prize copy renders "This league pays $X / $Y / $Z" from the stored table, never arithmetic over entries — founder decision 10's wording discipline, tested in the copy sweep.
- [ ] **Step 3: `collectEntryFeeInTx`** — runs inside `joinLeagueInTx` after the seat insert and before `fireWhenFullInTx`, under the already-held `leagues FOR UPDATE`: gates via `moneyGates`, posts `entry_fee` (debit `user_available`, credit `league_escrow:<leagueId>`, full fee — the rake is swept at settlement, ruling 6), audit `entry_fee_collected` (league scope, amount included — the fee is a published league fact, ruling 10). The docblock enumerates the FK locks it adds to `joinLeagueInTx`'s existing enumeration (`join.ts:91-99`), and the lock-order suite gains the paid-join concurrent pair.
- [ ] **Step 4: `refundEntryFeeInTx`** — the mirror posting (`entry_fee_refund`, audit `entry_fee_refunded`), called by `releaseSeat` inside its existing transaction. Roll-until-full needs **no money change**: a rolling league's fees simply stay in escrow, and the release path (this step) is what keeps the uncapped roll humane for paid seats too — the Phase 3.6 argument, inherited whole.
- [ ] **Step 5: Commit.**

---

## Task 9: Dissolution — the refund path that needed a door

Phase 3.6 established there is no way to cancel a league. Free leagues could live with that; a paid league holding twelve fees cannot. This task builds the smallest honest dissolution: operator-triggered, pre-draft only, every fee refunded, every member told.

**Files:**
- Create: `src/money-service/dissolution.ts` (+ tests), `src/app/api/admin/leagues/[leagueId]/dissolve/route.ts` (+ test), the admin-room dissolve control
- Modify: `src/integrity/system-actions.ts` (+`league_dissolved` code with compile-forced visibility), `src/integrity/notices.ts` (dissolution template), `src/integrity-service/lock-order.test.ts`

- [ ] **Step 1: Failing tests** — refuses once the draft has started (`DISSOLUTION_REFUSALS.draftStarted`); refuses for non-operators (403); refunds every seated member's fee in ONE transaction (leagues FOR UPDATE first, one `entry_fee_refund` posting per member, escrow closes at exactly zero, anchor last); a free league dissolves with zero money statements (same spy assertion as Task 8); every member receives the notice; `expectNoDissolutionTookPlace` asserted on every refusal.
- [ ] **Step 2: The writer, route and admin control.** The league row's `season` state is marked dissolved by the same mechanism enforcement uses for its own league-state writes (read the current column off `read.ts` before inventing one); dissolved leagues leave the browse shelf via the existing `ENFORCED_LEAGUE_SQL` family. Notice copy, sweep-clean: *"Your league did not fill and an operator closed it. Your entry fee of $X is back in your wallet."*
- [ ] **Step 3: Commit.**

---

## Task 10: Settlement — operator-triggered, prize table in, escrow to zero

**Files:**
- Create: `src/money-service/settlement.ts` (+ tests), `src/app/api/admin/leagues/[leagueId]/settle/route.ts`, `src/app/api/admin/holds/[userId]/route.ts` (+ tests), admin-room settlement + holds panels
- Modify: `src/integrity-service/lock-order.test.ts`

- [ ] **Step 1: Failing tests** — settlement is **never automatic** (nothing calls it but the admin route — asserted by the service-map source test pattern, `src/integrity/service-map.source.test.ts`); it refuses before the season's final week is `final`; it locks `leagues[id] FOR UPDATE` first and reads the STORED `payout_table` (never a request body's — the route takes no amounts at all); each prize posts debit `league_escrow` / credit `user_available:<winner>` with **that winner's** `stateOfEntry`; each seat's rake posts debit `league_escrow` / credit `platform_rake` with **that seat's** state (per-seat attribution is what keeps every row's `state_of_entry` honest for Phase 5); escrow lands at exactly zero or the whole transaction refuses (`SETTLEMENT_REFUSALS.escrowMismatch`) with `expectNoSettlementTookPlace`; a winner with an OPEN flag (`flags.ts` read in-transaction) is credited to `held_for_review:<userId>` instead, audit `payout_held`, other winners unaffected; settling twice is a clean idempotent no-op via the transaction's idempotency key.
- [ ] **Step 2: Holds** — `releaseHold` (debit `held_for_review`, credit `user_available`, audit `payout_released`) and `confiscateHold` (credit `platform_forfeiture`, audit `admin_action` + payload) are one-way operator actions shaped like `resolveFlag`.
- [ ] **Step 3: Commit.**

---

## Task 11: Reconciliation and the Phase 5 guarantee, proven

**Files:**
- Create: `src/money-service/reconcile.ts` (+ tests), `scripts/money-reconcile.ts`, the admin-room drift panel
- Modify: `package.json` (`money:reconcile` script), `README.md` (script table)

- [ ] **Step 1: Failing tests** — `reconcileMoney(db, provider)` compares the `fbo_pool` entry-sum against `getPooledBalanceCents()`; agreement returns `{ drift: 0 }`; an injected mock drift is reported to the cent and surfaces in the admin panel as a named alarm, tolerance `MONEY_CONFIG.reconcileToleranceCents` (zero); the run is recorded (level-triggered — a script and an admin refresh button, **no new scheduler**, the founder-gated-bucket precedent).
- [ ] **Step 2: The Phase 5 contract test** — one integration test file, `src/money-service/phase5-contract.test.ts`, that seeds a multi-user multi-state season and asserts the three answers Phase 5's "Assumed Phase 4 interface" section names: per-user annual net profit against the versioned threshold, per-state aggregation over `state_of_entry`, and `tax_year` stored on every row — so Phase 5 breaking ground breaks a named test here first, not a hope.
- [ ] **Step 3: e2e checkpoint 1** — run `league-lifecycle` and `formats-and-lobby` (the join path moved under them; money is dark so both must pass untouched). Commit.

---

## Task 12: The wallet, in the account room

**Files:**
- Create: `src/app/app/(shell)/wallet/page.tsx` (+ test), `src/app/api/wallet/route.ts`, `src/account-room/components/wallet-panel.tsx`, `deposit-form.tsx`, `withdrawal-form.tsx`, `kyc-panel.tsx`, `exclusion-panel.tsx` (+ tests)
- Modify: `src/account-room/contract.ts`, `src/integrity/rendered-copy.test.tsx` (all five components join the roster), `src/components/ui/index.ts` only if a genuinely new shape appears twice (expected: none — `Panel`, `Meter`, `StatPill` cover the mocks' needs)

- [ ] **Step 1: Failing tests** — while `moneyIsLive()` is false the wallet page renders the dark state: *"Real-money play is not available yet. Every league is free this season."* with no balance figures at all (no mock data on real surfaces); when live (injected states in tests), `WalletPanel` renders four figures from `walletSummary` — available, in escrow, held for review, owed — each with its one-line plain explanation (*"In escrow. Entry fees for leagues that have not finished."*); every figure is a query or absent; the withdrawal form shows fee and ETA per method **before** commit; the KYC panel renders all four statuses, `failed` with a concrete next action; `renderSurface` both-theme assertions and vitest-axe on every component.
- [ ] **Step 2: Build the five components** on `Panel`/`Meter`/`StatPill`, tokens only, dense scale, `formatUsd` everywhere (never a raw cents number in copy).
- [ ] **Step 3: Persona panel** (veteran / casual / commissioner / first-timer, plus the skeptic — money is the skeptic's surface) on the wallet flows; findings triaged in-task or ledgered.
- [ ] **Step 4: Changed-files tests + tsc + eslint + build (routes changed). Commit.**

---

## Task 13: The join-path money surfaces, and the free season that stays true

**Files:**
- Modify: `src/league-room/components/front-door-hero.tsx` (+ its two test files), `src/league/terms.ts` (+ test), `src/matchmaking/contract.ts`, `config.ts`, league card + join confirmation components (read the current names off `src/league-room/components/` — Phase 3.6 owns them), `src/app/legal/terms/page.tsx`
- Create: `e2e/money-dark.spec.ts`

- [ ] **Step 1: Failing tests** — the free-season sentence becomes derived: `moneyIsLive()` false renders exactly the current string "Every league is free this season." (both existing assertions keep passing untouched — that is the point); live renders the state-aware line. `LeagueTerms` gains `entryFeeUsd`, `platformFeeUsd` and the published prize table rows when the league is paid, and keeps `stakeDisclosure` verbatim when it is not; `PublicLeagueSummary` gains `entryFeeCents` (`contract.ts`'s "Never an amount of money" docblock is rewritten to "An amount of money at last — dark until a state is enabled", same line). A paid join confirmation states fee, balance after, and the refund rule in three sentences, sweep-clean.
- [ ] **Step 2: `e2e/money-dark.spec.ts`** — walks front door → browse → join → waiting room with money dark and asserts the product is byte-for-byte the free product: no wallet link in the shell for a signed-in user, no fee on any card, the free sentence present. This is the regression contract for shipping dark.
- [ ] **Step 3: e2e checkpoint 2** — `whole-site`, `mobile-360`, `design-v2`, `money-dark`. Build (routes/components changed). Commit.

---

## Task 14: The two applications (FOUNDER-GATED), the docs, and the closing battery

- [ ] **Step 1: The application packs — checklists only, NOTHING is submitted by this plan.**

Two documents under `docs/decisions/`, each ending in an explicit sign-off line the founder must fill before anyone submits anything externally. **No task in this plan submits, signs, or spends** (founder decision 2; decision 3's "application started at kickoff" is satisfied by these packs being ready on day one of the phase, with submission itself gated).

`money-application-column.md` — the Column FBO pack: entity legal name/EIN/formation docs (Phase 8 item 2 — flagged if not yet formed), beneficial owners for KYB, the product description in agent-of-payee terms, the state matrix and counsel memo status (Phase 8 item 1), expected volumes (deposits/month, average entry fee against the $500 ceiling, pool size), the reconciliation design (Task 11) as the operational-controls exhibit, AML program status (four-pillar: written policy, named compliance officer, training, independent review — owner: founder + counsel). **Sign-off line: "Founder approval to submit: ______ date ______".**

`money-application-gateway.md` — the Paysafe-first (Nuvei alternate) gaming-MCC merchant pack: same entity block, processing history (none — stated, with the pay-by-bank-first launch plan as the mitigation), chargeback controls (closed-loop wallet, no card withdrawals), projected card volumes, PCI posture (SAQ-A intent: hosted fields, no PAN ever touches this codebase — recorded as a binding constraint on any future card implementation), and the underwriting-is-the-long-pole timeline note that justifies day-one submission **once signed off**. Same sign-off line. Cards at launch remain gated on underwriting clearing (founder decision 4); the launch-opens-pay-by-bank-only fallback is recorded here so nobody re-litigates it in December.

- [ ] **Step 2: Docs** — `docs/money.md` (the two seams, the account vocabulary, the posting table from Tasks 5-10, the closed-loop invariant: **no peer-to-peer transfer, no gift-card redemption, no off-platform value conversion, ever** — dossier §4.1, stated as a product law so no future social feature ships "send your leaguemate $10"); `docs/decisions/money-foundations.md` (every ruling below, plus the founder-gated questions with their models); `docs/conventions.md` (new directories, gate count 24, ninth exempt directory); `plans/00-roadmap.md` (Phase 4 row updated, `plans/phase-4-payments.md` marked superseded by this file); `README.md`.
- [ ] **Step 3: The inert-deliverable sweep** — every new `AuditEventType` has a publisher, every refusal sentence a thrower, every `MONEY_CONFIG` key a reader, every new component two-plus real props callers or the copy sweep roster; a name this sweep finds unwired comes out.
- [ ] **Step 4: The closing battery** — cold `npm run infra:up` · both migrations forward · `npm run seed` · `npm run audit:verify -- --full` (the money events now on the chains) · full `npm test` · `npm run test:coverage` unfiltered with **24** gates at 100% · lock-order suite green at its own measured count through PgBouncer · `npm run typecheck && npm run lint && npm run build` · `npm run e2e` complete and green (the one full pass policy v4 allows). Commit.

---

## The old sketch, rebased (`plans/phase-4-payments.md` → here)

| Sketch step | Fate |
|---|---|
| 1 — banking partner ADR | **Rebased, narrowed** → Task 14 Step 1: founder decisions 1-5 already made the selection calls; what remains is the two application packs, founder-gated. |
| 2 — `PaymentProviderAdapter` + mock + contract suite | **Rebased** → Task 4, renamed `PaymentsProvider`, plus the ACH-return class the sketch never modeled. |
| 3 — double-entry ledger | **Rebased** → Tasks 1-3. Drift fixed: the sketch says Drizzle/SQLite (its line 17) — the platform is Postgres 17 via PgBouncer, which is why immutability is triggers, exclusion is row locks, and advisory locks are forbidden. Its `direction` column and `taxYear`/`stateOfEntry` requirements survive intact. |
| 4 — entry fee at join, two races | **Rebased** → Task 8. Both races the sketch's review found are already closed by machinery that shipped since: the capacity race by `joinLeagueInTx`'s `leagues FOR UPDATE` (Phase 3.5), the balance race by Task 3's rollup lock + CHECK. "Contest" vocabulary → "league" throughout. |
| 5 — escrow/payout + collusion hold + reconciliation | **Rebased** → Tasks 10-11, with the sketch's settle-lock re-derived under the global leagues-first law and the anchor-last law, and per-seat rake attribution added for Phase 5's sake. |
| 6 — deposit/withdrawal UI + staged KYC | **Split** → Tasks 5, 6, 7, 12. The enhanced-verification tier (document + liveness above a threshold) is **deferred** (table below): a mock cannot honestly distinguish tiers, and the config lands with the real vendor. |
| 7 — AML/OFAC screening adapter | **Deferred** (table below): Phase 8 item 5 owns the vendor; `held_for_review` (Task 10) is its landing mechanism, built now. |
| 8 — wallet & money-trust UX | **Rebased** → Task 12, on the account room and design system that now exist. The always-on escrow chrome indicator is deferred (D5): while money ships dark it is chrome for nobody. |

---

## Open questions, self-ruled

1. **The money family is named `money_*`, never `ledger`.** `src/stats-pipeline/budget.ts` owns "ledger" for API budgets; the dossier's naming-collision warning (§1.1) is the `experienceTier`/`participationTier` house lesson applied in advance.
2. **The audit enum grows by migration, and the frozen-enum ruling does not bind a phase.** Phase 3.6's ruling 25 rode payload outcomes because a design pass "is not entitled to relax" the freeze. A phase whose charter is a new fact family is: money events on the tamper-evident chain are the dossier's §3.3 design, and `ALTER TYPE … ADD VALUE` in its own migration (0036) is the safe mechanism. Payload-outcome overloading at this scale would make `system_action` a junk drawer exactly where auditability matters most.
3. **`src/money` is the ninth pure exempt directory.** The wallet must render the same refusal sentence and fee ceiling the server enforces; the alternative is retyping money copy in browser code, which is the disagreement machine the exempt list exists to prevent. It meets the bar the other eight set: no I/O, no clock, no Postgres.
4. **KYC is its own `KycProvider` interface, inside `src/payments-provider/`.** Own interface because the KYC bureau (Persona/Alloy-class) and the money rail (Aeropay/Column-class) are different vendors on different timelines, and folding identity verification into `PaymentsProvider` would force every rails implementation to pretend it is a KYC bureau. Same directory because both are the "external compliance vendor behind a registry" pattern and a third top-level seam directory would gate and boundary-list a one-interface module.
5. **An ACH-returned deposit never drives a balance negative; the shortfall becomes `platform_receivable`.** The `CHECK (balance_cents >= 0)` on player liabilities is load-bearing; a user who spent a deposit that later bounced owes the platform, is blocked from every paid door until settled, and their next deposit clears the receivable first. Negative player balances are how a wallet becomes a credit product, which this platform is not.
6. **Rake is swept at settlement, not at join.** The fee posts whole to escrow, so every pre-draft refund (release, dissolution) is trivially whole and the escrow-to-zero settlement invariant is arithmetic, not bookkeeping. The platform is paid when the league it sold actually happened.
7. **Dissolution exists now, operator-only, pre-draft only.** Phase 3.6 could rule "nothing can cancel a league" because nothing was owed. Twelve held entry fees make a no-exit league a custody problem. Member-initiated exit remains the seat release; commissioner-initiated dissolution is deferred (D2).
8. **Deposits post nothing until completion.** A pending transfer is the bank's fact, not the book's; the intent is stored, the ledger stays silent, and the completion event is the first posting. Withdrawals are the mirror: the debit posts at request, because promised-out money must be unspendable immediately.
9. **League money events carry amounts in the league feed; personal money events never appear there.** The entry fee and prize table are published league facts (founder decision 10 makes them so), so `entry_fee_collected` showing $20 discloses nothing private. Deposits and withdrawals are platform-scoped and appear only in the owner's own stream. The persona panel (Task 12) revisits the first half; the second is a privacy floor, not a taste call.
10. **`stateOfEntry` is per-entry at settlement, per-transaction everywhere else.** Prizes carry the winner's state, per-seat rake carries the seat's state — the only attribution under which "every row carries a true state" survives multi-state leagues, and exactly what Phase 5's per-state aggregation needs.
11. **The free-season sentence becomes derived from `moneyIsLive()`.** The two existing test assertions keep passing character-for-character while money is dark, which is the proof the derivation changed nothing today and cannot be forgotten tomorrow.
12. **Reconciliation is level-triggered: a script and an admin button, no scheduler.** The founder-gated bucket has said "no production scheduler" for three phases; a daily cadence becomes an ops runbook line when a real bank lands, and the check itself is proven against the mock now.
13. **Settlement is manual forever in this phase.** Founder requirement ("operator-triggered, never automatic") and the right posture: money-out is the direction where a human eyeballs the prize table one last time.
14. **The e2e suite gains one dark-state spec and no money-flow specs.** Money flows cannot be walked end-to-end while no state is enabled and no real provider exists; component and integration tests carry them (with injected enabled states), and the first enabled state's plan owes the money e2e journey (D6).

## Open questions, FOUNDER-GATED (modeled, not decided)

**Card-deposit fee treatment (founder decision 10's carve-out).** Pay-by-bank is free to the player either way. For cards, at gaming-MCC rates (modeled at 3.25% + $0.30 — replace with the term sheet when it exists): a $100 card deposit costs ≈ $3.55. **Eat it:** on a $20-entry league with a $2 platform fee, one $100 card depositor consumes the entire rake of ~1.8 entries — margin-negative for small leagues, invisible to players. **Surface it:** the deposit form reads "Card fee $3.55. Bank transfers are free." — margin-clean, steers players to the cheaper rail, costs conversion at the exact moment of highest anxiety. The mock provider carries both fee models as config so the wallet UI is already correct under either answer; Task 12 renders whichever the config states, and the config ships surfaced-off (fee shown as $0 pending the founder's word — no player sees a number the founder has not priced). **The founder decides; nothing in this plan does.**

**Submission of either application pack** (Task 14 Step 1) — sign-off lines, blank until signed. **The launch-state list** (decision 7) — mechanism ships empty. **Any Column signature or spend** (decision 2).

---

## Deferred and refused, each with the fact it is waiting on

| # | Item | Decision | The fact it waits on |
|---|---|---|---|
| D1 | Real provider implementations (Column, Aeropay, Paysafe/Nuvei) | **Deferred, founder-gated** | Decision 2: no signature, no spend. Each lands behind the seam and must pass the Task 4 contract suite, ACH returns included. |
| D2 | Commissioner-initiated dissolution | **Deferred** | Needs the refund UX plus an abuse story (a commissioner dissolving to dodge a losing season). Operator dissolution covers custody; the member door is the release. |
| D3 | Enhanced KYC tier (document + liveness above a withdrawal threshold) | **Deferred** | A mock cannot honestly distinguish verification tiers; the threshold config lands with the real vendor's actual capabilities. |
| D4 | AML/OFAC `SanctionsScreeningAdapter` + velocity/structuring monitoring | **Deferred to the pre-launch wave (Phase 8 item 5)** | The vendor is a Phase 8 signature; `held_for_review` (Task 10) is the landing mechanism, built and tested now so wiring screening in is a gate, not a redesign. |
| D5 | Always-on escrow indicator in the app chrome | **Deferred** | Money ships dark; chrome that renders for nobody is untestable decoration. Owed to the first enabled state's plan, with the wallet panel as its data source. |
| D6 | Money-flow e2e journeys | **Deferred** | Blocked on an enabled state and a walkable provider; integration tests carry the flows until then (ruling 14). |
| D7 | PayPal as a deposit method | **Refused** | Founder decision 5. |
| D8 | Dots-class payout/1099 vendor | **Refused** | Founder decision 6: the tax stack builds on our ledger; third-party payout rails fragment the FBO closed loop. |
| D9 | Stripe anywhere in money motion | **Refused** | AUP-prohibited category (dossier §2.1); terminal platform risk. Phase 6 SaaS billing may revisit for a different merchant category. |
| D10 | Peer-to-peer transfer, gift cards, any off-platform value conversion | **Refused, permanently** | The closed-loop stored-value invariant IS the agent-of-payee argument (dossier §4.1). Recorded as product law in `docs/money.md`. |
| D11 | Proration / partial-season entry | **Refused** | Founder decision 9. A Phase 9 orphan-seat buy-in is a ledger transfer against the same escrow, not new prize math. |
| D12 | Percent-of-pool rake, anywhere, including copy | **Refused** | Founder decision 10; UIGEA prize-condition posture. `prizeTableInvariant` and the copy sweep are the enforcement. |

---

## Self-review

**Spec coverage, dossier section by section.** §1.1 naming collision → ruling 1. §1.2 stake-tier touchpoints → Task 13 walks every cited site (`config.ts:38-45`, `schemas.ts:79-83`, `contract.ts:79-80`, `terms.ts:227-228`, the terms page). §1.3 house fee model → Task 8 Step 2 (rungs carry fee + published table; `when_full` + fixed size keeps the UIGEA condition structural). §1.4 audit chain → Tasks 2-3 (in-transaction, anchor-last, FK enumeration; the union count corrected 19 → 16). §1.5 seam precedent → Tasks 4 and 7 copy the registry machinery by name. §1.6 sketch drift → the supersession table. §2 provider landscape → founder decisions 1-5 bound; D7-D9. §3.1 Seam A → Task 4 (interface verbatim, ACH returns mandatory). §3.2 operation table → Tasks 8 (collect), 9 (refund), 10 (settle + holds), escrow-as-account by construction, proration refused. §3.3 audit events → Task 2 Step 3 (list adjusted 8 → 10, argued); league/platform scoping per the dossier; amounts ruling 9. §3.4 KYC/sanctions out of Seam A → ruling 4 and D4. §4.1 closed loop → D10 + `docs/money.md`. §4.2 state gating, empty allowlist, CA note → Task 1 Step 4, Task 5 Step 2. §4.3 age per state → the `minAge`-required-to-enable shape. §4.4 self-exclusion → Tasks 5 and 7. §4.5 1099 threshold, not filing → Task 3 Step 3 + Task 11 Step 2 + versioned config. §4.6 UIGEA payout structures → `prizeTableInvariant`, stored table, published-prize copy, fixed rake. §5's ten questions → the ten founder decisions, restated verbatim and bound.

**Placeholder scan.** No TODO, no TBD, no "appropriate error handling." Every refusal has a named sentence home (`MONEY_REFUSALS`, `DISSOLUTION_REFUSALS`, `SETTLEMENT_REFUSALS`); every number is a `MONEY_CONFIG` key with a docblock. Three places direct the executor to read the current code before writing — the lock-order entry count, the league card/join component names (Task 13), the league-state column for dissolution (Task 9 Step 2) — each because Phase 3.6 owns those files and a plan quoting a measured count it did not measure is how green tests describe yesterday. Two modeled numbers are labeled as models (the card fee 3.25% + $0.30, the bank fee $0) pending term sheets — they parameterize a founder question, they are not shipped prices.

**Type consistency.** `MoneyAccountKind`, `MoneyTxnKind`, `TransferStatus`, `KycStatus`, the ten `AuditEventType` additions — each a `readonly` tuple with its union derived, declared once (`src/money/accounts.ts`, `src/money/posting.ts`, `src/payments-provider/contract.ts`, `src/domain/audit.ts`). Amounts are integer cents end to end; `formatUsd` is the single cents-to-copy door. `stateOfEntry` is one `StateCode` type consumed by `MONEY_STATES`, the gates, and the entry rows. Nothing declares a second type for an existing concept: a wallet is a read over accounts, not a table; a hold is an account, not a status column; the prize table is one `PrizeTable` shared by creation, terms and settlement.

**Parent-plan collision check (Phase 3.6 owns these files today — read before editing, all paths verified in this worktree).** `src/league-service/join.ts` — 3.6 Task 6 added hold consumption (`holdOutcome` on `JoinLeagueOutcome`); Task 8 inserts `collectEntryFeeInTx` after the seat insert without touching the hold path, and re-runs `join.test.ts` whole. `src/league-service/release.ts` — 3.6 Task 8's `RELEASE_REFUSALS` stays intact; Task 8 adds the refund posting inside the existing transaction. `src/league-service/roll.ts` — untouched (Task 8 Step 4 says why in the code's own docblock). `src/league-room/components/front-door-hero.tsx:23` — the free-season sentence becomes derived with its two existing assertions preserved verbatim (Task 13 Step 1). `src/matchmaking/config.ts` / `contract.ts` — the cosmetic-tier docblocks are rewritten only in Task 13, in the same commit as their tests. `src/app/app/(shell)/` — the wallet page joins the shell group 3.6 built; no route group moves. `src/account-room/**` — additive components beside 3.6's theme switcher. `src/integrity-service/lock-order.test.ts` and `vitest.config.mts` — counts read off the files at execution time, per the standing lesson.

**Boundary check.** `src/money` is pure and browser-safe (ruling 3) — the wallet and the creation form value-import it legally. `src/money-service` and `src/payments-provider` are server-only, on the banned list, reached over the wire. No room directory imports either as a value; `import type` stays legal. The webhook route is the one unauthenticated money endpoint and verifies a signature before reading a byte of body into any decision.

**Free-season compatibility, restated as the tests that hold it.** Task 8 Step 1's statement-log spy (a free join touches zero `money_*` tables), Task 12 Step 1's dark wallet state, Task 13's derived sentence with unchanged assertions, and `e2e/money-dark.spec.ts` walking the whole free product. Money ships dark behind `MONEY_STATES.enabled` being empty, and every one of those tests is what "dark" means.

**Execution order.** 1 → 2 → 3 ∥ 4 → 7 → 5 → 6 → 8 → 9 → 10 → 11 (e2e checkpoint 1) → 12 → 13 (e2e checkpoint 2) → 14. Task 4 has no Postgres dependency and may run beside Task 3; Task 7 needs only Task 2's columns; Tasks 5-6 need 3, 4 and 7's gates. Everything after Task 8 depends on the join path being paid-aware.
