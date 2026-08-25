# Column FBO application pack — FOUNDER-GATED, prepared but NOT submitted

**Date prepared:** 2026-08-25 (Phase 4, Task 14). **Status:** ready for founder review. **Nothing in this repository submits, signs, or spends** (founder decision 2). This pack exists so that the day the founder signs off, the Column conversation starts with every answer already written down instead of a scramble — decision 3's "application started at phase kickoff" is satisfied by this document being ready, with submission itself gated on the sign-off line at the bottom.

**Why Column first:** founder decision 2, on the dossier's recommendation (`docs/research/2026-08-24-phase4-payments-research.md` §2.3): Column is a chartered bank offering programmatic FBO accounts and ACH/wire/book transfers directly ([column.com/docs](https://column.com/docs/)) — the fewest intermediary layers. Synapse's 2024 collapse is the standing argument against BaaS middleware without a disclosed, direct sponsor-bank relationship. Increase and Lead Bank are the named alternates if Column terms disappoint.

**How to use this pack:** every `[FOUNDER: …]` field is a fact only the founder (or counsel) can supply — this repository never invents a legal name, EIN, address, owner, or volume figure. Everything else is drawn from the shipped code and the dossier's sourced facts, with file pointers so an underwriter's follow-up question has a verifiable answer. Dossier facts were fetched 2026-08-24; counsel re-verifies at signing.

---

## 1. Entity block (KYB)

Phase 8 item 2 owns entity formation. **If the entity is not yet formed, say so on the application rather than papering over it** — Column's KYB cannot complete without it, and this is the first real-world gate.

| Field | Value |
|---|---|
| Legal entity name | `[FOUNDER: legal name]` |
| Entity type / formation state | `[FOUNDER: e.g. Delaware C-corp / LLC]` |
| EIN | `[FOUNDER: EIN]` |
| Formation documents | `[FOUNDER: attach certificate of formation / incorporation]` |
| Registered address | `[FOUNDER: address]` |
| Website / product name | commish.ly — "Commish" |
| Beneficial owners (25%+ equity, per FinCEN CDD rule) | `[FOUNDER: name, DOB, address, SSN/passport, ownership % — one row per owner]` |
| Control person | `[FOUNDER: the individual with significant managerial control]` |
| Officers / directors | `[FOUNDER]` |

## 2. Product description (agent-of-payee terms — the honest version)

Commish is a **season-long real-money fantasy football platform**. Members deposit funds, pay a fixed entry fee to join a league, and the league's prize pool is paid out at season end against a prize table **established and made known in advance**, whose value is **never determined by the number of participants or the fees paid** — the UIGEA fantasy carve-out conditions (31 U.S.C. § 5362(1)(E)(ix)), held as a domain invariant in code (`src/money/prize-table.ts`, `prizeTableInvariant`: prizes plus the platform's fixed per-entry fee must equal the pot exactly; percent-of-pool rake is refused everywhere, including copy — founder decision 10).

The platform acts as **agent of the payee**, holding player funds in a closed-loop stored-value system:

- **No peer-to-peer transfer, no gift-card redemption, no off-platform value conversion, ever.** Product law, recorded in `docs/money.md` (dossier §4.1) — money enters by deposit, moves internally only as entry fee / escrow / prize / refund, and leaves only by withdrawal to the member's own bank account.
- The platform never becomes its own processor, bank, or KYC bureau — external money motion sits behind a provider seam (`src/payments-provider/`), custody sits at the partner bank.
- Season-long only. The July 2025 California AG opinion reached daily fantasy and explicitly not traditional season-long play; the state-enablement posture below is conservative regardless.

## 3. The FBO structure requested

- **One pooled FBO deposit account** at Column, held for the benefit of platform members.
- **Sub-balances tracked on the platform's own append-only double-entry ledger as the book of record** (founder decision 1): `money_accounts` / `money_transactions` / `money_entries` (`drizzle/0035_money_foundations.sql`), immutable by database trigger, every posting set balanced to the cent or refused (`src/money-service/post.ts` — the one writer).
- Rails requested from Column: **ACH origination and receipt, wires, book transfers** — deposits in, withdrawals out, through the payments gateway rail(s) named in the companion pack (`docs/decisions/payments-gateway-application.md`).
- The ledger's `fbo_pool` account mirrors the bank balance; the reconciliation surface (§5) exists to keep the two provably in agreement.

## 4. State matrix and counsel memo status

- **State enablement ships empty** (founder decision 7): `src/money/states.ts` — `MONEY_STATES.enabled: []`. No state is enabled anywhere until the founder names the list with counsel (Phase 8 item 1). Until then every money door in the product refuses (`moneyGates`, `src/money-service/gates.ts`), and every league is free.
- **Never-eligible, pinned in code:** HI, ID, MT, NV, WA have never permitted paid fantasy (dossier §4.2 sources); `assertEnableable` refuses them at runtime regardless of what counsel says about anything else.
- **California:** on neither list. The 2025 AG opinion covered DFS and explicitly not season-long; counsel must reconcile it with the DFPI agent-of-payee guidance before CA is ever enabled.
- Counsel memo status: `[FOUNDER: engaged / drafted / signed — Phase 8 item 1]`.
- Per-state minimum age is a required field on every enabled-state entry (`MoneyStateEntry.minAge`) — a state cannot be typed into the config without stating its age.

## 5. Operational controls exhibit (built and tested — the reconciliation design)

This is the section an FBO underwriter cares most about, and it is the part that already exists as tested code rather than intention:

1. **One writer, four laws.** Every money movement goes through `postMoneyTransaction` (`src/money-service/post.ts`): balanced-or-refused posting sets, league row locked first, rollup rows locked in sorted order (deadlock-free by total order), audit append in the same transaction — an audit failure rolls the money back.
2. **Append-only by trigger, not by promise.** `UPDATE`/`DELETE` on `money_entries`/`money_transactions` raise at the database (`drizzle/0035`); a negative player-facing balance is refused by CHECK constraint. History cannot be edited, only appended.
3. **Tamper-evident audit chain.** Every money event (`deposit_completed`, `deposit_returned`, `withdrawal_*`, `entry_fee_*`, `prize_paid`, `payout_held`, `payout_released`, KYC and self-exclusion transitions) joins the platform's hash-chained audit log (`src/integrity-service/audit-logger.ts`), verified end-to-end by `npm run audit:verify`.
4. **Reconciliation, zero tolerance.** `reconcileMoney` (`src/money-service/reconcile.ts`) answers four checks as figures, never a boolean: ledger `fbo_pool` vs the bank's own pooled balance (`getPooledBalanceCents()`), the double-entry law (assets = liabilities), the non-negative floor on every member balance, and escrow-by-league consistency. Tolerance is zero cents (`MONEY_CONFIG.reconcileToleranceCents`); any drift is named to the cent. Run by script (`npm run money:reconcile`) and an operator panel; a daily cadence becomes an ops runbook line when the bank relationship is live.
5. **KYC before balance.** A member cannot deposit or pay an entry fee until `kyc_status === "verified"` — the status is written only by the KYC provider callback path (`src/money-service/kyc.ts`, behind the `KycProvider` seam, `src/payments-provider/kyc-*`). The verification vendor is a separate signature (Persona/Alloy-class, Phase 8).
6. **Self-exclusion.** A one-way member-set flag closes every door money enters (deposit, paid join) while never blocking withdrawal of the member's own funds (`src/money-service/exclusion.ts`, `gates.ts`).
7. **ACH returns modeled as a first-class failure.** A deposit that completes and returns days later (NACHA R01/R10 class) claws back available funds and books any shortfall to a `platform_receivable` — never a negative member balance, and every paid door stays closed until the debt settles (`src/money-service/deposits.ts`). The provider contract suite makes return-after-completion a mandatory case for any real adapter (`src/payments-provider/contract-suite.ts`).
8. **Payout integrity.** Settlement is operator-triggered, never automatic; it pays only the stored, published prize table, refuses unless escrow lands at exactly zero, and diverts a flagged winner's prize to `held_for_review` pending investigation (`src/money-service/settlement.ts`).
9. **Tax visibility.** Every ledger row carries `state_of_entry` and `tax_year`; annual net profit per member is answerable against the versioned 1099 thresholds (`getUserAnnualNetProfit`, `src/money-service/read.ts`) — Phase 5 files, Phase 4 answers.

## 6. Expected volumes

All founder-fill — the platform has not launched and this repository does not invent projections. Stated bounds are the shipped config (`src/money/config.ts`).

| Question | Answer |
|---|---|
| Expected deposits / month (count, $) | `[FOUNDER]` |
| Average deposit size | `[FOUNDER]` (config bounds: $5.00 minimum, $1,000.00 maximum per transfer) |
| Average entry fee | `[FOUNDER]` (platform ceiling: $500.00 per seat, founder decision 8 — config, not constant) |
| Expected pooled FBO balance at season peak | `[FOUNDER]` |
| Expected withdrawals / month (count, $) | `[FOUNDER]` |
| Launch states and timing | `[FOUNDER + counsel — Phase 8 item 1]` |

## 7. AML program status

Four-pillar program — **owner: founder + counsel**, not this codebase. The platform-side hooks that exist today: KYC-before-balance, self-exclusion, the `held_for_review` landing mechanism for screening hits, and the append-only ledger every investigation reads. The AML/OFAC screening vendor itself is Phase 8 item 5 (`SanctionsScreeningAdapter`, deferred D4).

| Pillar | Status |
|---|---|
| Written AML policy | `[FOUNDER: drafted / adopted]` |
| Named compliance officer | `[FOUNDER: name]` |
| Employee training program | `[FOUNDER]` |
| Independent review | `[FOUNDER: scheduled / completed]` |

---

## Sign-off — nothing above may be submitted until this line is filled

Founder approval to submit: ______ date ______
