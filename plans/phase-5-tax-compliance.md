# Blueprint: Commish — Phase 5: Tax & Regulatory Compliance Automation

**Objective:** Build the tax-and-compliance automation layer the strategy doc's Section 3 says must be "built in from day one, not an afterthought": W-9/W-8 collection with TIN validation before first deposit, geolocation verification at signup *and* every contest entry, automated 24% backup withholding at payout time, automated year-end 1099-MISC/1099-K generation and e-filing, and a per-state tax-rate/apportionment engine — all gated by a state-enablement flag that keeps every state OFF by default until real gaming counsel signs off on it (Section 9's explicit warning). Code for a state can be written and fully tested in this phase without that state ever being able to accept a real entry.

**Source strategy doc:** `docs/research/2026-08-16-beating-apex-strategy.md` (Section 2 — state legal matrix and Tier 1–4 recommendation; Section 3 — "Tax & Payments, Built In From Day One," especially 3.1, 3.2, 3.4; Section 9 — Risks & Open Questions)

**Revision note (v2):** A full adversarial scaling review and a full adversarial UX-completeness review were run against all 8 phases; this revision incorporates the findings assigned to Phase 5 (see `docs/research/2026-08-16-scaling-review.md` §I3 and `docs/research/2026-08-16-ux-review.md` §C9; full backlog in `plans/00-roadmap.md`). **A scaling review found `generateAnnualTaxForms(taxYear)` (Step 6) was a per-user loop with no checkpointing — at 100k users that's ~200k aggregate queries in one job, and a job that dies partway through has no safe resume path, risking duplicate `TaxFormRecord` rows and duplicate e-filings, a real IRS correction problem. Fix: set-based SQL, cursor-paginated batches, a per-batch checkpoint table, and a unique `(userId, taxYear, formType)` constraint for idempotent resume** — see Step 6. **A UX review found the state-ineligibility case was a typed exception with no designed user experience, the 24% backup-withholding case had zero requirement to explain itself to the user, and nothing in the plan ever let a user see their own 1099 (the compliance dashboard is explicitly internal-only). Fix: an honest state-ineligibility screen with a waitlist and pre-emptive eligibility checks (Step 3), withholding transparency on every payout confirmation (Step 5), and a new user-facing Tax Center (Step 9)** — this last fix adds a new step, so **step count changes from 8 to 9 in this revision**; any other phase file cross-referencing this file's step numbers should be re-checked against the numbering below.

**Depends on:** Phase 4 (real money ledger). This phase computes tax obligations, withholding, and 1099 reporting entirely on top of Phase 4's per-user/per-state transaction ledger and payout flow — it cannot function without that ledger already existing and recording (a) each entry fee and prize, tagged with the player's state at time of entry, and (b) each payout event as a discrete, timestamped transaction. **A fresh agent executing this phase must read the actual Phase 4 code before implementing Steps 5–7** — this document describes the *assumed* ledger/payout interface below as a starting contract, not verified fact, because Phase 4 was not available to inspect while writing this plan.

### Assumed Phase 4 interface (verify before implementing)

```typescript
// Assumed shape — confirm against actual Phase 4 source before Step 5/6/7 implementation
type LedgerEntry = {
  userId: string;
  state: string;        // two-letter code, captured at time of entry, not user's address on file
  type: "entry_fee" | "prize" | "bonus";
  amountCents: number;
  contestId: string;
  occurredAt: Date;
};

type PayoutEvent = {
  userId: string;
  amountCents: number;
  requestedAt: Date;
  // Step 5 hooks into this flow to check TIN validity before funds actually move
};
```

If Phase 4's real interface differs, treat this plan's task lists as needing field/name updates, not a scope change — the compliance logic described below (thresholds, withholding, apportionment) is the actual deliverable.

---

## What's blocked on legal/business sign-off vs. what's pure software

This phase has the same structural blocker as Phase 4: **the state legal matrix in Section 2 is explicitly flagged in Section 9 as unverified** — several figures came from secondary sources because state legislature sites blocked automated access, and multiple regimes changed within the last 12 months. No state can be turned on for real users until actual gaming counsel confirms its entry in that matrix.

This phase is designed so that fact never blocks engineering:

- **Blocked on legal/business (Step 1, and later Phase 8):** verifying each state's license/fee/tax requirement is current and accurate; obtaining the actual gaming-counsel sign-off; deciding launch order among Tier 1 states; registering with any state; IRS e-services enrollment for real TIN Matching; contracting a 1099 e-filing vendor or FIRE-system credentials.
- **Buildable and testable right now (Steps 2–9):** every config table, every calculation engine, every gate, every adapter interface — built and tested end-to-end against states deliberately left in the OFF state, using mock/stub adapters wherever the code would otherwise need a real IRS or vendor credential that doesn't exist yet. The state-enablement flag (Step 2) is the mechanism that lets Phase 8's legal work flip a state on later **without a new code deploy** — flipping a boolean in a config table, not shipping code.

---

## Dependency Graph

```
Step 1 [LEGAL/BUSINESS PREREQUISITE — NOT CODE]
   (blocks real-world state go-live only; blocks nothing below)

Step 2 (state config + enablement gate) ──┬─→ Step 3 (geolocation: signup + per-entry gate)
                                           │
                                           └─→ Step 7 (state liability calculation engine)

Step 4 (W-9/W-8 + TIN validation at signup) ──→ Step 5 (backup-withholding engine
                                                          + versioned threshold config)
                                                          ──→ Step 6 (1099-MISC/1099-K
                                                                      generation + e-filing)

Steps 2,3,4,5,6,7 ──────────────────────────→ Step 8 (compliance integration
                                                        + reconciliation dashboard)

Steps 2,3,4,5,6 ────────────────────────────→ Step 9 (user-facing compliance
                                                        experience — Tax Center)
```

**Parallel opportunities:** Step 2 and Step 4 share no files and can run in parallel once Phase 1's scaffold exists. Step 3 only needs Step 2 (the gate it enforces). Steps 5/6 form a chain off Step 4; Step 7 only needs Step 2 — it can run in parallel with the entire Step 4→5→6 chain. Step 8 needs everything (2–7) finished. Step 9 needs Steps 2, 3, 4, 5, 6 finished — it does not depend on Step 7 or Step 8, and shares no files with Step 8's internal dashboard, so it can run in parallel with both Step 7 and Step 8.

---

## Step 1 — [BUSINESS/LEGAL PREREQUISITE, NOT CODE] Gaming counsel verification of the state legal matrix

**Model tier:** N/A — this is not a coding task. If assigned to an agent, its job is to produce a tracking artifact and a punch list for humans, not to write or modify application code.
**Depends on:** nothing
**Parallel with:** all of Steps 2–9 (this step never blocks engineering work)

### Context brief
Section 9 of the strategy doc states plainly: "Every legal fact in Section 2 needs final verification by actual gaming counsel before any state registration. Several figures were only available via secondary sources because state legislature sites blocked automated access, and multiple regimes changed within the last 12 months (Virginia, Kentucky, Illinois, Oregon, California)." The Tier 1 launch list (Arkansas, DC, Georgia, Minnesota, Nebraska, North Dakota, Oklahoma, South Carolina, West Virginia, Wisconsin, Wyoming, Rhode Island, Maryland, North Carolina) is a strong starting map, not a filed legal position. This step's only job is to get that list — and eventually every state — in front of a real gaming attorney and record the outcome in a form Step 2's config table can consume later. This step produces no application code.

### Tasks
- [ ] Engage actual gaming counsel (a licensed attorney with DFS/gaming regulatory experience) — not an internal researcher — to review the Section 2 matrix state-by-state
- [ ] For each Tier 1 state, obtain written confirmation of: whether a license/registration is truly required, the exact fee (if any), the exact tax rate and base, filing cadence, and any product-design constraints (e.g., Tennessee's ban on auto-draft/pre-selected-team contests, the Tennessee/Mississippi experience-tier segregation rules from Section 2.4)
- [ ] Flag any state where counsel's finding contradicts this plan's assumptions (e.g., North Carolina's unconfirmed "Chapter 78E" claim, Alaska's "contest of chance...even if skill is a factor" language) and record the resolution
- [ ] Produce a signed-off tracking document (outside this codebase — e.g., a shared compliance doc, not a source file) with one row per state: verification status, verified rate/fee/cadence, counsel name, verification date, source citation
- [ ] Hand this document to whoever executes Phase 8 later — it is the direct input to flipping each state's `legalSignoffApproved` flag (Step 2) from false to true in production

### Verification
Not applicable — no code, no test suite. "Verification" here means: does a real attorney's name and a real verification date exist for a given state before that state's flag is ever flipped in production.

### Exit criteria
- A tracking document exists, external to this repository, with counsel sign-off recorded per state (at minimum, all Tier 1 states)
- No exit criteria for this step requires any state to be verified before Steps 2–9 begin — those steps proceed against states left deliberately unverified/OFF

### Rollback
N/A — this step produces no code artifact to roll back. If counsel later reverses a finding for an already-live state, that is an operational incident handled by flipping that state's flag back to `false` (Step 2's gate), not a rollback of this step.

---

## Step 2 — State tax-rate/apportionment config table + state-enablement gate

**Model tier:** strongest (this table and its gate are the single control point standing between "code exists" and "a state can accept real money" — a mistake here is a legal-exposure bug, not a UX bug)
**Depends on:** Phase 1 (domain model, Drizzle ORM/DB conventions), Phase 4 (this config will later be read by Phase 4's contest-entry flow, though this step only needs to define and seed the table)
**Parallel with:** Step 4

### Context brief
This is the mechanism described throughout the strategy doc and required explicitly by this plan: a state can be fully built and tested in code, but stays OFF by default until an explicit legal-sign-off flag is flipped for that state — and flipping that flag must never require a new code deploy. Build this as a single, versioned config table plus a small guard function every other subsystem (contest entry in Phase 4, Step 3's geofencing, Step 7's liability calculation) calls through. Never let any code path check "is this state okay" by any means other than this gate — that duplication is exactly how a state accidentally goes live without sign-off.

### Tasks
- [ ] Write tests first for a `stateComplianceConfig` table/repository with columns: `stateCode` (two-letter, PK), `taxRatePercent` (decimal, e.g. 8.00 for Arkansas), `taxBase` ("net_gaming_revenue" as the only value used per Section 3.2 — every state in the doc's table taxes net revenue, not gross), `filingCadence` ("quarterly" | "monthly"), `licenseFeeCents` (nullable), `legalSignoffApproved` (boolean, **defaults to `false`**), `legalSignoffApprovedBy` (nullable string), `legalSignoffApprovedAt` (nullable timestamp), `sourceCitation` (string — e.g. "Ark. Code Ann. § 23-116-101"), `lastVerifiedAt` (nullable timestamp), `effectiveFrom` (date, for handling rate changes over time — e.g. NJ's July 2025 change from 10.5% to 19.75%)
- [ ] Seed the table with the strategy doc's known rates for the states explicitly given: Arkansas 8% quarterly, Tennessee 6% quarterly, Pennsylvania 15% monthly, New York 15.5% (15% + 0.5% add-on), Massachusetts 15%, Illinois 15%, New Jersey 19.75% quarterly — **every seeded row's `legalSignoffApproved` must be `false`**; seeding data is not the same as legal approval
- [ ] Implement `isStateEnabled(stateCode: string): Promise<boolean>` — returns true **only if** a row exists for that state AND `legalSignoffApproved === true`. No row, no approval, or an expired/superseded row must all resolve to `false` (fail closed)
- [ ] Implement `assertStateEnabled(stateCode: string): Promise<void>` — throws a typed `StateNotEnabledError` if `isStateEnabled` is false; this is the single function every downstream gate (Step 3, and Phase 4's contest-entry path) must call — no parallel/duplicate check anywhere else in the codebase
- [ ] Implement an admin-only mutation `approveStateSignoff(stateCode, approvedBy, sourceCitation)` that flips `legalSignoffApproved` to `true` — this is the exact operation Phase 8's legal work performs later; it must not require touching application code or redeploying
- [ ] Write tests proving: a freshly seeded state is disabled by default; `assertStateEnabled` throws for it; after calling `approveStateSignoff`, the same state passes; a state with no config row at all is also rejected (not just states with an explicit `false`)

### Verification
```bash
npm test -- state-compliance-config
npm run lint
npm run typecheck
```

### Exit criteria
- Every state in the seed data defaults to disabled; zero states are enabled after this step runs, by design
- `assertStateEnabled` is the only function in the codebase that reads `legalSignoffApproved` directly — verified by a grep-based test or lint rule if practical, otherwise documented as a code-review invariant
- Flipping a state's flag is a single data mutation (via `approveStateSignoff`), provably requiring no code change, in a test that calls it against a running instance without touching source files

### Rollback
Config table only, no other subsystem depends on its data yet at this point in the phase — safe to drop and reseed.

---

## Step 3 — Geolocation verification (signup and every contest entry)

**Model tier:** strongest (compliance-critical: the strategy doc is explicit that both legality and tax apportionment depend on location *at time of entry*, not the address on file — a bug here is a state-law violation, not a UX defect)
**Depends on:** Step 2 (the enablement gate this step enforces)
**Parallel with:** Step 4

### Context brief
Section 3.2's product implication is explicit: "the ledger needs a continuous per-state net-revenue calculation... because apportionment and legality both hinge on where the player was when they entered — not where they live on file." Section 5 repeats this as a named architectural requirement: "Geofencing/state-detection at signup AND at every contest entry." Real-money DFS/iGaming operators typically use a dedicated geolocation vendor (e.g., GeoComply) rather than IP lookup alone, because IP geolocation is spoofable and courts/regulators expect stronger evidence for a licensed activity. No such vendor contract exists yet, so build this behind an adapter interface with a mock implementation for now — same pattern Phase 1 used for the AI moderator's LLM call: the system must work correctly (i.e., block appropriately) with no real vendor configured.

**A UX review found the state-blocked case had no designed user experience at all** — a user who wanted to give the platform money and can't got a typed exception, not an honest explanation, and the only eligibility check anywhere in the plan ran at the moment of contest entry, so a user could build an entire roster before discovering their state isn't supported. This step now also owns the designed recovery experience for both failure modes (state-ineligible, low-confidence location), not just the backend gate — see the additional tasks below.

### Tasks
- [ ] Write tests first for a `GeolocationProvider` interface: `verifyLocation(request: { userId: string; latitude?: number; longitude?: number; ipAddress: string }): Promise<{ stateCode: string; confidence: "high" | "low"; verifiedAt: Date }>`
- [ ] Implement a `MockGeolocationProvider` for local dev/test (deterministic, configurable per test — e.g., returns a fixed state or throws a "location unavailable" error on demand) and a stubbed `VendorGeolocationProvider` with a clear `TODO: wire real vendor credentials` — never call a real geolocation API with fabricated credentials
- [ ] Implement `verifyLocationAtSignup(userId, locationRequest)`: stores the verified state on the user's compliance record, required before KYC/W-9 collection can complete (Step 4 depends on a known state to pick W-9 vs. W-8)
- [ ] Implement `verifyLocationAtEntry(userId, contestId, locationRequest)`: called on **every** contest-entry attempt (not cached from signup) — calls Step 2's `assertStateEnabled(stateCode)` after resolving the state, and rejects entry with a clear, typed error if the resolved state doesn't match an enabled state, regardless of what state is on the user's profile
- [ ] Explicitly test the mismatch case: a user whose signup state is enabled but whose live entry-time location resolves to a different (disabled) state must be blocked — this is the exact scenario Section 3.2 calls out
- [ ] Explicitly test the low-confidence case: a "low" confidence resolution should fail closed (block entry) rather than silently proceed, with a path to request a stronger location signal from the client (e.g., prompt for GPS permission if only IP was available)
- [ ] **State-ineligibility UX** — build a `StateIneligibleScreen` component, shown whenever `assertStateEnabled`/`verifyLocationAtEntry` rejects a user, that explains in plain language which state was detected and why it isn't yet supported, lists what still works today (free/mock leagues, browsing, following friends' leagues — from Phase 1), and offers one clear next action: join the waitlist. Never surface the raw `StateNotEnabledError` message or any other typed-exception text directly to a user
- [ ] Add a `stateWaitlistEntry` table (`email`, `stateCode`, `requestedAt`) and a `joinStateWaitlist(email, stateCode)` function that writes a real row — not a `mailto:` link or a client-only form — wired to the `StateIneligibleScreen`'s waitlist action; write a test proving a submission persists and that a duplicate submission for the same email+state does not create a second row
- [ ] Build a public "where we're live" page/component, driven directly by a live read of Step 2's `stateComplianceConfig.legalSignoffApproved` (the same source `isStateEnabled` reads, not a hand-maintained copy) — because it queries the source of truth, it can never go stale the way a hand-authored marketing page would; link to it from `StateIneligibleScreen`. Write a test that flips a state's flag via `approveStateSignoff` and asserts the page's rendered output changes with no separate content to update
- [ ] **Pre-emptive eligibility checks** — expose `checkEligibilityPreemptive(stateCode): Promise<boolean>`, a thin, side-effect-free wrapper over Step 2's `isStateEnabled` (same fail-closed semantics), and call it at two points *before* contest entry so a user never builds a roster they then can't enter: immediately after `verifyLocationAtSignup` resolves a state (before the user proceeds past signup), and on the league-browse page before a user can start building a roster in a real-money league. Show `StateIneligibleScreen` at either point rather than only at the moment of entry. (These call sites live in the signup and league-browse surfaces built in earlier phases; this step owns the check function and the screen — the same ownership pattern as Step 2's `assertStateEnabled` being the one function every downstream gate must call, not reimplement.)
- [ ] **Low-confidence recovery path** — extend the low-confidence case above into a designed flow, not a dead-end rejection: on `confidence: "low"`, show a `LocationConfidenceRetry` prompt in place (no navigation away, no lost form/roster state) offering to request a stronger location signal (e.g. browser GPS permission) and retry the same check immediately in place. Write a test that a low-confidence result followed by a high-confidence retry succeeds without the user having to restart the signup or entry flow they were in

### Verification
```bash
npm test -- geolocation
npm run lint
npm run typecheck
```

### Exit criteria
- No contest entry can succeed without a fresh, per-entry location check — a cached/stale state resolution is provably insufficient in tests
- A user physically located in a disabled state is blocked at entry even if their account/profile state is an enabled one
- The mock provider requires no external credentials and the real vendor adapter is inert (never called) until configured — matches the "degrade gracefully, never fail silently" pattern from Phase 1
- A user blocked by state ineligibility sees the designed `StateIneligibleScreen` (state, plain-language reason, what still works, waitlist action) — never the raw typed error — verified by a test
- Joining the waitlist persists a real, deduplicated row, verified by a test that reads it back
- The "where we're live" page's content is provably derived from Step 2's live config, not a maintained copy, verified by the flag-flip test above
- `checkEligibilityPreemptive` blocks at both the signup call site and the league-browse call site, verified by a test for each — not only at entry
- The low-confidence retry flow succeeds in place after a stronger signal is supplied, verified by a test, without requiring the user to restart the flow

### Rollback
Additive gate in front of Phase 4's contest-entry flow — can be feature-flagged off independently, though doing so would remove the compliance control itself and should never be done in an environment with real states enabled.

---

## Step 4 — W-9/W-8 collection and TIN validation at signup

**Model tier:** default
**Depends on:** Phase 1 (user/account model)
**Parallel with:** Step 2

### Context brief
Section 3.4's first bullet is unambiguous: "W-9 collection at signup, not deferred to first payout, with TIN validation against IRS TIN-matching at collection time." This phase must collect the form *before first deposit*, not defer it to first payout the way a less careful implementation would. The IRS TIN Matching program (e-services) is an interactive/bulk batch system requiring IRS e-services registration that doesn't exist yet for this business — so, same pattern as Step 3, build this behind an adapter interface with a mock validator now, and a stub for the real IRS (or a vendor like Track1099/Tax1099/Sovos, which wrap TIN Matching commercially) later.

### Tasks
- [ ] Write tests first for a `TaxFormSubmission` model: form type (`W-9` for US persons, `W-8BEN` for non-US individuals), the TIN/SSN/EIN (must be encrypted at rest — never store plaintext SSN/EIN in the database or in logs), name-as-shown-on-form, submission timestamp, and a `tinMatchStatus` (`pending" | "matched" | "mismatch" | "not_checked`)
- [ ] Enforce at the signup flow level: a user cannot reach the deposit step without a completed, submitted tax form on file — write a test proving the deposit endpoint rejects a user with no `TaxFormSubmission` row, independent of any UI enforcement
- [ ] Implement a `TinValidationProvider` interface: `validateTin(name: string, tin: string, formType: "W-9" | "W-8BEN"): Promise<"matched" | "mismatch" | "unavailable">`, with a `MockTinValidationProvider` for tests/dev and a stubbed real-IRS/vendor adapter (`TODO: wire IRS e-services or vendor credentials once business registration is complete`)
- [ ] On mismatch or `unavailable`, the submission is stored with `tinMatchStatus: "mismatch"` (or `"not_checked"`) rather than rejected outright at signup — this status is what Step 5's withholding engine reads at payout time; a mismatched TIN blocks *withholding-free* payout, not account creation, matching how backup withholding actually works
- [ ] Validate TIN format server-side before calling the matching provider at all (9 digits, no all-zeros/all-same-digit patterns) — fail fast with a clear error, per the user's global input-validation standard, rather than sending obviously-invalid data to an external service
- [ ] Encrypt TIN/SSN/EIN values at the field level (not just relying on disk encryption) and ensure no logging path ever writes the raw value — add a lint/test guard if the codebase has a logging utility that could serialize the object
- [ ] Build one canonical corrected-TIN submission flow (reusing this step's `TaxFormSubmission` intake to accept a resubmitted W-9/W-8 and re-run `validateTin`) — this is the single "fix it" destination linked from both Step 5's payout-confirmation withholding line and Step 9's Tax Center TIN-status section; do not let either later step build its own parallel form

### Verification
```bash
npm test -- tax-form-submission
npm test -- tin-validation
npm run lint
npm run typecheck
```

### Exit criteria
- A user with no submitted tax form cannot pass the deposit gate, proven by a test, not just a UI check
- TIN values never appear in plaintext in test snapshots, logs, or the raw database column (encrypted-at-rest is asserted, not assumed)
- The mock TIN validator lets every downstream step (5, 6) be fully tested without any real IRS credential existing

### Rollback
Gate in front of the deposit flow — can be disabled via feature flag in non-production environments only; disabling in production would violate the "before first deposit" requirement and must never be done outside a controlled rollback of this step itself.

---

## Step 5 — Automated backup-withholding engine + versioned reportable-payment threshold config

**Model tier:** strongest (real-money correctness: this step decides whether 24% of a real payout gets withheld — errors here are financial and regulatory, not cosmetic)
**Depends on:** Step 4 (TIN match status), Phase 4 (the payout flow this hooks into)
**Parallel with:** Step 7

### Context brief
Section 3.4: "An automated backup-withholding engine — checks TIN validity... at the moment of every payout; withholds 24% automatically into a segregated ledger if TIN is invalid, rather than correcting after the fact." Section 3.1 gives the exact rate (24%, not the outdated 28%) and Section 9/3.1 together establish the reportable-payment threshold has already changed three times in recent years: $600 for tax year 2025, $2,000 for tax year 2026 onward, inflation-indexed starting 2027. **Hardcoding this number would be wrong on its face** — it is not a stable constant, it is a value Congress has already changed multiple times within recent memory, and an inflation index means it will keep moving every year from 2027 on without any further legislative action. It must live in a versioned config table keyed by tax year, exactly like Step 2's state rates.

**A UX review found this engine had zero requirement to explain itself** — a user who requests a payout and receives 76% of what they expected, with no on-screen explanation, reads that as a bug or theft, not a legal requirement. Fix: this step now also owns the payout-confirmation summary the user sees before a withheld payout completes (see the added task below), not just the backend calculation.

### Tasks
- [ ] Write tests first for a `reportablePaymentThreshold` config table: `taxYear` (int, PK), `thresholdCents` (int), `source` (string, e.g. "One Big Beautiful Bill Act"), `effectiveDate` (date) — seed rows for TY2025 ($60,000 cents = $600) and TY2026 ($200,000 cents = $2,000), and write the lookup function `getThresholdForTaxYear(taxYear: number): Promise<number>` to throw a clear, typed error for any year with no seeded row (fail loud, not a silent default) — this is exactly the safeguard that prevents 2027's inflation-indexed value from silently reusing 2026's number
- [ ] Write tests first for the withholding engine: `evaluateWithholding(payout: PayoutEvent, tinMatchStatus): { withholdCents: number; netPayoutCents: number }` — computes `withholdCents = Math.round(payout.amountCents * 0.24)` when `tinMatchStatus !== "matched"`, else `0`
- [ ] Store the 24% rate itself as config (not a magic number in the calculation), even though the strategy doc doesn't flag it as historically volatile the way the threshold is — consistent with the user's "config over hardcoding" standard and cheap insurance against a future statutory change
- [ ] Hook this into Phase 4's payout flow: before any payout event's funds actually move, call `evaluateWithholding`; if `withholdCents > 0`, write a `withholdingLedgerEntry` (segregated from the general FBO-account ledger per Section 3.4's "segregated ledger entry" requirement) and reduce the amount actually disbursed to the user by that amount
- [ ] Write an explicit test for the core failure mode this step exists to prevent: a payout to a user with `tinMatchStatus: "mismatch"` must have exactly 24% withheld and moved to the segregated ledger, with the user receiving exactly 76% — no code path may disburse the full amount when TIN status is not `"matched"`
- [ ] Write a test proving a `"matched"` TIN status results in zero withholding and full payout
- [ ] Write a test proving the engine consults `getThresholdForTaxYear` for the reportable-payment threshold when deciding whether a *cumulative annual* payout total crosses into 1099 territory (this is a separate concern from the per-payout 24% withholding trigger — withholding triggers on invalid TIN regardless of amount; the threshold determines whether a 1099 is later required, which Step 6 reads)
- [ ] **Withholding transparency on payout confirmation** — before any withheld payout is confirmed, build a `PayoutConfirmationSummary` (gross amount, the withholding line item, net amount, a one-sentence plain-language reason — e.g. "We withheld 24% because the tax ID on file doesn't match IRS records" — and a direct link to the TIN-correction flow that caused it) and require the payout UI to render all four elements whenever `withholdCents > 0`; write a test asserting a withheld payout's confirmation payload always includes all four fields, and that a non-withheld payout's summary correctly omits the withholding line rather than showing a zero one
- [ ] The TIN-correction link in the summary must route to the same fix-TIN flow Step 4's `TaxFormSubmission` resubmission uses — do not build a second, parallel "update your TIN" form

### Verification
```bash
npm test -- backup-withholding
npm test -- reportable-payment-threshold
npm run lint
npm run typecheck
```

### Exit criteria
- No hardcoded `600`, `2000`, or `0.24` literal exists anywhere in the withholding calculation code — all three values are read from config tables, verified by code review against this exact requirement
- A payout to an unmatched-TIN user is provably reduced by exactly 24%, with the withheld amount provably recorded in a segregated ledger entry distinct from the general payout ledger
- Requesting the threshold for an unseeded tax year throws rather than silently returning a stale value
- Every withheld payout's confirmation screen shows gross amount, the withholding line, net amount, a plain-language reason, and a working link to the canonical TIN-correction flow — verified by a test, not just a UI mockup
- A non-withheld payout's confirmation never shows a withholding line at all (not a $0 one), verified by a test

### Rollback
This hooks into Phase 4's payout flow — reverting must restore Phase 4's original payout path exactly (no withholding), not leave a partially-wired hook; treat this as a single atomic change to the payout flow, not several independent patches.

---

## Step 6 — Automated year-end 1099-MISC/1099-K generation and e-filing

**Model tier:** strongest (a scaling review found the original per-user-loop design risks duplicate `TaxFormRecord` rows and duplicate e-filings on a re-run — a real IRS correction problem, not a cosmetic bug, so this step's batch-execution design gets the same tier as Step 2's state gate and Step 5's withholding calculation)
**Depends on:** Step 5 (threshold config), Phase 4 (per-user/per-state ledger)
**Parallel with:** Step 7

### Context brief
Section 3.1: annual net profit per user (cumulative prizes minus entry fees plus bonuses, not per-contest) is the reporting basis for 1099-MISC Box 3, using the threshold from Step 5's config for the relevant tax year. Section 3.4 additionally requires 1099-K generation for third-party payment-network volume ($20,000 and 200+ transactions — a separate, federally-set threshold from the 1099-MISC one and **not** the same versioned table as Step 5, since it hasn't moved the way the MISC threshold has, though it should still be config rather than a literal for consistency). E-filing requires either direct IRS FIRE-system integration or a commercial vendor (Track1099, Tax1099, Sovos) — no such credential/contract exists yet, so build this behind an adapter, same pattern as Steps 3 and 4.

**A scaling review found the batch job as originally scoped (`generateAnnualTaxForms(taxYear)` looping per-user, calling `computeAnnualNetProfit`/`computeAnnualPaymentNetworkVolume` once per user) does ~200k aggregate queries in a single job run at 100k users, with no batching and no checkpointing — a job that dies partway through (e.g. at user 60,000) has no safe resume path, and re-running it from scratch risks inserting duplicate `TaxFormRecord` rows and triggering duplicate e-filings through `TaxFormFilingProvider`, which is an actual IRS correction problem, not just wasted compute.** Fix: the batch job itself must be set-based SQL, cursor-paginated, checkpointed, and idempotent by construction — see the tasks below. The per-user `computeAnnualNetProfit`/`computeAnnualPaymentNetworkVolume` functions are still built and tested here (Step 9's Tax Center reuses them for a single user's real-time view), but the annual batch job must not call either of them in a per-user loop.

### Tasks
- [ ] Write tests first for `computeAnnualNetProfit(userId, taxYear): Promise<number>` — sums Phase 4 ledger entries of type `"prize"` and `"bonus"` minus `"entry_fee"` for the given user across the full tax year, across all states (this is a per-user total, distinct from Step 7's per-state totals). This function is for single-user, on-demand reads (Step 9's Tax Center) — not for the batch job below
- [ ] Write tests first for `computeAnnualPaymentNetworkVolume(userId, taxYear): Promise<{ amountCents: number; transactionCount: number }>` for the 1099-K threshold check — same single-user scope and caveat as above
- [ ] Add a `reportableThresholdMiscConfig` reference to Step 5's table (reuse it — do not create a second table for the same value) and a separate small config entry for the 1099-K threshold ($20,000 / 200 transactions) so it too is not a literal in code
- [ ] **Set-based batch computation** — implement the annual net-profit and payment-network-volume computation for the *whole* batch job as set-based SQL: a single `GROUP BY userId` pass (or a small, fixed number of such passes) over the taxYear-indexed ledger table, producing every user's totals in one query rather than one query pair per user. This replaces the per-user loop entirely for the batch path
- [ ] **Cursor-paginated batches** — process the set-based result in userId-ordered pages of a fixed size (e.g. 5,000 users per batch), not as one unbounded pass, so the job's progress is observable and each batch commits independently
- [ ] Add a `taxFormBatchCheckpoint` table (`taxYear`, `lastProcessedUserId`, `status`, `updatedAt`), written after each batch commits — a killed job resumes from the last committed checkpoint on restart, rather than restarting from the first user
- [ ] Add a **unique constraint on `(userId, taxYear, formType)`** on `TaxFormRecord` so the batch job is idempotent by construction: re-running a batch — whether resuming from a checkpoint or a full manual re-run — upserts/no-ops against an existing row instead of inserting a duplicate. This is the mechanism that actually prevents a duplicate e-filing, not just a best-effort convention
- [ ] Implement the year-end batch job `generateAnnualTaxForms(taxYear)` using the set-based/paginated/checkpointed design above: for each batch, generate a `TaxFormRecord` (1099-MISC Box 3 and/or 1099-K as applicable) for anyone crossing either threshold, honoring the unique constraint on write
- [ ] Implement a `TaxFormFilingProvider` interface (`fileForm(record: TaxFormRecord): Promise<{ filingId: string; status: "accepted" | "rejected" }>`), with a `MockTaxFormFilingProvider` for tests and a stubbed real adapter (`TODO: wire IRS FIRE system or vendor credentials`); only call `fileForm` for a `TaxFormRecord` that was newly inserted this run, never for one that already existed (the unique constraint plus this check together prevent a duplicate filing call on resume or re-run)
- [ ] Write a test proving a user just under the threshold generates no form, and a user just at/over it does — boundary-condition tests are mandatory here given how often this exact number has moved historically
- [ ] Write a test proving the batch job reads the threshold for the *correct* tax year being processed, not the current calendar year (a job run in January 2027 processing TY2026 data must use the TY2026 threshold, not TY2027's inflation-indexed one)
- [ ] Write a test that kills the job mid-run (simulated, e.g. abort after N batches) and asserts resuming from the checkpoint produces the exact same final `TaxFormRecord` set as an uninterrupted run — no missing users, no duplicates
- [ ] Write a test that runs the full batch job twice, back to back, against identical ledger data and asserts zero duplicate `TaxFormRecord` rows and zero duplicate `fileForm` calls for records that were already filed by the first run
- [ ] Seed a 100k-user, 3-tax-year fixture (reuse or extend Phase 1's deterministic-seed pattern) and run the batch job against it as a scale proof, not just correctness tests

### Verification
```bash
npm test -- annual-tax-forms
npm run lint
npm run typecheck
```

### Exit criteria
- Every generated form is traceable to the exact ledger entries and threshold-config row that produced it (an audit trail, not just a final number)
- The batch job runs to completion against the seeded 100k-user, 3-tax-year fixture in under 30 minutes — recorded as this step's scale proof, not asserted informally
- A killed-and-resumed run of the batch job produces an identical `TaxFormRecord` set to an uninterrupted run, verified by the checkpoint-resume test
- Re-running the batch job against unchanged ledger data produces zero duplicate `TaxFormRecord` rows and zero duplicate `fileForm` calls, verified by the idempotency test — this is the exit criterion that directly answers the duplicate-e-filing risk this step exists to close
- Boundary tests pass for both the 1099-MISC threshold (from Step 5's table) and the 1099-K threshold
- The filing adapter is inert (mock only) until a real vendor/IRS credential is configured — running this job today must not attempt any real network call to the IRS or a vendor

### Rollback
Batch job with no write path into Phase 4's ledger (read-only against it) — safe to disable or re-run; generated `TaxFormRecord` rows can be regenerated deterministically from ledger + config state.

---

## Step 7 — State tax liability calculation engine (quarterly/monthly)

**Model tier:** default (calculation logic is config-driven and mechanically similar to Step 6's; the hard correctness problem — knowing which states are real — was already solved in Step 2)
**Depends on:** Step 2 (state config table), Phase 4 (per-state ledger)
**Parallel with:** Step 4, Step 5, Step 6

### Context brief
Section 3.2: every state with a dedicated fantasy-tax regime taxes **net revenue** — entry fees minus prizes paid, apportioned by the state the player was in at time of entry — not gross entry fees or gross prizes. Filing cadence varies by state: most in Step 2's seed data are quarterly, but Pennsylvania is explicitly monthly ("Highest-friction filing cadence in the group" per the doc's table). This step computes the liability; it does not itself submit filings — actual state tax filing/payment is a compliance-operations action outside this codebase's scope (analogous to Step 1: the computation is code, the act of filing is a business/finance operation this system should make easy and accurate, not automate away entirely without human review, given the legal exposure involved).

### Tasks
- [ ] Write tests first for `computeStateNetRevenue(stateCode, periodStart, periodEnd): Promise<number>` — sums in-state (by entry-time state, per Step 3's captured value on each ledger entry) `entry_fee` amounts minus in-state `prize` amounts for the period
- [ ] Write tests first for `computeStateLiability(stateCode, periodStart, periodEnd): Promise<{ netRevenueCents: number; taxRatePercent: number; liabilityCents: number }>` — reads the rate from Step 2's config (as of the period, honoring `effectiveFrom` for states whose rate changed, e.g. New Jersey's mid-2025 change) and computes `liabilityCents = round(netRevenueCents * taxRatePercent / 100)`
- [ ] Implement a period-generation helper that reads each enabled state's `filingCadence` from Step 2's config and produces the correct period boundaries — quarterly states get calendar-quarter periods, monthly states (Pennsylvania) get calendar-month periods; this must be config-driven per state, not a single global cadence assumption
- [ ] Implement a scheduled/batch `computeAllStateLiabilities(asOfDate)` that iterates only states where `isStateEnabled` (Step 2) is true — **this is a real enforcement point**: liability calculation for a disabled state should not run in production at all, since a disabled state should have zero real transactions to compute against; write a test proving a disabled state is skipped even if stray ledger data existed for it
- [ ] Produce a `StateLiabilityRecord` (state, period, net revenue, rate used, liability amount, computed-at timestamp) as the auditable output — this is what a human compliance operator reviews before actually filing/paying a state
- [ ] Write a test for New Jersey's rate-change scenario specifically: a period spanning both sides of an `effectiveFrom` boundary should be handled explicitly (either split the calculation at the boundary or reject/flag a period that spans two different rates) — do not let a naive implementation silently apply only one rate to a mixed period

### Verification
```bash
npm test -- state-liability
npm run lint
npm run typecheck
```

### Exit criteria
- Pennsylvania's monthly cadence and the other seeded states' quarterly cadence both produce correctly-bounded periods from the same code path, driven entirely by config
- A period straddling a rate change is provably handled correctly, not silently wrong
- Liability computation never runs against a disabled state in the scheduled batch path

### Rollback
Read-only against Phase 4's ledger and Step 2's config — safe to disable independently; no other step depends on this one's output within this phase (Step 8 reads it for the dashboard, but that read is additive).

---

## Step 8 — Compliance integration verification and reconciliation dashboard

**Model tier:** default
**Depends on:** Steps 2, 3, 4, 5, 6, 7
**Parallel with:** Step 9 (shares no files — Step 9 is the user-facing Tax Center, this is the internal-only dashboard; this is the last step that needs *everything* (2–7) finished)

### Context brief
Every prior step in this phase was built and unit-tested in isolation, mostly against mock adapters and deliberately-disabled states. This step is the cross-cutting proof that the pieces actually compose correctly — in particular, that the state-enablement gate from Step 2 genuinely blocks a contest entry end-to-end (through Step 3's real-time check) no matter what else is true about the request, and that a compliance operator has one place to see the state of the whole system: which states are enabled and by whom, TIN-match status distribution, withholding totals in the segregated ledger, outstanding per-state liabilities, and 1099 generation status. This is the internal-tooling surface, not a user-facing feature — the user-facing counterpart is Step 9.

### Tasks
- [ ] Write an end-to-end integration test: seed a state with `legalSignoffApproved: false`, attempt a full contest-entry flow through Step 3's geolocation gate, and assert it is rejected with the specific `StateNotEnabledError` from Step 2 — then call `approveStateSignoff` for that state and assert the identical flow now succeeds, proving the flag is the *only* thing that changed
- [ ] Write an end-to-end integration test covering the full money path: a user with a mismatched TIN (Step 4) receives a payout (Phase 4) that is correctly reduced by 24% (Step 5), and that same user's annual totals correctly surface in the year-end 1099 batch (Step 6) once they cross threshold
- [ ] Build a compliance-operator dashboard view (internal-only route, not part of the public app) showing: a table of all states with their enablement status, sign-off approver/date, and source citation (Step 2); TIN-match status counts across all users (Step 4); total withheld-and-segregated funds to date (Step 5); outstanding computed liability per enabled state for the current filing period (Step 7); count of generated/filed 1099 forms for the current tax year (Step 6)
- [ ] Add a reconciliation check: total withheld funds recorded in the segregated ledger (Step 5) must equal the sum of individual withholding events computed from the payout history — a drift here (mirroring Section 3.4's daily FBO reconciliation requirement, though that specific reconciliation is Phase 4's/a payments-phase concern, not this one's) should raise a visible alert on the dashboard, not fail silently
- [ ] Restrict the dashboard route to an authenticated internal/admin role — write a test proving an unauthenticated or non-admin request is rejected

### Verification
```bash
npm test -- compliance-integration
npm test -- compliance-dashboard
npm run lint
npm run typecheck
npm run build
npm run dev   # manual: log in as admin, verify dashboard renders state list, flip a test state's flag, confirm entry unblocks
```

### Exit criteria
- The end-to-end "flag flip with no code change" test passes, proving the core mechanism this phase exists to build actually works
- The dashboard correctly reflects zero enabled states out of the box (matching this phase's default-OFF design) when run against fresh seed data
- All money-path and 1099-path integration tests pass using only mock adapters — nothing in this phase's test suite requires a real IRS or vendor credential to pass

### Rollback
Dashboard and integration tests are additive; if any integration test reveals a genuine defect in an earlier step (2–7), fix forward in that step's module rather than reverting Step 8, since Step 8 itself introduces no new business logic — only composition and visibility.

---

## Step 9 — User-facing compliance experience (Tax Center)

**Model tier:** default (this step is a read/UI composition over Steps 2–6's already-validated data and calculations; it introduces no new financial or legal computation of its own)
**Depends on:** Step 2 (state config, for the "where we're live" reference), Step 3 (eligibility/entry state), Step 4 (TIN/W-9 status and the canonical TIN-correction flow), Step 5 (reportable-payment threshold), Step 6 (generated `TaxFormRecord`s to display and download)
**Parallel with:** Step 7, Step 8 (shares no files with either; needs only Steps 2–6, not 7 or 8)

### Context brief
A UX review found that nothing in this phase — across every step that computes, withholds, or files tax obligations on a user's behalf — ever lets that user actually see the result. The compliance-operator dashboard (Step 8) is explicitly internal-only. A real-money product that withholds a user's funds and files a 1099 in their name owes that user a place to see their own status, not just an eventual mailed form. This step builds that place: a **Tax Center**, reusing Steps 2–6's already-built functions and data rather than recomputing anything. Read `docs/conventions.md` and `docs/design-system.md` from Phase 1 first, since this is a user-visible surface and inherits the standing rule from Phase 1 Step 1: loading/empty/error/success states designed, an a11y pass, and a plain-language copy review are all required before this step is complete.

### Tasks
- [ ] Write tests first for `getTaxCenterSummary(userId, taxYear): Promise<TaxCenterSummary>` — a read-model composing: current-year running net-profit-to-date via Step 6's `computeAnnualNetProfit(userId, taxYear)` (the single-user function, called live for this one user — never the batch job) against the applicable threshold via Step 5's `getThresholdForTaxYear(taxYear)`; TIN/W-9 status from Step 4's `TaxFormSubmission.tinMatchStatus`; and the list of any `TaxFormRecord`s Step 6 has generated for the user this tax year
- [ ] Build the Tax Center UI (an authenticated, user-facing account page — not the internal dashboard from Step 8): a running net-profit-to-date meter against the applicable threshold, rendered in plain language (e.g. "$X toward the $2,000 reporting threshold this year"), not raw numbers with no context
- [ ] Build the TIN/W-9 status section: current status (`matched`/`mismatch`/`pending`/`not_checked`) in plain language, with a "fix it" action routing to the single canonical TIN-correction flow built in Step 4 — the same destination Step 5's payout-confirmation withholding line links to; do not build a second form here
- [ ] Build downloadable 1099-MISC/1099-K PDFs: given a `TaxFormRecord` generated by Step 6, render/serve it as a PDF the owning user can download; write a test that a form generated by Step 6's batch job is retrievable and downloadable by the user it belongs to
- [ ] Enforce access control: a user can only ever read or download their own Tax Center data — write a test proving a request for another user's summary or PDF is rejected server-side, not merely hidden in the UI
- [ ] Add an in-app notification and a push notification (reusing whichever notification mechanism the platform already has, per `docs/conventions.md`) fired when a new `TaxFormRecord` is issued for a user, linking directly into their Tax Center
- [ ] Design and build the zero-forms-yet empty state (the common case for most users most of the year): explains what the Tax Center will show once/if the user crosses the threshold, rather than a blank page or a dead end — following the empty-state pattern established in Phase 1

### Verification
```bash
npm test -- tax-center
npm run lint
npm run typecheck
```

### Exit criteria
- A user with `TaxFormRecord`s generated by Step 6 can view and download each one from their Tax Center, verified end-to-end by a test
- A user with no forms yet sees the designed empty state explaining the threshold, not a blank page or error
- The TIN "fix it" action in the Tax Center and the TIN-correction link on Step 5's payout-confirmation screen route to the identical flow — verified by a reference/implementation check, not two separate forms
- The access-control test passes: no user can read or download another user's Tax Center data or forms
- The Tax Center renders correctly in both light and dark theme and passes the automated a11y check, per Phase 1's standing rule for user-visible surfaces

### Rollback
Read/UI-only surface composing Steps 2–6's already-existing data and functions — safe to disable independently without affecting withholding, filing, or liability computation, since it writes nothing back into any of them.

---

## Post-Phase: Feeds Phase 8 (business/legal launch phase)

This phase deliberately stops short of ever flipping a state's `legalSignoffApproved` flag to `true` in a real environment. That action belongs to a later business/legal phase (Phase 8, per the strategy doc's Section 8 go-to-market recommendation: Tier 1 states first) once Step 1's counsel verification is actually complete for a given state. Everything built here — the config tables, the gates, the calculation engines, the internal dashboard, and the user-facing Tax Center — is what makes that later phase a data operation instead of a code deploy.
