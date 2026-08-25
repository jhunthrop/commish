# Money Foundations — Phase 4's decision record

**Status:** closed 2026-08-25. **Plan:** `docs/superpowers/plans/2026-08-24-phase4-money-foundations.md` (supersedes `plans/phase-4-payments.md`, the old 8-step sketch — the plan's supersession table maps every sketch step to its fate). **Spec:** `docs/research/2026-08-24-phase4-payments-research.md`. **System doc:** `docs/money.md`. This file is the why: the founder decisions that bound the phase, every ruling made while executing it, and the deviations that were argued and accepted. The execution ledger itself is `.superpowers/sdd/2026-08-24-phase4-money-foundations/progress.md`.

## The ten founder decisions (recorded 2026-08-24 — these bind verbatim)

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

Decisions 2 and 3's real-world half landed as the two founder-gated application packs, prepared and never submitted: `docs/decisions/column-fbo-application.md` and `docs/decisions/payments-gateway-application.md` — each ends in a blank sign-off line.

## The plan's fourteen self-rulings (argued in the plan; held throughout execution)

Restated in one line each; the plan's "Open questions, self-ruled" section carries the full arguments.

1. The money family is named `money_*`, never "ledger" (`src/stats-pipeline/budget.ts` owns that word for API budgets).
2. The audit enum grows by migration; the frozen-enum ruling binds design passes, not a phase whose charter is a new fact family (`ALTER TYPE … ADD VALUE`, migrations 0036/0039).
3. `src/money` is the ninth pure exempt directory — the wallet renders the same refusal sentences and ceilings the server enforces.
4. KYC is its own `KycProvider` interface inside `src/payments-provider/` — different vendor and timeline than the money rail, same registry pattern.
5. An ACH-returned deposit never drives a balance negative; the shortfall becomes `platform_receivable`, and every paid door closes until it settles.
6. Rake is swept at settlement, not at join — pre-draft refunds stay trivially whole, escrow-to-zero stays arithmetic.
7. Dissolution exists now, operator-only, pre-draft only — twelve held entry fees make a no-exit league a custody problem.
8. Deposits post nothing until completion; withdrawals debit at request.
9. League money events carry amounts in the league feed; personal money events never appear there.
10. `stateOfEntry` is per-entry at settlement (winner's state on prizes, seat's state on rake), per-transaction everywhere else.
11. The free-season sentence is derived from `moneyIsLive()`, with the two pre-existing assertions preserved character-for-character.
12. Reconciliation is level-triggered — a script and an admin button, no scheduler.
13. Settlement is manual forever in this phase — operator-triggered, never automatic.
14. The e2e suite gains one dark-state spec and no money-flow specs; the first enabled state's plan owes the money e2e journey (D6).

## Controller rulings, task by task (from the execution ledger)

**Task 1 — vocabulary.** Prize-table places must be contiguous from 1: a paid league pays 1st..Nth, and a gap is a data-entry error — stricter is safer. Safe-integer guards check every input AND every computed sum (two individually safe amounts can sum past `MAX_SAFE_INTEGER`).

**Task 2 — schema; the feed-visibility pre-ruling.** League-scoped money events `entry_fee_collected` / `entry_fee_refunded` / `prize_paid` are **visible in the league activity feed** — the fee is a published league term and the prize table is public in-league, so neither leaks a private fact. `payout_held` / `payout_released` stay **hidden from members** — a hold names a suspicion (the accusatory-surface rule); they live in the operator console. All deposit/withdrawal events stay platform-private.

**Task 3 — the writer.** Idempotency is three documented layers: pre-lock fast path, post-lock re-check **before** the balance floor (the load-bearing fix — the review's CRITICAL found a debiting race in the original statement order), and the unique-index savepoint backstop.

**Task 4 — Seam A.** `feePercentBasisPoints` accepted as a shape addition (percent-plus-fixed card fees cannot be stated as flat cents; shipped zeroed until the founder prices fees). The review's HIGH moved three invariants from the mock's own tests into the **portable** contract suite (returned-only-from-completed, unknown-ref rejection, replay-disagreement) — the rule set then and forever: if the mock fails a new portable case, the MOCK is fixed, never the case.

**Task 6 — netting (the review HIGH).** An indebted member could have drained `user_available` whole, stranding `platform_receivable` with no collection path. **Ruled: net at withdrawal** — settle `min(available, owed)` from the available balance before anything reserves, in the same transaction; the one unavoidable case (the debt consumed everything) refuses with its own money-first sentence, and the settlement **stands** even when the refusal fires. Blocking withdrawals outright was rejected: it holds a user's money hostage to a debt payable from it. Also ruled here, as standing coverage policy: provably-unreachable defensive throws take explicit v8 ignore annotations **with a justification docblock naming why unreachable** — the 100% gate keeps meaning through visible argued exemptions.

**Task 7 — chain-audit for compliance events (an overruling).** The task shipped self-exclusion and KYC transitions without audit events, reading the frozen-enum posture conservatively. **Overruled:** `self_exclusion_set`, `self_exclusion_cleared` and `kyc_status_changed` join the tamper-evident chain via migration 0039 — self-exclusion is a responsible-gaming action whose disputes the chain exists for, and KYC transitions are compliance facts. `self_exclusion_cleared` REPLACES an `admin_action` pairing (paired events blur authority). All three are **hidden** from member feeds: a person's verification and exclusion are their own private facts, operator console only. The review's HIGH became the guarded `WHERE` on the KYC update — a stale async writer must never regress `verified` — with the masking early-exit removed so the guard stays load-bearing, plus the two-layer shape (pre-read = cost control, guarded write = correctness).

**Task 8 — the dark gate, defense-in-depth.** The review's MEDIUM: the dark-season refusal was re-spelled at several layers. **Fixed by moving the gate INTO `leagueMoneyOrRefuse` itself** with an injectable live switch defaulting to `moneyIsLive()` — all three layers inherit the refusal from the one rule, and the sentence lives beside it. The Task 5 carry landed as mechanism, not advice: the entry-fee posting re-checks the receivable **under the writer's locks** (the gate alone is advisory), mutation-proven.

**Task 9 — dissolution, and the join hole.** "Season state" resolved to `drafts.status` gaining a fourth value, `'dissolved'` (migration 0040) — the same column every read already consults, so browse departure needed no new query. `league_dissolved` rides as an actorless `system_action` (`actorType: "system"`, operator id on the payload for the console trail). Team rows are kept on dissolution (history); no rate limiter on the dissolve route (the guarded UPDATE bounds repeats to a plain refusal). **The join hole:** a dissolved paid league reachable by a still-valid invite link could have taken a fee into dead escrow. **Ruled closed at `joinLeagueInTx` itself** — the shared door — with a plain `drafts.status` read off the already-locked league row, refusing with the EXISTING `DRAFT_ALREADY_STARTED` sentence (one collapsed sentence, no dissolved-vs-started oracle), so the invite and public doors both inherit it and a stranded-fee scenario is impossible; proven with a two-door `expectNoPostingTookPlace` test.

**Task 10 — settlement.** (1) **Constructive receipt:** a released hold is income in the RELEASE's tax year — the held-prize tax gap was a correctness bug against the Task 3 guarantee, not a Phase 5 deferral; `getUserAnnualNetProfit` counts `hold_release` in the release posting's own `taxYear`, and confiscations never count, proven across a year boundary. (2) **`admin_action` gains a third publisher** (settlement's hold outcomes, beside `grantAdmin` and chat moderation) — the plan assigned it, superseding Phase 3 Plan B's two-publisher enumeration; recorded in `docs/conventions.md`. (3) `releaseHold` without resolved flags stands as operator judgment, with the safety argument in the source docblock. (4) The vacated-winner adversary is answered by a fresh `seatedIds` read refusing a departed winner's whole settlement before any posting.

**Task 11 — reconciliation.** The `user_available` floor check is proven via a fabricated row rather than DB corruption (the DB CHECK makes the real case unreachable — the honest call). No audit event on drift (matches `verify-audit-chain.ts`'s own precedent). The dev database received migrations 0035-0040 once, disclosed and accepted (additive/idempotent; the alternative was an unrunnable e2e checkpoint). Two A/B-confirmed pre-existing e2e failures (house ticker timeout, dispute-queue count) were ledgered as environment items for the closing battery's fresh-seed triage, not tickets.

**Task 12 — the wallet.** All three review adjudications accepted: `GET /api/wallet` stands as an ordered deliverable even prop-driven; the wallet shows the escrow **aggregate** (the brief's literal spec), with per-league rows ledgered as a money-live fast-follow since `read.ts` already groups by league; red on the exclusion confirm is the destructive token's structural job with the copy carrying the supportive tone. The mock-provider singleton (`getSharedPaymentsProvider`) closed a real gap: per-route instances made deposits invisible to reconciliation and could mint colliding `mock-transfer-N` refs.

**Task 13 — join surfaces.** All four adjudications answered from reachability: the public door's missing attestation UI is unreachable theater while money is dark (the server gate is door-agnostic), so the UI joins the money-live task (two-door symmetry, the Task 9 lesson class, on the checklist); `entryFeeCents` on `LeagueTerms` beyond the literal field list was necessary; `LeagueTermsPanel` fee rendering and `acceptInviteSchema` `stateOfEntry` are correctly deferred to money-live.

## Deviations accepted, with their arguments

**Task 5's five (review-adjudicated, all accepted):**
1. **Migration 0037 `payment_transfer_intents`** — unplanned table; necessary because a provider callback cannot carry the attribution (user, state) the completion posting needs. Minimal and necessary.
2. **`ensureAndLockMoneyAccounts` exported** from `post.ts` — behavior-identical extraction; the clawback and receivable-settlement splits must decide posting shapes from balances no concurrent transaction can move.
3. **Form-minted namespaced `idempotencyKey`** — server-prepended namespace with a cross-user collision test, so one user's key cannot replay another's transaction.
4. **Deposit-whole-then-receivable-settlement atomic ordering** — verified un-interleavable with exactly one audit event.
5. **Age enforced at the KYC seam**, not a gate-side check — the platform deliberately stores no date of birth; `kyc_status === "verified"` against the state's `minAge` is the only age attestation it holds.

**Other accepted deviations:** the audit event list grew from the dossier's eight to ten (`deposit_returned`, `withdrawal_returned` — a return riding a `*_completed` payload would hide the one event an auditor most wants), then to thirteen with Task 7's three compliance events (0039); `withdrawal_returned`'s payload-outcome overload for failure-vs-return follows the `trade_rejected` precedent; reserve-before-provider-call on withdrawals is a strengthening (nothing tells the bank to move money the ledger has not set aside); Task 12's `renderWalletContent` module split (a `next build` constraint on page-file exports); Task 9's fixture ripple in `lock-order.test.ts` (a real join can no longer hold a lock for a league with no scheduled draft, so raw bystander transactions became the honest fixture).

## Deferred and refused (the fact each is waiting on)

| # | Item | Decision | Waits on |
|---|---|---|---|
| D1 | Real provider implementations (Column, Aeropay, Paysafe/Nuvei) | Deferred, founder-gated | Decision 2: no signature, no spend. Each must pass the contract suite unchanged, ACH returns included. |
| D2 | Commissioner-initiated dissolution | Deferred | Refund UX plus an abuse story; operator dissolution covers custody. |
| D3 | Enhanced KYC tier (document + liveness above a threshold) | Deferred | The real vendor's actual capabilities. |
| D4 | AML/OFAC screening + velocity monitoring | Deferred to Phase 8 item 5 | The vendor signature; `held_for_review` is the landing mechanism, built now. |
| D5 | Always-on escrow chrome indicator | Deferred | A first enabled state — chrome that renders for nobody is untestable decoration. |
| D6 | Money-flow e2e journeys | Deferred | An enabled state and a walkable provider; integration tests carry the flows. |
| D7 | PayPal deposits | Refused | Founder decision 5. |
| D8 | Dots-class payout/1099 vendor | Refused | Founder decision 6 — third-party payout rails fragment the FBO closed loop. |
| D9 | Stripe anywhere in money motion | Refused | AUP-prohibited category; terminal platform risk. Phase 6 SaaS billing is a different merchant category. |
| D10 | Peer-to-peer transfer, gift cards, off-platform conversion | Refused, permanently | The closed loop IS the agent-of-payee argument — product law in `docs/money.md`. |
| D11 | Proration / partial-season entry | Refused | Founder decision 9. |
| D12 | Percent-of-pool rake, anywhere, including copy | Refused | Founder decision 10; `prizeTableInvariant` and the copy sweeps enforce it. |

## Still founder-gated after this phase

Submission of either application pack (blank sign-off lines). The launch-state list (mechanism ships empty). Any Column signature or spend. The card-fee eat-vs-surface answer (modeled, shipped surfaced-off). The full money-live checklist lives in `docs/money.md`.
