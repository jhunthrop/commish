# Blueprint: Commish — Phase 3: Trust & Integrity at Scale

**Objective:** Productionize the systemic integrity tooling the strategy doc identifies as a core differentiator against Apex — an immutable audit log, multi-account detection, dual-use trade-fairness flagging, an admin dispute-resolution dashboard, automated rule enforcement for public leagues, and experience-tier segregation. This is what makes public/stranger-matched leagues (strategy doc §4.1) actually safe to run at scale, and it directly answers the Apex complaint teardown in §1.1: unchecked collusion, no multi-accounting detection, commissioners who never deny trades.

**Source strategy doc:** `docs/research/2026-08-16-beating-apex-strategy.md` (Sections 1.1, 2.4, 4, 4.1, 4.2 — read these before starting any step in this phase)

**Depends on:**
- **Phase 1** (`plans/fantasy-mvp-prototype.md`) — needs the draft/trade/league features this phase adds integrity checks on top of, and specifically Step 8's existing AI trade analyzer (this phase reuses it, does not reimplement it) and Step 9's public-league matchmaking UI (this phase extends it).
- **Phase 2** — needs real authenticated accounts with stable identities and sessions. Multi-account detection is meaningless against anonymous or stubbed sessions; the audit log's "actor" field needs a real account ID, not a mock/test-fixture user.

**Mode:** Same as Phase 1 — direct execution against the existing repo, TDD per user's global testing rules, no git branch/PR workflow assumed unless the repo state at execution time says otherwise.

> **Step-number reconciliation:** this file was drafted against an earlier draft of Phase 1 that had 9 steps (Step 5 = AI draft moderator, Step 6 = league management, Step 7 = chat, Step 8 = AI trade analyzer, Step 9 = public matchmaking). After an adversarial review, Phase 1 was rewritten and those steps shifted: the AI draft moderator is now **Step 6**, league management is **Step 7**, chat is **Step 8**, the AI trade analyzer is now **Step 9**, and public matchmaking is now **Step 10**. Every "Phase 1 Step 8" reference in this file (the trade analyzer) means **Phase 1 Step 9**; every "Phase 1 Step 9" reference (matchmaking) means **Phase 1 Step 10**. See `plans/00-roadmap.md` for the full mapping before executing any step below.

---

## New config surface introduced in this phase

Per the user's "config over hardcoding" rule, every threshold in this phase lives in one file, **`src/config/integrity.ts`**, as named, documented constants — never inlined as magic numbers in the modules that consume them:

- `MULTI_ACCOUNT_FLAG_THRESHOLD` + per-signal weights (Step 2)
- `TRADE_FAIRNESS_FLAG_THRESHOLD` (Step 3)
- `TRADE_AUTO_HOLD_THRESHOLD` (Step 5 — must be strictly more extreme than the flag threshold above)
- `EXPERIENCE_TIER_CONTEST_COUNT_CUTOFF` (Step 6)
- `MISSED_DEADLINE_LINEUP_STRATEGY` (Step 5)
- `AUDIT_FULL_VERIFY_INTERVAL_HOURS` (Step 1 — cadence of the full from-genesis chain-integrity walk, run as a separate scheduled job precisely so the routine per-run check can stay incremental; a scaling review finding, see Step 1)

Each step below that introduces a constant must add it here, with a code comment explaining what it means in plain language — these are the numbers most likely to need tuning post-launch without a redeploy of business logic.

## Explicitly out of scope for this phase

Consistent with Phase 1's scoping discipline — these require real business/legal/infra decisions and stay deferred:

- Real account suspension/banning workflows tied to actual money holds (no real money exists yet — see Phase 1's out-of-scope list). This phase's multi-account detection only ever produces a review flag, never an account action.
- A full RBAC/permissions system — the admin dashboard (Step 4) uses one minimal `isAdmin` boolean role, not a general permissions framework.
- Licensed device-fingerprinting vendors (e.g., FingerprintJS Pro) — Step 2 uses coarse, self-reported client signals appropriate to a prototype, not a paid fraud-detection SaaS integration.
- Tax reporting itself — out of scope for this phase, but Step 1's audit log is explicitly built as the infrastructure a future tax-reporting phase will read from (strategy doc §3.4's per-user ledger needs exactly this kind of event trail).

---

## Dependency Graph

```
Phase 1 (Step 1 domain model, Step 3 draft engine, Step 6 league mgmt, Step 8 AI trade analyzer, Step 9 matchmaking)
Phase 2 (real authenticated accounts/sessions)
        │
        ▼
Step 1 (immutable audit log)
   │
   ├─→ Step 2 (multi-account detection heuristics) ────────────┐
   │                                                             │
   ├─→ Step 3 (trade-fairness flagging ← reuses Phase 1 Step 8) ┼─→ Step 4 (admin dispute-resolution dashboard)
   │                                                             │           │
   ├─→ Step 6 (experience-tier segregation ← Phase 1 Step 9)     │           │
   │        (parallel with Step 5)                               │           ▼
   └──────────────────────────────────────────────────────────────────→ Step 5 (automated rule enforcement,
                                                                            public leagues only ← Phase 1 Step 9)
```

**Parallel opportunity:** once Step 1 lands, Steps 2, 3, and 6 can all run in parallel — they don't share files and each depends only on Step 1 plus a different piece of Phase 1. Step 4 needs both Step 2 and Step 3's flag types to exist (it queues both). Step 5 needs Step 4 (it escalates ambiguous cases to the same dashboard) and Step 3 (it reuses the fairness score for its stricter auto-hold threshold), but does not need Step 6 — Steps 5 and 6 can run in parallel with each other.

---

## Step 1 — Immutable audit log

**Model tier:** strongest (foundational, tamper-evidence design mistakes propagate to every other step in this phase and to future phases like tax reporting)
**Depends on:** Phase 1 Step 1 (domain model), Phase 2 (real authenticated actor IDs)
**Parallel with:** nothing (everything else in this phase reads from this)

### Context brief
Strategy doc §1.1 lists "commissioners who never deny trades" and "no multi-accounting detection" as Apex's most-repeated complaints; §4 names "a transparent per-league audit log" as core systemic integrity tooling. This step builds that log as foundational infrastructure: every roster move, trade, draft pick, and lineup change gets a timestamped, tamper-evident event log entry. Steps 2–6 in this phase all read from or write to it, and a future tax-reporting phase will read from it too (strategy doc §3.4 needs a per-user event trail for net-profit ledgering). Get the tamper-evidence design right here — a hash chain where each entry's hash includes the previous entry's hash, so any retroactive edit breaks the chain and is detectable by a verification pass. Enforce append-only both at the application layer (no update/delete methods exposed) and at the database layer (triggers that reject UPDATE/DELETE even from a raw SQL client) as defense in depth.

A scaling review of this design (`docs/research/2026-08-16-scaling-review.md`, finding C5) found two problems that only show up at real volume: `audit_events` is the fastest-growing table in the whole system and was left unindexed against exactly the patterns it's read by (leagueId, actorId, eventType, time range), and `verifyChainIntegrity` as originally specified recomputes every hash in the chain on every run — which becomes unrunnable at scale, meaning the tamper-detection feature would silently become decorative because nobody could afford to actually run it. Both are fixed in the tasks below: explicit indexes, and a checkpointed incremental verification with a separate, less-frequent full-walk job. A UX review (`docs/research/2026-08-16-ux-review.md`, MINOR) separately found that this admin-only-visible log leaves users with no explanation when a system-triggered action affects them (Steps 4, 5, 6 build the visible/notified side of that fix; this step adds the one shared notification primitive they all call).

### Tasks
- [ ] Write tests first for hash-chain construction, chain verification, and tamper detection before writing any implementation
- [ ] Define an immutable `AuditEvent` domain type in `src/domain/audit.ts`: `eventId`, `eventType` (`ROSTER_MOVE`, `TRADE_PROPOSED`, `TRADE_ACCEPTED`, `TRADE_REJECTED`, `DRAFT_PICK`, `LINEUP_CHANGE`, `FLAG_RAISED`, `FLAG_RESOLVED`, `ADMIN_ACTION`, `SESSION_STARTED`, `SYSTEM_ACTION`), `actorId`, `actorType` (`USER` | `SYSTEM`), `leagueId`, `payload` (event-specific structured data), `occurredAt`, `previousEventHash`, `eventHash`
- [ ] Implement hash chaining: `eventHash = sha256(previousEventHash + canonicalSerialize(eventFields))`; the first event in the chain uses a documented genesis constant (config, not a magic string inline)
- [ ] Add a Drizzle schema for `audit_events` (SQLite); add `BEFORE UPDATE` and `BEFORE DELETE` triggers on the table that raise an error, so append-only is enforced by the database itself, not just by which methods the app exposes. **A scaling review found this table unindexed against its actual read patterns — `audit_events` is the fastest-growing table in the system, read by `leagueId`, `actorId`, `eventType`, and time range. Fix:** add composite indexes `audit_events(leagueId, occurredAt)` and `audit_events(actorId, eventType, occurredAt)`
- [ ] Implement an `AuditLogger` service exposing only `record(event): Promise<AuditEvent>` — no update, no delete, no upsert
- [ ] Implement `verifyChainIntegrity(): { valid: boolean; firstBrokenEventId?: string }` as a **checkpointed, incremental** verification — **a scaling review found that recomputing every hash in the chain on every run becomes unrunnable at real audit-log volume, meaning tamper detection would silently become decorative because nobody could afford to actually run it. Fix:** store a `verified_through_event_id` checkpoint (a single-row `audit_chain_checkpoint` table); each run recomputes hashes only from the checkpointed event forward to the current chain head, then advances the checkpoint to the new head on success
- [ ] Implement `verifyFullChainIntegrity(): { valid: boolean; firstBrokenEventId?: string }` as a separate, explicitly-invoked full from-genesis walk — the safety net for a tamper predating the last checkpoint — run as a low-frequency **scheduled offline job**, cadence set by `AUDIT_FULL_VERIFY_INTERVAL_HOURS` in `src/config/integrity.ts`, never on the hot path
- [ ] Build a shared `notifyAffectedMember(leagueId, userId, notificationType, context)` helper (`src/integrity/notifications.ts`) that any downstream step in this phase calls to surface a system-triggered action to the member it affects. **A UX review found that this phase's automated/system actions (Step 5's lineup auto-set and trade auto-hold, Step 6's tier-based join block) produced only a database flag/audit event, with no designed explanation ever reaching the affected user. Fix:** every downstream step that writes a `SYSTEM_ACTION` audit event must also call this helper in the same flow, with copy that is clear, specific, and non-accusatory — never language implying the user did something wrong. This module is the **one** place automated-action notification copy lives; call sites pass structured context, never inline strings. Add a test-level denylist check (terms like "violation," "suspected," "you broke the rules") that fails if any template uses accusatory language
- [ ] Wire audit logging into Phase 1's existing mutation points via an event-subscriber layer, not by editing Phase 1's reducers/logic directly: subscribe to draft-pick completion (Step 3's engine), lineup/roster changes (Step 6), and trade accept/reject (Step 8's flow) and call `AuditLogger.record` with the appropriate `eventType`
- [ ] Write a test that simulates tampering (a raw SQL `UPDATE` issued outside the ORM's normal path, or a manually corrupted in-memory chain in a unit test) and asserts both `verifyChainIntegrity` and `verifyFullChainIntegrity` catch it and report the correct `firstBrokenEventId`
- [ ] Write a test proving the incremental behavior itself: seed N events, run `verifyChainIntegrity` to checkpoint at event N, append M more events, run it again, and assert only the M new events were re-hashed (not N+M — e.g. via a call-count assertion on the hashing function), while `verifyFullChainIntegrity` always re-hashes from genesis regardless of the checkpoint
- [ ] Write a test asserting the DB triggers reject direct UPDATE/DELETE against `audit_events` even when issued via raw SQL, independent of the `AuditLogger` service

### Verification
```bash
npm test -- audit-log
npm run lint
npm run typecheck
```

### Exit criteria
- Hash-chain creation, verification, and tamper-detection are all covered by tests, including a test that a manually corrupted row fails `verifyChainIntegrity` (or `verifyFullChainIntegrity`, as appropriate to where the corruption falls relative to the checkpoint) with the correct broken-event pointer
- `audit_events` carries both composite indexes (`(leagueId, occurredAt)` and `(actorId, eventType, occurredAt)`), verified present via a schema-introspection test
- A routine `verifyChainIntegrity` run only re-hashes events after the last checkpoint; a corrupted event **before** that checkpoint is caught only by the separate `verifyFullChainIntegrity` job, not by the routine incremental run — both behaviors covered by tests
- A full seeded test league produces exactly one correct audit event per roster move, trade action, draft pick, and lineup change, each with correct `actorId` and `occurredAt`
- Direct UPDATE/DELETE against `audit_events` is rejected by the database itself, verified by a test that bypasses the ORM
- Calling `notifyAffectedMember` with a template containing denylisted accusatory language fails the test-level check

### Rollback
Additive event-subscriber layer — the subscriber hooks can be disabled via feature flag without touching Phase 1's draft/trade/roster logic. Once Steps 2–6 depend on it, do not roll back without also disabling everything downstream.

---

## Step 2 — Multi-account detection heuristics

**Model tier:** strongest (high false-positive cost on a platform that will eventually hold real money; the design decision to flag-not-ban has to be enforced in code, not just policy)
**Depends on:** Step 1, Phase 2 (session/device data needs real accounts)
**Parallel with:** Step 3, Step 6

### Context brief
Strategy doc §1.1 names "no multi-accounting detection" as a recurring Apex complaint, and §4.1 says it "matters more here than anywhere else in the product" for public/stranger leagues, since there's no leaguemate around to notice an odd second account the way there would be in a friend league. **This step must FLAG for human/admin review, not auto-ban.** False positives on real accounts are a serious problem — two roommates on the same wifi, a family sharing a device, or two friends who happen to draft on a similar schedule will all produce non-zero similarity scores, and none of those are proof of collusion. Design and test this module so that no code path in it can suspend, ban, or restrict an account; its only output is a `PENDING_REVIEW` flag routed to Step 4's dashboard. State this constraint explicitly in code comments at the top of the module, not just in this brief.

### Tasks
- [ ] Write tests first for each similarity heuristic in isolation, with hand-computed expected scores for known-similar and known-dissimilar synthetic account pairs
- [ ] Extend the Phase 2 session model to capture, at session creation: a coarse client-reported device fingerprint (e.g., user agent, screen dimensions, timezone — no invasive third-party fingerprinting SDK for this prototype) and the request IP; log each session start as a `SESSION_STARTED` audit event via Step 1's `AuditLogger`
- [ ] Implement `computeDeviceSimilarityScore(accountA, accountB): number` (0–1), `computeIpCorrelationScore(accountA, accountB): number`, and `computeBehavioralSimilarityScore(accountA, accountB, leagueId): number` (e.g., near-identical draft-pick timing offsets or lineup-set cadence within the same league) as pure functions with no side effects, each independently unit-tested
- [ ] Combine the three into `computeMultiAccountSuspicionScore(accountA, accountB, leagueId): number` via a weighted formula; weights and the final `MULTI_ACCOUNT_FLAG_THRESHOLD` live in `src/config/integrity.ts`, not inline
- [ ] Bound the comparison to account pairs that share a league — never compare every account against every other account platform-wide; this limits both compute cost and false-positive exposure
- [ ] When the combined score crosses the configured threshold, write a `MultiAccountFlag` record with status `PENDING_REVIEW` (the scores and signals that produced it, for admin context) and a corresponding `FLAG_RAISED` audit event — nothing else happens
- [ ] Write an explicit test asserting the "flag only, never auto-ban" contract: grep-style or direct test that no function in this module calls any account-suspension/ban/removal API
- [ ] Write tests for known false-positive-prone scenarios (shared device, shared IP, family members in the same league) that assert a flag is produced but confirm — via a code comment and test name — that this is expected behavior for human review, not a defect to "fix" by suppressing the flag

### Verification
```bash
npm test -- multi-account-detection
npm run lint
npm run typecheck
```

### Exit criteria
- Each heuristic has an independent test suite with hand-computed expected values
- Threshold and weights are loaded from `src/config/integrity.ts`; a test proves changing the config changes flagging outcomes with no code change
- No automatic account action is reachable from this module — flags only ever land in `PENDING_REVIEW` status, verified by an explicit test

### Rollback
Detection can be disabled via feature flag at any time — no account has ever been auto-actioned by this module, so disabling it is always safe and loses nothing but future flags.

---

## Step 3 — Trade-fairness flagging service (reuses Phase 1 Step 8's AI trade analyzer)

**Model tier:** strongest for the reuse/integration design (getting this wrong means silently forking the analyzer into two implementations that can drift), default for the subscriber plumbing
**Depends on:** Step 1, Phase 1 Step 8 (the existing AI trade analyzer — must be imported and reused, not reimplemented)
**Parallel with:** Step 2, Step 6

### Context brief
Strategy doc §4.2 is explicit about this design: "A trade analyzer that does double duty. The same model that tells a member whether a trade is fair for their team is the model that powers the platform's own collusion/trade-fairness detection in public leagues... One AI investment, two product surfaces." Phase 1 Step 8 already built this analyzer as a member-facing advisory tool — it takes a proposed trade plus both teams' rosters/scoring context and returns a fairness assessment with reasoning, and Step 8's own exit criteria required it be "reusable later as the platform's own collusion/trade-fairness detector." **Before writing any code in this step, locate and read Phase 1 Step 8's existing trade-analyzer module and its exported interface.** This step imports and calls that function; it does not re-derive fairness scoring logic. The only new thing this step adds is: subscribing to completed trades, calling the existing analyzer automatically (rather than only on member request), comparing its score against a review threshold, and writing a flag when a trade is lopsided enough to warrant collusion review.

### Tasks
- [ ] Read Phase 1 Step 8's trade-analyzer implementation and confirm its exported signature (e.g., `analyzeTradeFairness(trade, teamAContext, teamBContext): TradeFairnessAssessment`) before writing tests
- [ ] Write tests first for a new `TradeFairnessFlagService` that subscribes to Step 1's `TRADE_ACCEPTED` audit events, calls the existing analyzer with the completed trade's data, and compares the returned fairness score against `TRADE_FAIRNESS_FLAG_THRESHOLD`
- [ ] Add `TRADE_FAIRNESS_FLAG_THRESHOLD` to `src/config/integrity.ts`, documented as distinct from and independent of Step 8's member-facing advisory copy — this threshold governs when an *already-completed* trade gets a collusion-review flag, not what a member sees before accepting
- [ ] When a completed trade's fairness score crosses the threshold, write a `TradeFairnessFlag` (status `PENDING_REVIEW`) that stores the analyzer's own reasoning output verbatim (reuse it, don't regenerate or re-summarize it) plus a `FLAG_RAISED` audit event
- [ ] Confirm and test that Step 8's original pre-accept member-facing advisory flow is completely unmodified by this step — this service only triggers on the post-acceptance `TRADE_ACCEPTED` event, never intercepting or altering the pre-accept advisory call
- [ ] Write a test proving reuse rather than drift: the same trade produces an identical fairness score whether invoked via Step 8's member-facing advisory endpoint or via this step's automatic post-acceptance trigger
- [ ] Write tests for both sides of the threshold: a trade scored below `TRADE_FAIRNESS_FLAG_THRESHOLD` produces no flag; a trade at or above it produces exactly one flag with non-empty reasoning

### Verification
```bash
npm test -- trade-fairness-flagging
npm run lint
npm run typecheck
```

### Exit criteria
- A repo-wide search confirms only one function computes trade-fairness scores (Phase 1 Step 8's analyzer) — this step has zero duplicate scoring logic
- `TRADE_FAIRNESS_FLAG_THRESHOLD` is config-driven, covered by a test proving a config change alters flagging behavior
- A deliberately lopsided test trade (e.g., a top roster player for a bench-caliber player, no other context) is reliably flagged; a balanced test trade is not

### Rollback
Additive subscriber on Step 1's audit log — disabling it does not touch Phase 1 Step 8's analyzer or its member-facing endpoint in any way.

---

## Step 4 — Admin / dispute-resolution dashboard

**Model tier:** default
**Depends on:** Step 1, Step 2, Step 3
**Parallel with:** Step 6

### Context brief
Strategy doc §4.1: a public league has no trusted friend-commissioner, so "someone (platform staff, or eventually a fully automated process) needs tooling to review flagged disputes." This step is that tooling — the surface that turns Step 2's and Step 3's `PENDING_REVIEW` flags into an actual resolved decision, with the decision itself recorded in Step 1's audit log. For this MVP, human-in-the-loop is the correct default: build the review queue and resolution actions, gated behind a minimal admin role, not a full RBAC system. Step 5 later automates a narrow slice of clearly mechanical public-league cases, but this dashboard remains the escalation path for everything ambiguous, and closes Apex's "commissioners who never deny trades" complaint by making every review — approve or deny — a permanent, auditable record.

A UX review found that, as originally scoped, this phase's audit log was **admin-only visible** — strategy §4 promises members "a transparent per-league audit log," but nothing let an ordinary member see it, so a user whose lineup was auto-set, whose trade was held, or who was blocked from a league by tier segregation had no designed way to find out why. This step builds that member-facing counterpart alongside the admin queue below, since both are UI surfaces reading the same Step 1 audit trail.

### Tasks
- [ ] Write tests first for a `DisputeQueue` read model that aggregates `MultiAccountFlag` (Step 2) and `TradeFairnessFlag` (Step 3) records filtered by status, sorted oldest-first
- [ ] Add a minimal `isAdmin` boolean to the Phase 2 account/session model (not a general permissions framework — a single admin flag is sufficient for this MVP) and gate all dashboard routes behind it
- [ ] Build an admin route listing pending flags with full context: for multi-account flags, the component scores and signals that triggered it; for trade-fairness flags, the trade itself plus the reused analyzer's reasoning (Step 3)
- [ ] Build a flag detail view that surfaces the relevant Step 1 audit trail for that flag (e.g., for a trade-fairness flag: the full propose → accept audit sequence for that trade)
- [ ] Implement `resolveFlag(flagId, decision, adminNote): Promise<void>` where `decision` is a fixed enum (e.g., `NO_ACTION`, `WARNED_USER`, `TRADE_REVERSED`, `ACCOUNT_RESTRICTED`); every resolution writes its own `FLAG_RESOLVED` audit event — never mutates the original flag or any audit record, consistent with Step 1's append-only design
- [ ] Enforce that only `PENDING_REVIEW` flags are resolvable, and that resolution is one-way (no re-opening; a corrected decision is a new event, not an edit)
- [ ] Build a **member-visible league activity feed** (`/league/<id>/activity`) — reachable by any league member, not gated behind `isAdmin` — rendering a readable, chronological view of that league's audit events (draft picks, trades, roster/lineup moves, and `SYSTEM_ACTION` entries alongside the plain-language notification copy Steps 5 and 6 send via Step 1's `notifyAffectedMember`). Define an explicit per-`eventType` field allowlist for this view and exclude admin-investigatory-only fields (raw multi-account similarity scores, other members' flag detail) — don't reuse the admin view's full payload
- [ ] Write a test proving the allowlist: a `PENDING_REVIEW` multi-account flag's raw scores/signals are present in the admin flag detail view but absent from the member activity feed for the same underlying events
- [ ] Seed several multi-account and trade-fairness flags at different severities for manual verification of the queue and resolution flow

### Verification
```bash
npm test -- admin-dashboard
npm run lint
npm run typecheck
npm run dev   # manual: log in as a seeded admin account, review and resolve seeded flags
```

### Exit criteria
- Every `PENDING_REVIEW` flag from Step 2 and Step 3 is visible and actionable from a single queue
- Every resolution action produces its own `FLAG_RESOLVED` audit event; the original flag and its underlying audit records are never mutated, only appended to
- A non-admin session cannot reach any dashboard route or call `resolveFlag`, verified by an explicit test
- Any league member (not just an admin) can view that league's activity feed, and it never surfaces admin-only investigatory fields, verified by a test comparing the admin and member views of the same underlying events

### Rollback
Admin UI/API surface only — disabling it does not affect flag generation (Steps 2/3) or the underlying audit log; flags simply accumulate unresolved until re-enabled.

---

## Step 5 — Automated rule enforcement for public leagues

**Model tier:** strongest (this directly replaces human/commissioner judgment for a subset of cases; getting the scope or thresholds wrong either fails to protect users or over-automates disputes that need a human)
**Depends on:** Step 1, Step 3, Step 4, Phase 1 Step 9 (this step only applies to leagues created via public matchmaking)
**Parallel with:** Step 6

### Context brief
Strategy doc §4.1: "platform-owned commissioner functions for public leagues specifically: automated rule enforcement and dispute resolution, rather than handing commissioner powers to whichever stranger happened to create the league. A private league can reasonably trust a friend as commissioner; a public league can't trust a stranger the same way." This directly answers §1.1's "commissioners who never deny trades" complaint for the leagues where it matters most. **Scope this narrowly**: automate only mechanical, unambiguous cases — roster/lineup states already invalid under Phase 1 Step 3's eligibility rules, trades scoring far past a stricter auto-hold threshold, and missed-lineup-deadline defaults. Anything ambiguous still routes to Step 4's dashboard; nothing in this step silently resolves a dispute on its own. **Private/invite leagues must be completely unaffected** — they keep member-commissioner-driven moderation exactly as Phase 1 built it.

A UX review found that this step's automated actions (missed-deadline lineup auto-set, trade auto-hold) produced a `SYSTEM_ACTION` audit event and nothing else — no designed explanation ever reached the affected member, who just saw their lineup or trade silently change. Every automated action below must also call Step 1's `notifyAffectedMember`, not just log to the audit trail.

### Tasks
- [ ] Write tests first for a `PublicLeagueEnforcementPolicy` that only activates when a league's `isPublicMatchmade` flag (from Phase 1 Step 9's league record) is true; write a matched test pair proving the identical trade/lineup scenario produces different outcomes in a public vs. a private league, differing only by that flag
- [ ] Add `TRADE_AUTO_HOLD_THRESHOLD` to `src/config/integrity.ts` — a stricter, more extreme threshold than Step 3's `TRADE_FAIRNESS_FLAG_THRESHOLD`. A public-league trade scoring at or beyond this threshold is automatically placed on hold (not reversed, not auto-rejected — held pending mandatory Step 4 admin review), while a trade above only the (lower) flag threshold still completes and is merely flagged, per Step 3's existing behavior
- [ ] Write a test enforcing the config invariant that `TRADE_AUTO_HOLD_THRESHOLD` is strictly more extreme than `TRADE_FAIRNESS_FLAG_THRESHOLD` — the test should fail loudly if the two are ever misconfigured in the wrong order
- [ ] Implement automatic missed-deadline lineup handling for public leagues: if a lineup is left unset past lock time, apply a configured strategy (`MISSED_DEADLINE_LINEUP_STRATEGY` in config — e.g., `REPEAT_PREVIOUS_WEEK` or `BEST_LEGAL_LINEUP`), replacing what a commissioner would otherwise have to manually fix
- [ ] Implement automatic rejection, at submission time, of roster moves that are mechanically invalid under Phase 1 Step 3's existing eligibility rules for public leagues — reuse those rules directly, do not reimplement them; return a clear user-facing rejection reason
- [ ] Every automated action from this step writes a `SYSTEM_ACTION` audit event (Step 1, `actorType: SYSTEM`), so the audit trail looks structurally identical to a human commissioner's action, just attributed to the platform
- [ ] Add `LINEUP_AUTO_SET` and `TRADE_HELD_FOR_REVIEW` notification templates to Step 1's `src/integrity/notifications.ts`, and call `notifyAffectedMember` from the missed-deadline lineup auto-set path and the trade auto-hold path, in the same flow as their existing `SYSTEM_ACTION` audit event — not just one or the other. Copy is specific and non-accusatory, e.g. "Your lineup was set automatically because it wasn't submitted before lock — here's what we used" / "This trade is on hold for a fairness review before it completes," never language implying the user did something wrong
- [ ] Write a boundary test: a trade scored between the two thresholds completes normally but is still flagged (Step 3 behavior, unchanged); only trades at/above `TRADE_AUTO_HOLD_THRESHOLD` are held and notified

### Verification
```bash
npm test -- public-league-enforcement
npm run lint
npm run typecheck
```

### Exit criteria
- A matched test pair proves public and private leagues are handled differently for the same trade/lineup scenario, solely via `isPublicMatchmade`
- Every automated enforcement action is traceable through Step 1's audit log with `actorType: SYSTEM` — no automated action bypasses the log
- Every automated lineup auto-set and every trade auto-hold produces both a `SYSTEM_ACTION` audit event and a member-facing notification via `notifyAffectedMember`, verified by a test asserting a notification record exists with non-empty, non-accusatory copy for each triggering action
- A config test fails if `TRADE_AUTO_HOLD_THRESHOLD` is ever set less extreme than `TRADE_FAIRNESS_FLAG_THRESHOLD`

### Rollback
Enforcement is gated behind a per-league feature flag; disabling it reverts public leagues to Step 4's review-only behavior (flag and wait for a human) without automatically holding or reversing anything.

---

## Step 6 — Experience-tier segregation for public matchmaking

**Model tier:** default
**Depends on:** Step 1 (historical participation data), Phase 1 Step 9 (public league matchmaking UI — this step extends its filtering)
**Parallel with:** Step 2, Step 3, Step 5

### Context brief
Strategy doc §2.4: Tennessee and Mississippi already require separating beginner players from highly experienced ones in public contests (Tennessee: fewer than 51 contests vs. 500+ contests, or 5+ prizes ≥$2,500; Mississippi: 1,000+ contests or 3+ prizes ≥$1,000 triggers a visible experience marker). §4.1 is explicit that this "isn't a two-state quirk" and should be "a platform-wide default in the public-matchmaking flow... not a state-specific toggle bolted on later." Build **one** tiering system that applies to every public league on the platform regardless of the player's state — no state-conditional branching in this step's logic.

### Tasks
- [ ] Write tests first for `computeExperienceTier(accountId): ExperienceTier`, where `ExperienceTier` is a small fixed enum (`NEW`, `EXPERIENCED`) derived from the account's completed-league/contest count
- [ ] For this prototype (no real money, so no real prize-win history exists), compute the tier purely from a completed-public-league count sourced from Step 1's audit log / league-membership records — document in a code comment that a future real-money phase adds a prize-win-count signal alongside contest count, matching the state statutes' dual criteria
- [ ] Add `EXPERIENCE_TIER_CONTEST_COUNT_CUTOFF` to `src/config/integrity.ts` as a single platform-wide constant; document in a comment that this intentionally does not vary by state, per strategy doc §4.1, and that the number is a conservative platform default rather than any one state's specific figure
- [ ] Recompute and store an account's tier on a defined trigger (e.g., at each public-league join attempt), not continuously, to avoid unnecessary recomputation while keeping the tag from going stale
- [ ] Extend Phase 1 Step 9's matchmaking filter/browse UI to show experience tier as a default, always-visible filter (not opt-in) and to visibly label each public league's tier composition (e.g., "beginner" vs. "open") — reuse Step 9's existing filter component pattern rather than building a parallel filter system
- [ ] Enforce segregation at public-league join time: an `EXPERIENCED`-tier account attempting to join a `NEW`-tier public league is blocked, following the same enforcement pattern Step 5 uses for other public-league rules; private/invite leagues are unaffected — tier is at most informational there. **A UX review found that a blocked user got no designed explanation anywhere, just an unexplained rejection — the same gap fixed in Step 5. Fix:** add a `TIER_BLOCKED_JOIN` template to Step 1's `src/integrity/notifications.ts` and call `notifyAffectedMember` at the point of the block, surfacing a clear, non-accusatory reason (e.g. "This league is reserved for newer players so everyone starts on a level footing" — never language implying the user did something wrong)
- [ ] Write boundary tests around the configured cutoff: one contest below, exactly at, and one above

### Verification
```bash
npm test -- experience-tier
npm run lint
npm run typecheck
npm run dev   # manual: browse public leagues as seeded accounts at different tiers
```

### Exit criteria
- `EXPERIENCE_TIER_CONTEST_COUNT_CUTOFF` lives only in config; a test proves changing it changes tiering results with no code change
- A seeded `EXPERIENCED` account cannot join a seeded `NEW`-tier public league, through either the UI or the underlying join function
- A blocked join attempt produces a `TIER_BLOCKED_JOIN` notification with non-accusatory copy via `notifyAffectedMember`, verified by a test
- A matched test proves private leagues are unaffected by tier segregation — the same join scenario succeeds regardless of tier

### Rollback
Segregation enforcement is behind a feature flag; disabling it reverts to Phase 1 Step 9's original unsegregated public join flow. Tier computation/tagging can be left running inertly (computed but not enforced) at zero risk.

---

## Post-Phase: What This Unlocks Later

The audit log (Step 1) is explicitly built as reusable infrastructure, not a one-off feature: a future regulated-build-out phase (per Phase 1's "Post-Blueprint: Next Blueprint" note) needs a per-user, per-state event trail for tax ledgering (strategy doc §3.4) and AML/OFAC transaction monitoring (§3.3) — both can be built as new read models over the same `audit_events` table rather than a new logging system. Similarly, Step 5's automated-enforcement scope is intentionally narrow in this phase; strategy doc §4.1's AI draft moderator (Phase 1 Step 5) and this phase's enforcement policy are natural candidates to expand together once more mechanical dispute categories prove safe to automate.
