# Commish — The Money System

**Read this before touching anything under `src/money/`, `src/money-service/` or `src/payments-provider/`**, alongside `docs/conventions.md` (the standing laws) and `docs/decisions/money-foundations.md` (why each of these choices was made, with every ruling). The spec this system was built from is `docs/research/2026-08-24-phase4-payments-research.md`; the plan is `docs/superpowers/plans/2026-08-24-phase4-money-foundations.md`.

**The one fact that frames everything else: money ships dark.** `MONEY_STATES.enabled` is empty (founder decision 7), `moneyIsLive()` is false, every money door refuses, every league is free, and a free league never touches a `money_*` table at all. The whole system below is built, tested, and waiting on a founder-named launch state.

## The two seams

| Seam | Directory | Covers | Boundary |
|---|---|---|---|
| **A — `PaymentsProvider`** | `src/payments-provider/` | External money motion ONLY: deposits, withdrawals, their async status changes, the pooled bank balance. `KycProvider` (identity verification) lives beside it as its own narrow interface — different vendor, same registry-plus-contract-suite machinery. | Server-only, banned value-import list, coverage gate 24. No ledger concept crosses the seam in either direction. |
| **B — the internal money ledger** | `src/money/` (pure vocabulary) + `src/money-service/` (Postgres writers) | Everything else: entry fee, escrow, prize, refund, rake, holds — internal double-entry postings that never touch the provider. | `src/money` is pure and browser-safe (ninth exempt directory — the wallet and the creation form read the same config, refusal sentences and prize invariant the server enforces); `src/money-service` is server-only, banned value-import list, gate 23. |

Seam A mirrors `STATS_PROVIDER` deliberately: a fail-fast registry (`createPaymentsProvider`, `UnknownPaymentsProviderError`), env selection via `envOr` (`PAYMENTS_PROVIDER`, default `mock`), and one adversarial contract suite (`runPaymentsProviderContractSuite`) run against every implementation, mock included — with **return-after-completion** (the NACHA R01/R10 class) as a mandatory case, because a deposit that succeeds and reverses days later is the failure season-long operators actually eat. Webhooks land at one ingestion point (`ingest.ts`: raw-byte HMAC verification, strict Zod parse, typed `PaymentsEvent` out) so no posting code ever reads provider-shaped JSON.

**The founder gate on real rails** (from `registry.ts`'s own docblock, restated here from the product side): the registry's `build` switch has only a `mock` arm this phase, on purpose. The real rails — Column, Aeropay, Paysafe (founder decisions 2-4) — are founder-gated future implementations: **an arm may be named in the registry only for an adapter that passes `runPaymentsProviderContractSuite` unchanged, ACH-return case included, and whose name the founder has signed off.** No signature, no spend, no SDK installed until then.

## The four laws

Every money writer obeys all four; `postMoneyTransaction` (`src/money-service/post.ts`) is the one function that composes them, and every money movement in the product goes through it or does not happen.

1. **The global lock law.** Any money transaction that names a league (entry fee, refund, dissolution, settlement) takes the `leagues` row lock FIRST, as its own statement — or runs inside a caller (`joinLeagueInTx`, `releaseSeat`) that already holds it.
2. **The audit law.** The audit append rides in the same transaction as the posting; an append failure fails the money transaction. No catch, no best-effort.
3. **The anchor law.** The chain anchor is the LAST lock the transaction takes; money rollup rows lock in sorted account-id order before it (deadlock-free by total order), and every writer enumerates its FK lock acquisitions in its own docblock.
4. **The pooling law.** PgBouncer transaction pooling forbids advisory locks and session state — exclusion is row locks and guarded writes only.

Beneath those: a posting set is balanced to the cent or refused (`balancedOrRefuse`), every amount is a positive integer number of cents (`formatUsd` is the single cents-to-copy door), the ledger tables are append-only **by database trigger** (migration 0035, the audit chain's 0021 precedent), a player-facing balance can never go negative (writer refusal first, `money_accounts_balance_floor_ck` as backstop), and every entry carries `state_of_entry` and `tax_year` NOT NULL — the whole of what Phase 5 assumes.

## The account vocabulary

Eight kinds (`src/money/accounts.ts`), each on one side of the accounting equation; balances derive from entries via `signedBalance` (assets grow with debits, liabilities with credits). `accountIdFor`/`parseAccountId` are the only builder and parser of account id strings.

| Account | Side | Scope | Holds |
|---|---|---|---|
| `fbo_pool` | asset | singleton | The pooled FBO account at the partner bank — the one account real money physically sits in. |
| `platform_receivable:<userId>` | asset | per user | What a member owes the platform after an ACH-returned deposit outran their balance (ruling 5). |
| `provider_clearing` | liability | singleton | In-flight money the provider reports as pending, not yet settled into or out of the pool. |
| `user_available:<userId>` | liability | per user | A member's spendable balance. |
| `league_escrow:<leagueId>` | liability | per league | A paid league's collected entry fees, held by construction until settlement or refund. |
| `held_for_review:<userId>` | liability | per user | A prize frozen by an open integrity flag instead of paid. |
| `platform_rake` | liability | singleton | The platform's fixed per-entry fee, swept at settlement (never percent-of-pool). |
| `platform_forfeiture` | liability | singleton | Money confiscated by operator ruling rather than released. |

## The posting flows

Twelve transaction kinds (`MONEY_TXN_KINDS`, `src/db/schema.ts`), one per door money walks through. All debits/credits below are in the double-entry sense.

| Flow | Kind | Postings | Where |
|---|---|---|---|
| Deposit completes | `deposit` | debit `fbo_pool` / credit `user_available` — **nothing posts until the completion event**: pending money is the bank's fact, not the book's; initiation stores only an intent row (`payment_transfer_intents`). | `deposits.ts` |
| Deposit returns (R01/R10, days later) | `deposit_return` | credit `fbo_pool`; debit `user_available` up to its balance; debit `platform_receivable` for any shortfall — never a negative member balance. Every paid door then refuses until the debt clears. | `deposits.ts` |
| Next deposit while owed | `receivable_settlement` | the completing deposit credits `platform_receivable` first, remainder to `user_available`, atomically with the deposit posting. | `deposits.ts` |
| Withdrawal requested | `withdrawal_request` | debit `user_available` / credit `provider_clearing` **at request** — promised-out money is unspendable immediately. Any owed receivable **nets first** (settle `min(available, owed)`, then reserve the remainder — the Task 6 ruling: collection by netting, never by hostage-holding). The reservation posts before the provider is ever called. | `withdrawals.ts` |
| Withdrawal completes | `withdrawal_complete` | debit `provider_clearing` / credit `fbo_pool`. | `withdrawals.ts` |
| Withdrawal fails (provider decline) | `withdrawal_fail` | reverse: debit `provider_clearing` / credit `user_available`. A netted settlement stands — the debt was real either way. | `withdrawals.ts` |
| Withdrawal returns after completion | `withdrawal_return` | debit `fbo_pool` / credit `user_available` — the money came back, the book says so, nobody edits history. | `withdrawals.ts` |
| Entry fee at join | `entry_fee` | debit `user_available` / credit `league_escrow`, **the full fee** — rake is swept at settlement (ruling 6), so every pre-draft refund is trivially whole. Runs inside `joinLeagueInTx`'s existing transaction under its `leagues FOR UPDATE`, after re-checking the receivable under the writer's locks. | `entry-fee.ts` via `src/league-service/join.ts` |
| Seat release refund | `entry_fee_refund` | the mirror posting, inside `releaseSeat`'s existing transaction. | `entry-fee.ts` via `src/league-service/release.ts` |
| Dissolution (operator, pre-draft only) | `entry_fee_refund` × seats | one transaction: leagues lock first, guarded `drafts.status → 'dissolved'`, per-seat refunds under sorted money locks, member notices, anchor last. Escrow closes at exactly zero. | `dissolution.ts` |
| Season settlement (operator-triggered, never automatic) | `settlement` | debit `league_escrow` per the **stored** prize table (the route takes no amounts): each prize credits the winner's `user_available` with **that winner's** `state_of_entry`; each seat's rake credits `platform_rake` with **that seat's** state (per-seat attribution, ruling 10); a winner with an open integrity flag is credited to `held_for_review` instead (`payout_held`). Escrow lands at exactly zero or the whole transaction refuses. | `settlement.ts` |
| Hold outcomes (operator, one-way) | `hold_release` / `hold_confiscation` | `held_for_review` → `user_available` (release; the released amount counts as income in the **release's** tax year — the constructive-receipt ruling) or → `platform_forfeiture` (confiscation, which never counts as the member's income). | `settlement.ts` |

Every money door shares one guard function, `moneyGates` (`gates.ts`), in one order: state enablement (empty today — the whole phase's dark switch), KYC verified, not self-excluded, and — on spend doors — receivable clear. Self-exclusion closes every door money **enters** and never the door it leaves: an excluded member can always withdraw their own funds.

## The free-season law and `moneyIsLive`

`moneyIsLive()` (`src/money/states.ts`) is `MONEY_STATES.enabled.length > 0` — the single dark/live switch, and it is **derived, never asserted**: the front door's "Every league is free this season." sentence derives from it, league creation refuses a paid league while it is false, and the join path short-circuits **before any money code runs**. What "dark" means is a set of tests: a free join touches zero `money_*` tables (statement-log spy), the wallet page renders one sentence and no figures, the two long-standing free-season assertions pass character-for-character, and `e2e/money-dark.spec.ts` walks the whole product as the byte-for-byte free product. The dark gate is defense-in-depth: the refusal lives inside `leagueMoneyOrRefuse` itself (with an injectable live switch), so every layer above it inherits the sentence without re-spelling it.

## The closed-loop product law

**No peer-to-peer transfer, no gift-card redemption, no off-platform value conversion, ever** (dossier §4.1, refusal D10 — permanent). The closed loop IS the agent-of-payee argument the custody posture depends on, and it is cheapest to enforce by never building the feature. This is a product law, not a phase decision: no future social feature ships a "send your leaguemate $10" affordance, whatever else it ships. Money enters by deposit, moves internally only through the postings above, and leaves only by withdrawal to the member's own bank account.

## The reconciliation surface

`reconcileMoney(db, provider)` (`reconcile.ts`) answers four checks as typed figures, never a boolean — `moneyDriftFindings` is the one shared report-to-alarm derivation, so the script and the panel cannot disagree about what "clean" means:

1. **The bank check:** the ledger's `fbo_pool` entry-sum against `getPooledBalanceCents()`, tolerance zero (`MONEY_CONFIG.reconcileToleranceCents`).
2. **The double-entry law:** assets minus liabilities off the rollup.
3. **The member floor:** no `user_available` below zero, re-proven app-side.
4. **Escrow by league:** rollup-vs-entries consistency per league escrow.

Level-triggered, no scheduler (ruling 12): `npm run money:reconcile` and the admin-room drift panel's refresh button are the only two callers. A daily cadence becomes an ops runbook line when a real bank lands.

## The money-live checklist

The single place the money-live task starts from — the dependency list the Phase 4 ledger accumulated, one item per line, each with the file that owns it. Everything below is deliberately deferred work that turning on a first state requires; nothing on it is a bug.

1. **The state list itself** — the founder names launch states with counsel (Phase 8 item 1); every entry requires a `minAge`. Owner: `src/money/states.ts` (`MONEY_STATES.enabled`, `assertEnableable`).
2. **Commissioner fee collection at creation** — a paid league's creator currently gets their seat without a fee posting; wire the commissioner's own entry fee before the creation gate opens. Owner: `src/league-service/creation.ts` (`leagueMoneyOrRefuse` and its docblock name this).
3. **`stateOfEntry` on the join wire** — `acceptInviteSchema` and the public-join schema must carry the joiner's attested state into `JoinMoneyContext`, closing the attestation wire end-to-end. Owner: `src/league-service/schemas.ts` → `src/league-service/join.ts` (`JoinMoneyContext`).
4. **Public-door attestation UI** — the invite door's paid-join confirmation carries the state-of-entry attestation control; the public door needs its twin (two-door symmetry — the Task 9 lesson class). Owner: `src/league-room/components/join-public-league-button.tsx`, with `paid-join-confirmation.tsx` as the shape to mirror.
5. **`LeagueTermsPanel` fee rendering** — the terms panel does not yet render the entry fee, platform fee and prize table rows `LeagueTerms` now carries. Owner: `src/league-room/components/league-terms-panel.tsx`.
6. **Per-league escrow rows in the wallet** — `WalletPanel` shows the escrow aggregate; the per-league breakdown is a ledgered fast-follow (`read.ts` already groups by league). Owner: `src/account-room/components/wallet-panel.tsx`.
7. **The card-fee eat-vs-surface decision** — founder decision 10's carve-out, modeled and shipped surfaced-off; the founder's answer flips one switch. Owner: `src/payments-provider/mock/mock-payments-provider.ts` (`surfaceCardFee`, `MOCK_PAYMENTS_CONFIG.methods.card`) — and the real gateway's term sheet replaces the modeled numbers.
8. **The shared-provider note for live demos** — every wallet route reads `getSharedPaymentsProvider()`; any demo or live wiring must keep reading it (per-route instances made deposits invisible to reconciliation and could mint colliding refs under the mock). Owner: `src/payments-provider/registry.ts`.

Beyond the checklist, the deferred table in `docs/decisions/money-foundations.md` names what money-live does NOT require but the first enabled state's plan owes: the money-flow e2e journey (D6), the always-on escrow chrome indicator (D5), the AML/OFAC screening vendor (D4, Phase 8 item 5 — `held_for_review` is its landing mechanism, already built), and the enhanced KYC tier (D3).
