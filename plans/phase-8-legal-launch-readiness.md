# Blueprint: Commish — Phase 8: Legal & Launch Readiness

**Objective:** Unblock the real-world prerequisites that Phases 4 (Payments), 5 (Tax Compliance), and 7 (Native Apps) each flagged as non-software business/legal work, and formally sequence the go-live of Tier 1 states per the strategy doc's recommendation. **This phase is mostly not code.** It's the checklist that turns "the software supports this" into "this is actually legal and operating for real users."

**Source strategy doc:** `docs/research/2026-08-16-beating-apex-strategy.md` (Sections 2, 3, 8, 9 — the legal matrix, payments architecture, go-to-market recommendation, and risks/open questions)

**Depends on:** Phases 4, 5, and 7 having built their software-side prerequisites (adapter interfaces, state-enablement flags, API contracts) so that completing this phase's business steps is a configuration/contract change, not a rewrite.

**A note on what I (as a coding agent) can and can't do here:** I can draft documents, generate compliance checklists, build the software-side feature flags and adapters this phase needs, and track status. I cannot sign a contract, open a bank account, retain an attorney, or file a state registration on your behalf — those need you (or whoever's running this) as a real legal person/entity. Each item below is marked **[YOU]** or **[ME]** accordingly.

---

## Readiness Checklist (not code steps — sequenced tasks)

### 1. Legal review of the state matrix — **[YOU, with counsel]**
- [ ] Retain a gaming/regulatory attorney to independently verify the Tier 1–4 state classifications in strategy doc §2, since several facts there came from secondary sources during initial research (flagged explicitly in §9)
- [ ] Get written confirmation of the specific Tier 1 launch list (target: Arkansas + the ~12 other no-license states named in §2.3) before flipping any state's enablement flag live
- [ ] Confirm the game-design rules (no single-team outcome basis, no preselected teams, no fully-automatic draft with zero input) are satisfied by the actual product built in Phases 1–6 — have counsel review the live draft engine's behavior, not just the spec

### 2. Business entity formation — **[YOU]**
- [ ] Form the operating entity (LLC/corp) in the state of primary operation
- [ ] Obtain an EIN
- [ ] Set up the entity's registered-agent presence in each Tier 1 state as required

### 3. Banking/BaaS partner — **[YOU, unblocks Phase 4]**
- [ ] Evaluate and sign with an FBO-account banking/BaaS partner (Column, Increase, Stripe Treasury, or equivalent — per strategy doc §3.3)
- [ ] Confirm the partner's agent-of-payee / closed-loop-stored-value structure holds up under California DFPI's published guidance and get the partner's own compliance team to confirm applicability state-by-state
- [ ] **[ME]** once signed: swap Phase 4's mock/sandbox payment-provider adapter for the real partner's API — this should be a config/adapter change per Phase 4's design, not a rewrite

### 4. Data licensing — **[YOU, unblocks a later data-quality upgrade]**
- [ ] Get quotes from SportsDataIO, SportRadar, and Genius Sports for a real-time NFL stats feed
- [ ] Sign a licensing contract
- [ ] **[ME]** once signed: implement the real adapter behind Phase 2's stats-provider interface, replacing the mock dataset

### 5. AML/OFAC screening vendor — **[YOU, unblocks Phase 4]**
- [ ] Select and contract with an AML/sanctions-screening vendor
- [ ] **[ME]** once signed: implement the real adapter behind Phase 4's screening interface

### 6. Per-state registration/tax setup — **[YOU, unblocks Phase 5's state-enablement flags]**
- [ ] For each Tier 1 state: complete any required registration, set up the tax remittance account (e.g. Arkansas's ATAP), confirm the filing cadence matches Phase 5's config table
- [ ] For each state, once fully compliant: flip that state's enablement flag (built in Phase 5) to live — **this is a config change, not a code deploy**, by design
- [ ] Track Tier 2 states as a rolling backlog, added only as revenue justifies the fee (per strategy doc §2.3's recommendation) — do not front-load Tier 2/3 work before Tier 1 is proven

### 7. App Store / Play Store accounts — **[YOU, unblocks Phase 7]**
- [ ] Apple Developer Program enrollment
- [ ] Google Play Developer account enrollment
- [ ] Draft a privacy policy and age-rating documentation appropriate for a real-money product (a stricter bar than a typical consumer app)

### 8. Insurance & liability review — **[YOU, with counsel]**
- [ ] Review liability exposure for the AI advisory layer (Phase 6) — what happens if a user claims financial loss from following bad AI advice; confirm the advisory-only/human-confirmation-required design (Phase 6 Step 3) is sufficient, or if additional terms-of-service language or insurance is warranted
- [ ] General business liability and cyber-liability coverage appropriate for a platform handling real money and PII

### 9. Go-live sequencing
- [ ] Do not flip any state live (item 6) until items 1–3 and 5 are complete for that state
- [ ] Launch order: Tier 1 states first, as a single go-live event once the full stack (Phases 1–6) has passed integration testing (Phase 1 Step 11-style, exercised against the real payment/tax adapters, not sandboxed ones) in a staging environment
- [ ] Native app submission (item 7) can happen in parallel with the web launch — it doesn't block Tier 1 web go-live, per Phase 7's parallel-track framing

---

## Exit criteria for this phase
- Every **[YOU]** item above is complete and documented
- Every **[ME]** adapter swap is complete and passing the same test suite that validated the mock/sandbox version
- Counsel has signed off in writing on the specific Tier 1 state list actually being launched
- A staging environment has run Phase 1's end-to-end integration test (Step 11) against real (not sandboxed) payment, tax, and data adapters at least once before any state's flag goes live
