# Payments gateway application pack (Paysafe first, Nuvei alternate) — FOUNDER-GATED, prepared but NOT submitted

**Date prepared:** 2026-08-25 (Phase 4, Task 14). **Status:** ready for founder review. **Nothing in this repository submits, signs, or spends** (founder decision 2). This is the gaming-MCC merchant application pack for card acceptance — founder decision 3 named the rails posture: BOTH an Aeropay-class pay-by-bank rail AND a gaming-gateway merchant application for cards, **Paysafe first, Nuvei alternate**, with the application prepared at phase kickoff **because underwriting is the long pole**. The pack being ready now is what makes day-one submission possible the moment the sign-off line below is filled.

**Why Paysafe first:** the dossier (`docs/research/2026-08-24-phase4-payments-research.md` §2.2, fetched 2026-08-24): Paysafe operates a dedicated US iGaming vertical serving licensed operators and DFS brands, is accustomed to regulated-entity onboarding, and aggregates cards, the Skrill wallet, Paysafecash and Pay by Bank behind one gateway. Fees in this vertical are not published — **get a term sheet before deciding anything priced below.** Nuvei is the named alternate at the same underwriting shape. Stripe is refused for money motion (AUP-prohibited category, dossier §2.1 — terminal platform risk); PayPal is skipped (founder decision 5).

**How to use this pack:** every `[FOUNDER: …]` field is founder/counsel-supplied. The entity block is identical to the Column pack (`docs/decisions/column-fbo-application.md` §1) — fill it once, reference it here.

---

## 1. Entity block

Same as the Column FBO pack §1 (`[FOUNDER: fill there, attach here]`). Gaming-MCC underwriting will additionally expect: the state-by-state legality memo (Phase 8 item 1), the AML program (Column pack §7), and any gaming-vertical registrations held (`[FOUNDER: none yet / list]`).

## 2. The underwriting story

What a gaming-MCC underwriter will see, stated plainly rather than discovered in diligence:

- **Merchant category:** real-money season-long fantasy sports — paid-entry skill contests under the UIGEA fantasy carve-out, with the fixed-prize posture held as a code-level invariant (prizes published in advance, never a function of entries or fees; fixed per-entry platform fee, never percent-of-pool — founder decision 10, `src/money/prize-table.ts`).
- **Processing history: none.** Pre-launch platform, stated outright. **Mitigation: the launch plan is pay-by-bank-first** — the Aeropay-class account-to-account rail carries launch deposits and withdrawals, so card volume ramps only after the platform is operating, and the gateway is never asked to carry a cold start.
- **Closed-loop wallet:** card deposits fund a stored-value balance inside a pooled FBO account (Column pack §3). Entry fees, escrow and prizes are internal ledger moves that never touch the card networks. No peer-to-peer transfer, no gift cards, no off-platform value conversion, ever.
- **Compliance stack already built:** KYC before any balance, state-enablement allowlist that ships empty, self-exclusion, append-only double-entry ledger, tamper-evident audit chain, zero-tolerance reconciliation, operator-held payouts for flagged accounts (Column pack §5 lists each with its file).

## 3. Chargeback controls

1. **No card withdrawals, structurally.** Withdrawals exist only as bank transfers through the payments provider seam — there is no code path that pushes money to a card, and the closed-loop wallet means a card deposit's only exits are entry fees inside the platform or a bank withdrawal by the same verified member. This kills the classic gaming chargeback pattern (deposit on card, cash out elsewhere, dispute the deposit).
2. **KYC-verified cardholders only.** A deposit is refused until the member's identity is verified (`moneyGates`, `src/money-service/gates.ts`) — the cardholder and the account holder are the same vetted person.
3. **Bounded exposure per transaction and per user:** deposits are $5.00 minimum, $1,000.00 maximum per transfer, rate-limited per user (`MONEY_CONFIG.deposit`, `src/money/config.ts`); entry fees cap at $500.00 per seat (founder decision 8).
4. **Full transaction forensics:** every deposit is idempotency-keyed, ledgered against an immutable double-entry book, and hash-chain audited — representment evidence is a query, not a reconstruction.
5. **ACH-return machinery generalizes:** the same clawback-and-receivable path built for ACH returns (`src/money-service/deposits.ts`) is the landing mechanism for a card chargeback — funds claw back, any shortfall becomes a receivable, and every paid door closes until it settles.

## 4. The card-fee model — the OPEN founder decision (eat vs surface)

Pay-by-bank is free to the player either way. For cards, at modeled gaming-MCC rates — **3.25% + $0.30, a model to be replaced by the term sheet, not a shipped price** — a $100 card deposit costs ≈ $3.55:

- **Eat it:** on a $20-entry league with a $2 platform fee, one $100 card depositor consumes the entire rake of ~1.8 entries — margin-negative for small leagues, invisible to players.
- **Surface it:** the deposit form reads "Card fee $3.55. Bank transfers are free." — margin-clean, steers players to the cheaper rail, costs conversion at the exact moment of highest anxiety.

The code carries both models so the wallet UI is already correct under either answer: the mock provider's method descriptors hold the modeled card fee (`feeCents: 30`, `feePercentBasisPoints: 325` — `src/payments-provider/mock/mock-payments-provider.ts`), behind a `surfaceCardFee` switch that **ships off** — the fee renders as $0 pending the founder's word, so no player ever sees a number the founder has not priced. **The founder decides; nothing in this plan does.**

## 5. Projected card volumes

| Question | Answer |
|---|---|
| Projected card deposits / month (count, $) | `[FOUNDER]` |
| Average card deposit | `[FOUNDER]` (bounds as §3.3) |
| Card share of deposits vs pay-by-bank | `[FOUNDER: estimate — pay-by-bank is the default rail]` |
| Expected chargeback rate | `[FOUNDER: with the §3 controls as the argument for a low one]` |

## 6. PCI posture — SAQ-A intent, recorded as a binding constraint

**No PAN ever touches this codebase.** Card acceptance, when it lands, uses the gateway's hosted fields / redirect flow exclusively: card data goes browser-to-gateway, the platform receives only a token and a webhook. This is recorded here as a **binding constraint on any future card implementation** — an adapter that would bring card numbers server-side does not pass review, whatever else it offers. Scope target: SAQ-A. The existing webhook ingestion point (`src/payments-provider/ingest.ts` — raw-byte HMAC verification before a byte of body reaches any decision) is the shape a real gateway callback lands in.

## 7. Timeline — underwriting is the long pole

Gaming-MCC underwriting conventionally runs weeks-to-months of diligence (entity, legality memo, AML program, principals). That is why this pack exists on day one of the money phase and why submission should follow the founder's sign-off immediately rather than waiting on launch proximity. **Cards at launch remain gated on underwriting clearing (founder decision 4); if it has not cleared, launch opens pay-by-bank-only.** That fallback is recorded here, now, so nobody re-litigates it in December: launch does not slip for card underwriting, and card acceptance switches on when the gateway clears — behind the same provider seam, after the adapter passes the contract suite unchanged (`src/payments-provider/contract-suite.ts`, ACH-return case included).

---

## Sign-off — nothing above may be submitted until this line is filled

Founder approval to submit: ______ date ______
