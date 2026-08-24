# Phase 4 Payments — Research Dossier

**Date:** 2026-08-24. **Author:** planning researcher (autonomous loop). **Status:** research input to the Phase 4 detailed plan, not the plan itself.
**Charter (meta-ledger):** Phase 4 = money foundations behind a PaymentsProvider seam. Buy-not-build applies to money movement the same way it applies to auth (WorkOS behind `getCurrentUser`): the platform never becomes its own processor, bank, or KYC bureau.
**Scope of this dossier:** (1) what exists in the codebase today, (2) the processor and wallet landscape for a US real-money season-long fantasy platform, (3) a proposed seam design, (4) the compliance surface Phase 4 itself must carry versus what Phases 5 and 8 own, (5) the founder decisions.

---

## 1. What exists today

### 1.1 Nothing money-real exists — by design, and the docblocks say so

- `PaymentsProvider` — **zero hits anywhere in `src/`**. No payments module, no wallet, no balance, no escrow, no money ledger exists. Phase 4 starts from a clean seam.
- The only "ledger" in the codebase is the Tank01 API request budget ledger (`src/stats-pipeline/budget.ts`, atomic Redis Lua). **Naming collision warning:** Phase 4 must name its money tables and modules so "ledger" is never ambiguous between API budgets and money facts (the house habit after `experienceTier`/`participationTier`: different nouns, compile-distinct vocabularies).
- The only "balance" hits are unrelated (audit chain "balance-as-rollup" anchor wording, design tokens).

### 1.2 The cosmetic stake tier — the one money-shaped thing Phase 3.x built

- `src/matchmaking/config.ts:34-45` — `stakeTiers` (`0 Free / 1 Friendly / 2 Competitive / 3 High stakes`) with a docblock stating the tier is cosmetic only, that no entry fee is charged, no prize is paid and no balance exists, and that real money arrives later behind FBO/agent-of-payee handling, KYC/AML and tax reporting. `stakeDisclosure` (line 45) is the single wording of the no-money promise.
- The tier index threads end to end and every touchpoint is a Phase 4 integration site:
  - validation: `src/league-service/schemas.ts:79-83` (zod, bounds derived from the config, never retyped)
  - creation: `src/league-service/creation.ts:92,181,211`
  - browse filter axis: `src/league-service/browse.ts:32,143,250,371`; `src/matchmaking/filter.ts:20-60,80-81`
  - contract: `src/matchmaking/contract.ts:79-80` ("Never an amount of money")
  - league terms panel: `src/league/terms.ts:26-31,70-71,227-228` — the disclosure is read from config, not retyped, per `docs/decisions/identity-and-trust.md:250-251`
  - public terms page: `src/app/legal/terms/page.tsx:23`
- **Decision on record:** `docs/decisions/formats-and-lobby.md:32-33` — two-layer prizes and real stake tiers stay cosmetic "pending Phase 4's payout-structure domain." The Plan C meta-ledger entry likewise records **payout structure does not exist as a domain concept** (draft date/time has since become real in Phase 3 Plan D; payout structure has not).

### 1.3 The house-league fee model

- `src/matchmaking/house-catalog.ts:41-110` — the shelf is three rungs (`open_12`, a beginner-tier rung, `sitandgo_12`), all spreading one `CANON` (fixed 12 teams, fixed format/scoring/roster), each with `stakeTier: 0` and a docblock at lines 89-90: cosmetic only, every rung reads "Free."
- `src/league-service/house-factory.ts:180-215` — league creation spreads `rung.stakeTier`; the factory writes through `writeLeagueInTx` with the `AuditLogger` already in hand. Entry-fee collection will ride these same transactions.
- Start triggers: a rung either fires at a scheduled kickoff or `when_full` (`house-catalog.ts:29`, sit-and-go). Combined with fixed `teamCount`, **a house league only ever drafts at a known, fixed size** — which matters for the UIGEA prize condition (section 4.4).
- Join/refund seams money must bind to: `src/league-service/join.ts` (`joinLeagueInTx`), `release.ts` (seat release), `roll.ts` (roll-until-full), `fill-trigger.ts` (sit-and-go fire). All already append audit events in-transaction.

### 1.4 The audit chain — money events have a home waiting

- `src/integrity-service/audit-logger.ts:92-95` — `AuditLogger.record(tx, input)` / `recordAll`. Append-only; the interface docblock (lines 85-90, ruling 4) states an audit append failure **fails the caller's business transaction** — no best-effort. Money events inherit this rule.
- Lock order (lines 111-114, ruling 3): the chain anchor is always the **last** lock a transaction takes, and "lock" includes implicit `FOR KEY SHARE` from FK references. Phase 4's ledger postings must slot into this order: business rows, then money rows, then anchor. Plan C's mirror-proposal deadlock (found because FK acquisitions had been waived from proofs) is the standing lesson: enumerate FK lock acquisitions for every money writer.
- `src/domain/audit.ts:14-53` — the `AuditEventType` union (19 events today, none money). Phase 4 adds money events to this union so money facts join the tamper-evident chain, per-league scope for league money (entry fee, prize) and platform scope for account money (deposit, withdrawal).
- Collusion-hold hook exists: `src/integrity-service/flags.ts:62` (`raiseFlag`), `:451` (`resolveFlag`, one-way), `trade-fairness.ts:218`. The Phase 4 sketch's "hold a flagged winner's payout" step has a concrete flag store to read.

### 1.5 The seam to mirror

- `src/lib/auth/current-user.ts:28` — `getCurrentUser()`: product code never imports WorkOS. The stats seam is the richer precedent: `STATS_PROVIDER` registry (fail-fast env selection, an adversarial contract suite run against every implementation including the test fake, adapter proven against committed fixtures with network isolation). Phase 4's provider seam should copy that machinery, not just the interface habit.

### 1.6 What the roadmap and sketch promise

- `plans/00-roadmap.md` Phase 4 row: "FBO/agent-of-payee ledger (with concurrency locking), entry fees, escrow/payout, KYC/CIP, AML/OFAC, wallet & money-trust UX." Real-world blocker: banking/BaaS partner signature; code proceeds against a mock adapter until then.
- `plans/phase-4-payments.md` (v2) is already an 8-step sketch: Step 1 business prerequisite (partner + ADR), Step 2 `PaymentProviderAdapter` + mock + contract suite, Step 3 double-entry per-user per-state ledger (append-only, `taxYear`, required `stateOfEntry`), Step 4 entry fee at join (with the two concurrency races and their `FOR UPDATE` fixes), Step 5 escrow/payout + collusion hold + reconciliation, Step 6 deposit/withdrawal UI + staged KYC adapter, Step 7 AML/OFAC screening adapter, Step 8 wallet and money-trust UX.
- **Known drift the detailed plan must rebase:** the sketch says Drizzle/SQLite local dev (line 17) — the platform has been Postgres + PgBouncer transaction pooling since Phase 2, which forbids session state and advisory locks (`audit-logger.ts:101-104` names this). Its "contest" vocabulary is now "league"; its Phase 3 references are now concrete modules; its Step 4/5 locking must be re-derived against the global leagues-before-drafts lock rule and the audit anchor-last rule.
- Phase 4 gates already banked against it: `docs/research/2026-08-23-backend-gaps-backlog.md` rows 2-6 and 23 (email change, dispute intake beyond reviews/chat, account deletion, device/session listing, MFA surface, "what happens when it is not free") are all severity-tagged to Phase 4 because account operations become legally load-bearing when money lands.

---

## 2. Provider landscape

Method note: web research 2026-08-24. Fee schedules in the regulated-gaming vertical are almost never published; where a number is missing below that is an honest gap for the sales conversation, not an omission. All acceptable-use readings are of the pages as fetched on 2026-08-24; these pages change, and counsel should re-verify at signing.

### 2.1 The threshold fact: mainstream PSPs prohibit this category

**Stripe — prohibited, no published approval path.** Stripe's restricted businesses list places under Gambling: "Games of skill including video game and mobile game tournaments or competitions, darts, card games, and board games with a monetary or material prize" ([stripe.com/legal/restricted-businesses](https://stripe.com/legal/restricted-businesses), fetched 2026-08-24). Paid-entry fantasy is squarely a game of skill with a monetary prize. Third-party analyses read the policy the same way ([WiseAlt](https://wisealt.com/stripe-payments-company-not-suited-for-igaming-heres-what-you-should-know/), [DirectPayNet 2026](https://directpaynet.com/business-restricted-from-using-stripe/)). Stripe Treasury exists and is expanding ([Treasury for platforms](https://stripe.com/treasury/platforms)), but Treasury rides Connect and the same acceptable-use posture; building the money core on a provider whose AUP names the category as prohibited is a terminal platform risk (account freeze with funds in flight). **Verdict: Stripe is out for money-in/money-out. It can still be considered later for non-gaming SaaS billing (Phase 6 paid AI tier), which is a different merchant category.**

**PayPal/Braintree — permitted only with prior written approval.** The Braintree AUP prohibits gambling-class activity generally but permits "fantasy sports... and games of skill (whether or not legally defined as gambling)" where operator and customers are exclusively in legal jurisdictions **and with PayPal's prior written approval** ([Braintree AUP](https://www.paypal.com/us/legalhub/braintree/acceptable-use-policy), fetched 2026-08-24). The approval is real but discretionary, and PayPal has a documented history of freezing gaming-adjacent accounts ([Legal Sports Report on the seizure arbitration](https://www.legalsportsreport.com/71418/seizure-of-paypal-accounts-case-to-arbitration-gaming-dfs/)). Large operators (FanDuel, Underdog) offer PayPal as a deposit method under such approvals. **Verdict: viable as one deposit method later, under written approval; wrong as the platform's core money infrastructure.**

### 2.2 The gaming-native options

**Paysafe / Skrill — the iGaming incumbent.**
- Acceptability: explicit. Paysafe operates a dedicated US iGaming vertical ([paysafe.com/us-en/industries-we-serve/igaming](https://www.paysafe.com/us-en/industries-we-serve/igaming/)) serving licensed operators and DFS brands; Skrill USA is its regulated US wallet; May 2026 it launched Pay with Crypto for US iGaming and DFS operators ([press release, 2026-05-14](https://ir.paysafe.com/news-events/press-releases/detail/261/paysafe-launches-pay-with-crypto-solution-to-meet-us-igaming-market-demand)).
- Shape: a gateway aggregating cards, the Skrill wallet, Paysafecash (cash-in), Pay by Bank, 30+ local methods. It is a processor/wallet layer, **not** a bank: the platform still needs its own FBO depository relationship for pooled player funds.
- KYC burden: operator retains CIP/AML responsibility; Paysafe brings gaming-grade risk tooling and is accustomed to regulated-entity onboarding (expect merchant underwriting: entity docs, state-by-state legality memo, AML program).
- Rails: cards in, wallet in/out, bank transfer; withdrawal speed depends on method.
- Fees: not published; gaming card processing conventionally runs well above retail card rates. Flag: get a term sheet before deciding.
- Honest note: FFPC — the season-long comparable — runs a plainer stack than this (card gateway via Authorize.net for deposits, ACH or mailed check for withdrawals, per its own terms: [myffpc.com terms](https://myffpc.com/cms/public/trust/terms-and-conditions), fetched 2026-08-24). The incumbent bar in season-long is low; that is the opening.

**Aeropay — pay-by-bank built for this exact category.**
- Acceptability: explicit; regulated gaming and fantasy is its stated market ([aeropay.com/gaming](https://www.aeropay.com/gaming)). PrizePicks is a flagship customer, and in March 2025 Aeropay became the first vendor member of the Coalition for Fantasy Sports alongside Underdog, PrizePicks, Betr, Dabble and Splash Sports ([announcement](https://www.aeropay.com/in-the-news/aeropay-becomes-first-vendor-member-to-join-coalition-for-fantasy-sports), 2025-03-12).
- Shape: API-first account-to-account transfers (ACH plus instant rails); deposits and instant withdrawals directly between the player's bank account and the operator's account ([account-to-account for DFS](https://www.aeropay.com/blog/account-to-account-payments-the-preferred-funding-withdrawal-method-for-daily-fantasy-sports); [Payments Dive profile](https://www.paymentsdive.com/news/aeropay-pay-by-bank-payments-evolution-gaming-cannabis/725255/)).
- KYC burden: bank-account linking gives a strong identity signal and cuts card fraud/chargebacks structurally, but does not replace the platform's own CIP.
- Fees: not published; pay-by-bank is conventionally flat-fee per transaction and materially cheaper than gaming-rate cards. Flag: term sheet required.
- Limitation: no card acceptance — a card-preferring depositor cohort is unserved if Aeropay is the only rail.

**Dots — payout-side orchestration, notable for the Phase 5 overlap.**
- Shape: a payouts API (ACH, Venmo, PayPal, Zelle and more) with esports/prize verticals, embedded W-9/W-8 collection, IRS TIN validation, withholding, and year-end 1099 e-filing built in ([usedots.com](https://usedots.com/); [esports vertical](https://usedots.com/solutions/esports/), fetched 2026-08-24).
- Acceptability: prize payouts for esports/competitions are an advertised use case; a fantasy-specific AUP statement was not found — **flagged, not assumed**.
- Fit: payout-only (no deposits), and routing prize money out through a third party's rails sits awkwardly with the closed-loop stored-value argument (section 4.1) and would fragment the FBO reconciliation. Main value is as a benchmark: it proves the Phase 5 tax stack (TIN, withholding, 1099) is buyable if building it ever stalls.

**Trustly and Sightline (strategy doc's remaining named candidates), current status:** Trustly's US pay-by-bank gaming product remains live and serves DraftKings and FanDuel class operators ([trustly.com/us/gaming](https://www.trustly.com/us/gaming), fetched 2026-08-24) — the direct Aeropay alternative at larger scale. Sightline completed a management-led recapitalization in February 2025 and continues to operate its gaming wallet/debit stack with Cross River Bank ([PR Newswire, 2025-02](https://www.prnewswire.com/news-releases/sightline-payments-celebrates-15-years-completes-management-and-shareholder-led-recapitalization-302384957.html)); casino-cage centric, heavier than this platform needs.

### 2.3 The custody layer (separate decision from the processor)

The strategy doc (`docs/research/2026-08-16-beating-apex-strategy.md` §3.3) is definitive here and stands: pooled player funds sit in an **FBO account at a chartered bank**, sub-balances tracked on the platform's own ledger, combined with the agent-of-payee / closed-loop stored-value exemption argument — verified state by state, with California DFPI guidance the only detailed published confirmation. Candidates: **Column** (chartered bank, programmatic FBO accounts and ACH/wire/book transfers directly — fewest layers, [column.com/docs](https://column.com/docs/)), **Increase**, Lead Bank (same bought-and-rebuilt structural position as Column, per [Fintech Observer's profile](https://fintechobserver.substack.com/p/column), 2026). Synapse's 2024 collapse remains the argument against BaaS middleware without a disclosed, direct sponsor-bank relationship. Stripe Treasury drops out with Stripe (2.1).

### 2.4 The three architectures

| Model | Description | Verdict |
|---|---|---|
| Direct charge-and-payout | No stored balance: charge the entry fee at join, push the prize at settlement | Wrong for season-long: refunds on unfilled leagues, multi-league play, and re-entry all become per-transaction card events at gaming card rates; chargeback exposure spans the whole season; still requires gaming merchant approval. Underdog-class UX is impossible. |
| Custodial wallet on FBO | Deposit into pooled FBO account; entry fees, escrow, prizes are internal ledger moves; withdrawals exit via the processor | The industry-standard model, the strategy doc's model, and the one the Phase 4 sketch is already written against. Closed-loop stored value preserves the agent-of-payee argument. All internal money movement is free and instant. |
| Third-party trust/escrow | An escrow service holds each league's pot | No gaming-native turnkey vendor for season-long league escrow was found in research; effectively this collapses into the FBO model where the bank is the trust layer. Flagged as researched-and-thin rather than dismissed. |

**Research recommendation (founder decides, section 5):** custodial FBO wallet; Column-first for custody; Aeropay-class pay-by-bank as the launch deposit/withdrawal rail; Paysafe gateway and PayPal-with-approval as later additive deposit methods; Dots not adopted.

---

## 3. Seam design: PaymentsProvider

### 3.1 Two seams, not one — the sketch already draws this line and it is correct

**Seam A — `PaymentsProvider` (external money movement only).** Mirrors `getCurrentUser`/`STATS_PROVIDER`: product code imports the interface from one module, a fail-fast registry selects the implementation from env, a contract test suite runs against every implementation including the mock. Only deposits and withdrawals cross this seam. Sketch shape, updated:

```ts
// src/payments-provider/contract.ts (name avoids the budget-"ledger" collision family)
interface PaymentsProvider {
  ensureAccount(userId: UserId): Promise<ProviderAccountRef>;
  initiateDeposit(input: { userId; amountCents: number; method: DepositMethod; idempotencyKey: string }): Promise<TransferIntent>;
  initiateWithdrawal(input: { userId; amountCents: number; destination: WithdrawalDestination; idempotencyKey: string }): Promise<TransferIntent>;
  getTransferStatus(ref: TransferRef): Promise<TransferStatus>;   // pending | completed | failed | returned
  listSupportedMethods(): readonly MethodDescriptor[];             // fee + ETA per method, for the withdrawal UI
  getPooledBalanceCents(): Promise<number>;                        // FBO reconciliation input
}
```
All amounts integer cents. Webhook/async status changes arrive through one ingestion point that translates provider callbacks into typed internal events (the stats worker's shape). `MockPaymentsProvider` simulates pending-to-terminal transitions and injectable failures **and ACH returns after apparent completion** — the R01/R10 return path is the error class season-long operators actually eat, and the contract suite must force every implementation to model it.

**Seam B — the internal money ledger (not behind the provider).** Entry fee, escrow hold, prize credit, refund, rake: internal double-entry postings that never touch the provider. This is the "money facts need their own table with invariants, not derived state" requirement:

- Append-only `money_entries` with balanced posting sets: each logical transaction posts N rows summing to zero, all-or-nothing in one DB transaction. No UPDATE/DELETE code path; enforce with DB triggers exactly like the audit chain's edit-refusing triggers (migration 0021 precedent).
- Accounts, not columns: `user_available:<userId>`, `league_escrow:<leagueId>`, `platform_rake`, `provider_clearing` (pairs every external transfer with an internal posting), `held_for_review:<userId>`. Balances are sums over postings; a per-account rollup row exists solely to be `SELECT ... FOR UPDATE`d for the sufficient-balance check, backed by `CHECK (balance_cents >= 0)`.
- Every row carries `stateOfEntry` (required) and `taxYear` (stored, not recomputed) so Phase 5 builds additively (its plan's "Assumed Phase 4 interface" section binds this).
- Reconciliation: a job compares the ledger's aggregate against `getPooledBalanceCents()` daily, alerting on drift — an FBO contractual requirement, provable against the mock now.

### 3.2 The season-long operation set

| Operation | Ledger shape | Binds to |
|---|---|---|
| `collectEntryFee` | debit `user_available`, credit `league_escrow` — inside `joinLeagueInTx`'s existing transaction | `src/league-service/join.ts`; seat-capacity race already solved there; adds the balance-row lock |
| escrow hold | no operation — escrow is the account, held by construction until settlement | |
| `refundEntryFees(leagueId)` | reverse postings escrow to each member, then close the escrow account at zero | dissolution-before-draft path; roll-until-full (`roll.ts`) means never-filled leagues are a real, common path, not an edge |
| `settleSeasonPayouts(leagueId)` | debit `league_escrow` per the league's **payout structure** (new domain concept, fixed at creation, see 4.4), credit winners' `user_available`; flagged winners credit `held_for_review` instead | `integrity-service/flags.ts` open-flag read; league row locked for settlement duration |
| operator release/confiscate of a hold | `held_for_review` to `user_available`, or to a designated forfeiture account — one-way operator actions like `resolveFlag` | admin-room |
| proration | recommend **none** in Phase 4 (section 5, Q9): prizes are fixed in advance; a Phase 9 orphan-team buy-in is a user-to-user ledger transfer against the same escrow, not new prize math | |

### 3.3 Audit-chain integration

New members of the `AuditEventType` union (`src/domain/audit.ts`): `deposit_completed`, `withdrawal_requested`, `withdrawal_completed`, `entry_fee_collected`, `entry_fee_refunded`, `prize_paid`, `payout_held`, `payout_released`. Recorded via `AuditLogger.record` **in the same transaction as the ledger posting**; per ruling 4 a failed append fails the money transaction. Lock order extends ruling 3: business rows, then money rollup rows, then chain anchor last — and the detailed plan must enumerate FK lock acquisitions for every money writer (Plan C's deadlock lesson). League-scoped money events ride the league chain (member-visible activity feed treatment needs a persona pass: amounts visible to leaguemates or only the fact of payment — the deny-by-default member allowlist precedent from Plan A applies); deposits/withdrawals ride the platform chain and the per-user stream only.

### 3.4 What stays out of the seam

KYC/CIP (`IdentityVerificationAdapter`) and sanctions screening (`SanctionsScreeningAdapter`) are separate adapters with separate vendors (sketch Steps 6-7) — same registry-plus-contract-suite machinery, not folded into `PaymentsProvider`. WorkOS is authn only; it is not a KYC vendor.

---

## 4. Compliance surface: Phase 4 carries vs defers

Phase 8 (`plans/phase-8-legal-launch-readiness.md`) is the checklist of real-world signatures: counsel review of the state matrix (item 1), entity formation (2), banking/BaaS partner (3, "unblocks Phase 4"), AML/OFAC vendor (5), per-state registration (6), insurance (8). Phase 5 (`plans/phase-5-tax-compliance.md`) owns geolocation verification (its Step 3), W-9/TIN (Step 4), backup withholding (Step 5), 1099 generation/e-filing (Step 6), the state tax engine (Steps 2, 7) and the Tax Center (Step 9). Phase 4 must not duplicate any of that. What Phase 4 itself carries:

1. **Closed-loop stored value as a technical control** (strategy §3.4 item 9): no peer-to-peer transfer, no gift-card redemption, no off-platform value conversion, ever — this is a product invariant that protects the agent-of-payee exemption, and it is cheapest to enforce by never building the feature. The dossier flags it now so no future social feature ships a "send your leaguemate $10" affordance.
2. **State eligibility gating at deposit and at paid join,** as a config-driven state allowlist consuming a `stateOfEntry` input. Phase 4 consumes the value and enforces the gate; **producing** a verified location is Phase 5 Step 3 (Phase 4 stubs the input, exactly as the sketch says). The allowlist ships empty-by-default: no state is enabled until Phase 8 item 6 flips it with counsel sign-off. Known matrix facts to seed the config: HI, ID, MT, NV, WA have never permitted paid fantasy ([Saturday Down South state tracker, 2026](https://www.saturdaydownsouth.com/dfs/legal-states/)); the July 3, 2025 California AG opinion declared paid DFS illegal under Penal Code 337a while **explicitly not reaching traditional season-long fantasy** ([CA DOJ press release](https://oag.ca.gov/news/press-releases/california-department-justice-releases-legal-opinion-daily-fantasy-sports); [Hogan Lovells alert](https://www.hoganlovells.com/en/publications/ag-opinion-alert-ag-bonta-determines-daily-fantasy-sports-games-illegal-in-california)). Commish is season-long — the carve-out cuts in its favor — but the strategy doc's agent-of-payee reasoning leans on California DFPI **DFS** guidance, so counsel must reconcile the two before CA enables (Phase 8 item 1 absorbs this; flagged here so it is not lost).
3. **Age verification** at CIP time (18 baseline; several states set 21 for paid contests — the age is a per-state config column, not a constant).
4. **Self-exclusion hooks:** a platform-level exclusion flag checked at deposit and at paid join, settable by the user (account room) and by operators (admin room). Phase 4 ships the flag and the two gates; the fuller responsible-gaming surface (limits, cool-offs, state self-exclusion list integration where required) is Phase 8 scope by state. Building the hook now is cheap; retrofitting it into every money door later is not.
5. **1099 threshold tracking, not filing:** `getUserAnnualNetProfit(userId, taxYear)` computed from the ledger (prizes minus entry fees, annual net, the DraftKings/FanDuel methodology per strategy §3.1) with thresholds in a versioned config table ($600 for TY2025, $2,000 for TY2026+ per strategy §3.1 — already legislation-sensitive). Phase 5 reads this; Phase 4 only guarantees the number is computable and every row carries `taxYear` and `stateOfEntry`.
6. **UIGEA-shaped payout structures as a domain invariant.** 31 U.S.C. § 5362(1)(E)(ix) conditions the fantasy carve-out on, among other things: prizes **established and made known in advance**, and prize value **not determined by the number of participants or the fees paid** ([Edelman, Holden & Wandt, Ohio State Law Journal](https://moritzlaw.osu.edu/sites/default/files/2022-06/14.EdelmanHoldenWandt_v83-1_pp117-156.pdf); [Richmond JOLT, 2025-02](https://jolt.richmond.edu/2025/02/02/living-in-a-fantasy-how-fantasy-sports-leagues-circumvent-most-gambling-laws/)). **Does the current house model already respect this? Yes, structurally:** every house rung is a fixed 12-team league (`src/matchmaking/house-catalog.ts:41-110`, one spread `CANON`) that drafts only when full (`when_full`) or at a scheduled start, so a per-rung prize table can be published before any entry is taken and never varies with fill. What Phase 4 must add to keep it true: the **payout structure** becomes a domain concept fixed and displayed at league creation (per rung for house leagues, per league for private ones); prize copy is always "this league pays $X/$Y/$Z," never "pot = entries times fee"; and the platform's take is presented as a fixed fee alongside a fixed prize schedule. Roll-until-full and the sit-and-go rung make this wording discipline load-bearing, not cosmetic.

---

## 5. Open questions for the founder

Each is a strategy or spend call outside the loop's delegation. One word per line answers them; the stated recommendation is what the loop builds against if the answer is "default."

1. **Custody model — custodial FBO wallet, or direct charge-and-payout with no stored balance?** Recommendation: **wallet**. Season-long UX (refunds on unfilled leagues, multi-league play, instant internal moves) is impossible without it, and it is the industry-standard structure the strategy doc already argued for. (Answer: wallet / direct)
2. **FBO custody partner to pursue first (a sales process, so pick one to start):** Column, Increase, or Lead. Recommendation: **Column** — chartered bank, programmatic FBO directly, fewest intermediary layers; the Synapse lesson argues against anything with an undisclosed middleware layer. (Answer: column / increase / lead)
3. **Launch deposit/withdrawal rail:** Aeropay-class pay-by-bank first, or a Paysafe-class full gateway (cards + wallet + cash) first? Recommendation: **aeropay** — category-native (Coalition for Fantasy Sports member, PrizePicks-proven), structurally cheaper than gaming-rate cards, instant withdrawals; Trustly is the same-shape fallback if Aeropay terms disappoint. (Answer: aeropay / paysafe / trustly)
4. **Cards at launch:** accept card deposits day one, or add cards later under a gaming gateway once volume justifies the underwriting? Recommendation: **later** — pay-by-bank covers launch; card acceptance in this category means gaming-rate MCC underwriting and chargeback exposure that a pre-revenue platform should not eat first. (Answer: launch / later / never)
5. **PayPal as an additive deposit method (requires PayPal's prior written approval):** pursue the approval in parallel, or skip? Recommendation: **skip** for launch; revisit at scale. (Answer: pursue / skip)
6. **Tax stack build-vs-buy signal for Phase 5:** keep the plan-of-record (build on our ledger) or adopt a Dots-class payout/1099 vendor? Recommendation: **build** — routing prize money through third-party rails fragments the FBO closed loop that the money-transmission posture depends on. (Answer: build / buy)
7. **Launch states (Tier 1):** the loop needs a named list to seed the state-enablement config and scope counsel spend. Recommendation: start from the no-license, clearly-permitted states and the low-rate registration states (AR, TN class), exclude HI/ID/MT/NV/WA, and hold CA until counsel reconciles the AG opinion with the season-long carve-out. Founder names the list with counsel in Phase 8 item 1; Phase 4 only needs the config mechanism. (Answer: approve mechanism-now-list-later, or name states)
8. **Entry-fee ceiling at launch:** recommendation **$500** per seat as the platform maximum (config, not constant) — high enough for a "High stakes" rung to mean it, low enough to keep early AML/fraud exposure and 1099 volume manageable. (Answer: a number)
9. **Partial-season proration:** none in Phase 4 (prizes fixed in advance; orphan-team buy-in arrives with Phase 9's marketplace as a ledger transfer). Recommendation: **none**. (Answer: none / design-now)
10. **Rake model:** fixed platform fee per entry displayed alongside a fixed prize schedule, versus a percentage of the pool. Recommendation: **fixed** — a percent-of-pool presentation reads as prize value determined by fees, exactly the UIGEA condition to stay away from; a fixed fee with a published prize table keeps every surface's copy safe. (Answer: fixed / percent)

---

## Source list (all fetched or searched 2026-08-24)

- Stripe restricted businesses: https://stripe.com/legal/restricted-businesses
- WiseAlt on Stripe and iGaming: https://wisealt.com/stripe-payments-company-not-suited-for-igaming-heres-what-you-should-know/
- DirectPayNet, Stripe restricted list 2026: https://directpaynet.com/business-restricted-from-using-stripe/
- Braintree AUP: https://www.paypal.com/us/legalhub/braintree/acceptable-use-policy
- Legal Sports Report, PayPal seizure arbitration: https://www.legalsportsreport.com/71418/seizure-of-paypal-accounts-case-to-arbitration-gaming-dfs/
- Paysafe US iGaming: https://www.paysafe.com/us-en/industries-we-serve/igaming/
- Paysafe Pay with Crypto (2026-05-14): https://ir.paysafe.com/news-events/press-releases/detail/261/paysafe-launches-pay-with-crypto-solution-to-meet-us-igaming-market-demand
- Aeropay gaming: https://www.aeropay.com/gaming
- Aeropay joins Coalition for Fantasy Sports (2025-03-12): https://www.aeropay.com/in-the-news/aeropay-becomes-first-vendor-member-to-join-coalition-for-fantasy-sports
- Payments Dive on Aeropay: https://www.paymentsdive.com/news/aeropay-pay-by-bank-payments-evolution-gaming-cannabis/725255/
- Dots: https://usedots.com/ and https://usedots.com/solutions/esports/
- Trustly US gaming: https://www.trustly.com/us/gaming
- Sightline recapitalization (2025-02): https://www.prnewswire.com/news-releases/sightline-payments-celebrates-15-years-completes-management-and-shareholder-led-recapitalization-302384957.html
- Column docs: https://column.com/docs/
- Fintech Observer on Column and Lead: https://fintechobserver.substack.com/p/column
- FFPC terms (deposit/withdrawal methods): https://myffpc.com/cms/public/trust/terms-and-conditions
- UIGEA carve-out scholarship: https://moritzlaw.osu.edu/sites/default/files/2022-06/14.EdelmanHoldenWandt_v83-1_pp117-156.pdf and https://jolt.richmond.edu/2025/02/02/living-in-a-fantasy-how-fantasy-sports-leagues-circumvent-most-gambling-laws/
- CA DOJ press release, DFS opinion (2025-07-03): https://oag.ca.gov/news/press-releases/california-department-justice-releases-legal-opinion-daily-fantasy-sports
- Hogan Lovells alert on the CA AG opinion: https://www.hoganlovells.com/en/publications/ag-opinion-alert-ag-bonta-determines-daily-fantasy-sports-games-illegal-in-california
- State legality tracker: https://www.saturdaydownsouth.com/dfs/legal-states/
- Internal: docs/research/2026-08-16-beating-apex-strategy.md (§3), plans/phase-4-payments.md, plans/phase-5-tax-compliance.md, plans/phase-8-legal-launch-readiness.md, plans/00-roadmap.md, docs/research/2026-08-23-backend-gaps-backlog.md
