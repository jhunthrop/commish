# Roadmap — Commish

**Product name:** Commish (domain: `commish.ly`) — settled after the original "Fantasy Football Platform" / "Beating Apex" working title. All phase files below still reference the original strategy doc by its own title, and the doc's own content is unchanged.

**Source strategy doc:** `docs/research/2026-08-16-beating-apex-strategy.md`

This is the full build, sequenced as 9 phases. Each phase is its own blueprint file with numbered, PR-sized steps a coding agent can execute cold. Phase 1 is a self-contained software prototype (no real money, no native apps, no regulated infra). Everything after it adds real accounts, real integrity tooling, real money, real tax compliance, real AI, real native apps, and dynasty/keeper depth — several of which have a genuine real-world (non-code) prerequisite, flagged explicitly below and inside each phase file.

## Phase sequence

| Phase | File | Steps | Objective | Depends on | Real-world blocker? |
|---|---|---|---|---|---|
| 1 | `fantasy-mvp-prototype.md` | 11 | Core UX prototype — draft engine, scoring, league mgmt, chat, AI advisor/moderator stubs, design system. No money, no native apps. | — | No — pure software |
| 2 | `phase-2-accounts-and-data-foundation.md` | 17 | Real accounts/auth, Postgres, hosting, stats-provider adapter seam, data-layer hardening (indexes/pooling/locking), backups & DR, live-scoring ingestion, caching, observability, load testing, onboarding/avatars/chat-depth/review-feed | 1 | No — pure software |
| 3 | `phase-3-trust-and-integrity.md` | 6 | Audit log (checkpointed verification), multi-account detection, dual-use trade-fairness flagging, public-league dispute enforcement, experience-tier segregation, member-visible activity feed | 1, 2 | No — pure software |
| 4 | `phase-4-payments.md` | 8 | FBO/agent-of-payee ledger (with concurrency locking), entry fees, escrow/payout, KYC/CIP, AML/OFAC, wallet & money-trust UX | 2, 3 | **Yes** — banking/BaaS partner must be signed (Step 1 of this phase); code proceeds against a mock adapter until then |
| 5 | `phase-5-tax-compliance.md` | 9 | W-9/TIN, backup withholding, 1099 generation (resumable batch jobs), state tax table, state-enablement gate, user-facing Tax Center | 4 | **Yes** — gaming-counsel-verified state list required before any state's flag flips live |
| 6 | `phase-6-ai-productionization.md` | 9 | Real LLM behind Phase 1's stubs (streaming), free/paid tiering, non-interactive job queue + global spend ceiling, prompt-injection defenses, conversational UX, weekly recaps, observability | 2 (free tier); 4 (paid-tier billing only) | No for free tier; paid-tier *billing* needs Phase 4 |
| 7 | `phase-7-native-apps.md` | 7 | iOS + Android native clients, platform-idiomatic nav/haptics, Live Activities/widgets, shared API contract, push notifications | 2 (can start); full parity needs 3–6 | **Yes** — Apple/Google developer accounts (flagged step within the phase) |
| 8 | `phase-8-legal-launch-readiness.md` | — | Entity formation, counsel sign-off, partner contracts, per-state go-live sequencing | 4, 5, 7 | **This entire phase is the real-world-blocker checklist** — mostly not code |
| 9 | `phase-9-dynasty-and-keeper-depth.md` | 6 | Dynasty startup + rookie drafts, keeper rules, tradeable draft-pick assets, trade calculator, orphan-team marketplace | 1 (min.); 3 (trade calc); 4 (marketplace proration) | No — pure software (marketplace proration mocked until Phase 4 is real) |

## Phase 3.5 — a founder-ordered interstitial pass

`docs/superpowers/plans/2026-08-22-phase3p5-competitiveness.md` is Phase 3.5: a founder-ordered
pass (2026-08-22, "before payments, make the site experience correct against the field") inserted
between Phase 3 and Phase 4 — superflex, the league median game, the overnight pause,
skip-and-return draft timeouts, draft-slot preferences (KDS) and the sit-and-go fill trigger with
its waiting room. It is competitive-analysis work, not a numbered phase: the nine-phase sequence
above and Phase 4's position in it are **unchanged** — Phase 3.5 does not renumber anything, add a
phase, or move a dependency edge. A reader who finds a "3.5" in a commit message and wants the
full story reads that plan file directly; this line exists so they know where to look without
reading it first.

`docs/superpowers/plans/2026-08-22-phase3p5-addendum-house-leagues.md` is that pass's own addendum:
a founder-ordered "view and join, like FFPC and Apex" house-league lobby — a catalog of
platform-run leagues on a nullable-commissioner schema, kept stocked by a reconciler, always with a
seat open. Same non-renumbering rule as its parent: no phase, no dependency edge, nothing else in
this table moves. `docs/decisions/house-leagues.md` is the addendum's own decision doc, for a
reader who finds "house league" in a commit message and wants the full story without reading the
plan file first.

## Phase 3.6 — a founder-ordered design pass

`docs/superpowers/plans/2026-08-23-phase3p6-design-v2.md` (paired with its own addendum,
`docs/superpowers/plans/2026-08-23-phase3p6-addendum-whole-site.md`) is Phase 3.6: a
founder-ordered visual and interaction redesign of the whole product — retoned palette (both
themes), a real app shell, five extracted primitives, "roll until full" as server-side truth, the
seat hold, and the proof-stats strip — run the same way Phase 3.5 was. Same non-renumbering rule:
the nine-phase sequence above and Phase 4's position in it are **unchanged**. `docs/decisions/design-v2.md`
is this pass's own decision doc.

## Cross-phase dependency graph

```
Phase 1 ─┬─→ Phase 2 ─┬─→ Phase 3 ─┬─→ Phase 4 ─→ Phase 5 ─┐
         │            │            │      │                │
         │            │            │      └──────────────→ Phase 9 (marketplace proration)
         │            │            └──────────────────────→ Phase 9 (trade calculator)
         │            ├─→ Phase 6 (free tier) ─────────────┤
         │            │      └─ paid-tier billing needs Phase 4
         │            └─→ Phase 7 (can start UI/scaffold once Phase 2's API is stable;
         │                          full parity needs Phases 3–6)
         └─────────────────────────────────────────────────┴─→ Phase 8 (go-live)
```

**Reading this:** Phase 1 → Phase 2 is a hard sequential dependency (everything downstream needs real accounts). From there, Phase 3 (integrity) must land before Phase 4 (money) per the strategy doc's own reasoning — money and anti-collusion tooling ship together. Phase 6's free tier only needs Phase 2 and can proceed in parallel with Phases 3–5; its paid tier waits on Phase 4. Phase 7 (native apps) can start its UI/scaffold work as soon as Phase 2's API is stable, running in parallel with the backend phases, but doesn't reach full feature parity until they land. Phase 9 (dynasty/keeper) can start on Phase 1 alone for its core draft/keeper mechanics, needs Phase 3 for the trade calculator, and Phase 4 for real marketplace buy-in proration (mocked until then). Phase 8 is the closing gate — it depends on 4, 5, and 7 all being real (not sandboxed), and is what actually turns the software into an operating, legal product. Until Phase 9 ships, the strategy doc's "every format, including dynasty" claim in §4 is not literally true of the running product — don't let marketing get ahead of the build state.

## Step-number reconciliation (Phase 1 v1 → v2)

Phases 2, 3, 4, 6, and 7 were drafted by parallel agents that read an earlier 9-step draft of Phase 1. That draft was rewritten to 11 steps after an adversarial review found a missing identity model, a false parallelism claim, an unowned matchup/schedule model, and no proof that a completed draft actually produces a working season. The affected phase files each carry their own reconciliation note; this is the canonical mapping:

| Old Phase 1 (v1) | New Phase 1 (v2) | What changed |
|---|---|---|
| Step 1 — scaffold | **Step 1** — scaffold | Same number, much larger scope: now includes the `User`/identity stub, `docs/conventions.md`, roster-eligibility, the `Matchup`/`Schedule` model, the shared LLM client module, and mandatory `git init`. The real-time layer went through two further revisions (see Phase 1's "Real-time & event architecture" section): first Socket.io → Postgres `LISTEN`/`NOTIFY` + SSE, then settled on **Redis Streams + SSE** — one durable, replayable broadcast mechanism for draft, chat, and later live scoring, no custom server, no managed realtime vendor |
| Step 2 — scoring | **Step 2** — scoring | Unchanged |
| Step 3 — draft engine | **Step 3** — draft engine | Unchanged, but now consumes roster-eligibility from Step 1 rather than owning it |
| Step 4 — live draft room (snake + auction combined) | **Step 4** (snake) + **Step 5** (auction + reconnect hardening) | Split in two — it was too large for one PR. A reference to "the transport/event protocol" now belongs to Step 1 (`docs/conventions.md`); snake-specific wiring is Step 4; auction-specific wiring is Step 5 |
| Step 5 — AI draft moderator | **Step 6** | |
| Step 6 — league management + scoring display | **Step 7** | Now also owns `Matchup`/`Schedule` generation |
| Step 7 — chat | **Step 8** | |
| Step 8 — AI advisory layer / trade analyzer | **Step 9** | |
| Step 9 — public matchmaking | **Step 10** | |
| *(did not exist)* | **Step 11** — end-to-end integration | New: proves a real draft → `commitDraftResults` → season/standings pipeline actually works, not just isolated per-step fixtures |

**If executing a step from Phase 2, 3, 4, 6, or 7 that cites "Phase 1 Step N," translate it through this table before trusting it literally.** Phase 5 and Phase 8 were written after the Phase 1 rewrite and already use correct numbering.

## What's genuinely done vs. what still needs a human decision

**Ready to execute now, no decisions pending:** Phase 1 in full. Phase 2 in full. Phase 3 in full (once Phase 2 lands). Phase 6's free tier (once Phase 2 lands). Phase 7's UI/scaffold work (once Phase 2 lands) — though its developer-account-setup step needs you. Phase 9's core draft/keeper mechanics (once Phase 1 lands).

**Blocked on a real decision before the phase can go past its own mock/sandbox layer:** Phase 4 needs a signed banking/BaaS partner. Phase 5 needs counsel sign-off on the state list. Phase 6's paid tier needs Phase 4's real billing. Phase 7's store submission needs Apple/Google developer accounts. Phase 9's orphan-marketplace proration needs Phase 4's real ledger. Phase 8 is that entire decision list, sequenced.

None of those blockers stop the *software* from being built and fully tested against mocks/sandboxes in the meantime — that's the whole point of the adapter-interface pattern every blocked phase uses.

## Scaling & UX review — fully applied

A full adversarial scaling review and a full adversarial UX-consistency review were run against all 8 original phases. Full findings: `docs/research/2026-08-16-scaling-review.md` and `docs/research/2026-08-16-ux-review.md`. **Every finding from both reviews has now been incorporated directly into the phase files** — nothing is left as a backlog. Summary of what changed, by phase:

- **Phase 1 (`fantasy-mvp-prototype.md`, v5):** fixed a real correctness bug — the real-time design specified `XREADGROUP`, which partitions stream entries across consumers instead of broadcasting to all of them (a 12-person draft would have delivered each pick to only one random viewer); now plain `XREAD BLOCK` with `Last-Event-ID` resume. Fixed the draft session store being in-memory-only with no crash recovery (now a durable, replayable action log). Fixed the plan having no way to actually create a league (Step 7 now has a real league-creation + invite flow). Added a design-system foundation to Step 1 (light+dark tokens, shared UI primitives with built-in loading/empty/error states, WCAG 2.2 AA baseline, `jsx-a11y`/`axe` in the test pipeline) that every later UI step reads first, plus a standing design-review/state-coverage/a11y/copy-review requirement on any step shipping a user-visible surface. Added the auto-tightening draft-clock schedule (Step 3), a castable large-format draftboard view and a draft-pick landing celebration (Step 4), a matchup-win celebration (Step 7), and a mobile-first 360px baseline.
- **Phase 2 (17 steps, was 7):** added data-layer hardening (indexes, a balance-rollup convention, per-draft locking, PgBouncer), a backups/PITR/DR step (landing before Phase 4 introduces real money), a live-scoring ingestion pipeline with caching, an observability step, deployment hardening (graceful shutdown, split health checks, CDN, general rate limiting — also closing the "future security-hardening phase" that was promised but never built, now explicitly folded into Phase 8), a load-testing step with named Sunday-concurrency scenarios, and product/UX steps for first-run onboarding, avatars, chat depth (GIFs/voice), and the in-product unfiltered review feed.
- **Phase 3 (6 steps, unchanged count):** added indexes on `audit_events`, made chain verification incremental/checkpointed instead of a full replay every run, and added user-facing visibility (a member activity feed, plain-language notifications) for every automated integrity action that affects a real user.
- **Phase 4 (8 steps, was 7):** closed two real concurrency races (league-capacity "last seat" and cross-contest balance checks, both now row-locked with a non-negative-balance constraint as a backstop) and added a dedicated wallet/money-trust UX step (balance breakdown, an always-on escrow indicator, multiple withdrawal methods with fee/ETA shown before commit, a self-explaining KYC flow with a real rejection path).
- **Phase 5 (9 steps, was 8):** made the annual tax-form batch job set-based, checkpointed, and idempotent instead of a non-resumable per-user loop; added a designed state-ineligibility experience (waitlist, pre-emptive eligibility checks) instead of a typed exception; added withholding transparency on payout confirmations; added a user-facing Tax Center so a user can actually see their own 1099s.
- **Phase 6 (9 steps, was 7):** added a global AI spend ceiling with tiered degradation, a Redis-backed job queue for non-interactive work (waiver alerts, win-probability, recaps) so a Sunday-morning burst can't take the interactive advisor down with it, streaming responses, and a real conversational UX component family (thinking state, degraded state, a mandatory confirm affordance that enforces the advisory-only legal constraint at the interaction layer, an upsell state) — plus the AI weekly-recap feature the strategy doc calls the highest delight-per-token feature in the doc, previously never scheduled.
- **Phase 7 (7 steps, was 6):** added platform-idiomatic navigation and haptics to the iOS/Android scaffold steps (the original spec was feature-parity porting, corrected to explicitly mean "same capabilities," not "same look"), and a new step for iOS Live Activities/Dynamic Island and Android home-screen widgets — a genuinely unclaimed differentiator. Recorded the Redis HA/degradation assumption this phase relies on explicitly.
- **Phase 9 (new, 6 steps):** dynasty startup + rookie drafts extending the existing draft engine, keeper rules and season carry-over, a tradeable draft-pick asset type (which also closed a real gap found along the way — trade *execution* had never been built anywhere, only trade *analysis*), a trade calculator reusing Phase 3's fairness analyzer, and an orphan-team marketplace (proration mocked until Phase 4 is real).

Cross-phase step-number references were re-checked after all seven phases were updated in parallel; the one reference that looked stale (Phase 8 citing "Phase 6 Step 3") turned out to still be correct by coincidence — Phase 6's new Step 3 is exactly the AI confirm-affordance component that reference was about.
