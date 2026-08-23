# Backend surface map

Phase 3.6 addendum, Task 15 — the backend-leverage inventory. Founder directive 2, first half:
before this product's design gets rebuilt, know what it already has and whether a human can
reach it.

## Method

Fourteen service modules (eighteen directories — some are grouped by theme in the walk order
below), plus every component directory under `src/*-room/components/**` (a component nobody
renders is the same failure as a capability nobody surfaces). For every exported capability — a
function or a const table that decides product behavior, never a Zod schema, a `*Input`/`*Result`
type, or a `test-support.ts` export — `rg` for consumers outside its own directory and outside
`*.test.*`, then one of three verdicts:

- **SURFACED** — named here is the exact file that renders it to a human. A capability reached
  only by another module or another function is surfaced by whatever surfaces *that*, traced to
  its own human-facing end rather than re-walked at every hop.
- **DEFERRED** — no human surface, and the reason that is currently correct, plus the phase that
  owns changing it.
- **GAP** — no surface and no defensible reason. Every GAP below is either a step already inside
  one of Tasks 16–21 of the addendum, or a row in Task 22's backlog with a severity and an owner
  phase. None is left unassigned.

Internal helpers — a private query, a factory function, a lookup table consumed only by a sibling
file in the *same* directory (`writeLeagueInTx`, `createKeyedMutex`, `canonicalPairId`,
`hashClientIp`, and dozens like them) — are not given their own row. They are implementation detail
of the capability that calls them, and that capability is what this map walks. A directory-by-
directory grep of every export against the whole tree confirmed each of these has zero consumers
even inside its own module beyond the one function that already appears below.

Three tests enforce the parts of this map that would otherwise rot silently:
`src/help/glossary.source.test.ts` (every glossary term wired or listed with a reason),
`src/integrity/system-action-surfaces.test.ts` (every system action has a reader, not just a
writer), and `src/integrity/service-map.source.test.ts` (this document names every service
module — module-level, so a fifteenth directory with no row here fails the build).

## The seeded findings, verified

The planner's original walk seeded nine findings before this task ran. Every one was re-checked
against the code in this worktree rather than trusted; one count needed correcting
(`SYSTEM_ACTION_CODES` had grown from 8 to 9 between the seed and this walk — `house_league_opened`
shipped in the Phase 3.5 addendum's Task 13, after the seed was written). The rest held exactly as
seeded.

| Module | Capability | Verdict | Surface, or the reason | Owner |
|---|---|---|---|---|
| `src/integrity-service` | `listNotices(db, userId)` | **GAP → backlog, HIGH** | Takes no cursor (`notify.ts:184`), capped at `INTEGRITY_CONFIG.notices.inboxSize`. A member's own audit-anchored record of what the platform did to them is unreadable past the cap, from anywhere. A service change (a cursor plus a page), not a design-addendum step. | Backlog — HIGH, phase TBD |
| `src/help` | `GLOSSARY` (10 of 20 terms) | **GAP → enforced by `glossary.source.test.ts`** | `snake-draft`, `auction-draft`, `ppr`, `half-ppr`, `te-premium`, `custom-scoring`, `flex`, `stake-tier`, `matchup`, `standings-record` have no `InfoTip` caller in production. Triaged below (Step 4). | 3 → parent Task 11; 7 → addendum Task 21 Step 4 |
| `src/league-service` | `completedSeasonsFor(db, userId)` about oneself | **GAP → Task 18** | The axis that decides which leagues a person may join (`league-service/enforcement.ts`'s veteran gate) is invisible until it refuses them at a door. No surface reads it back to the member it is about. | Addendum Task 18 (the account room) |
| `src/participation` | `participationTierFor` / `isVerifiedPlayer` about oneself | **GAP → Task 18** | Same axis, the pure decision functions. `isVerifiedPlayer` IS shown about *other* reviewers (`review-feed.tsx`'s badge) — never about the viewer's own standing. | Addendum Task 18 |
| `src/integrity-service` | `leagueModerationSummary` | **GAP → backlog, MEDIUM** | Rendered by `ModerationSummary` in `league-home.tsx`, gated on `home.isCommissioner ? … : null`. `isCommissionerOf`'s `house` branch returns `false` unconditionally (`league-service/authority.ts`) — a house league has no commissioner, so the founder's core product renders this for nobody there. Who should see it in a house league is an authority decision, not a design one. | Backlog — MEDIUM, phase TBD |
| `src/integrity-service` | `verifyChainIntegrity` / `verifyAllChains` / `grantAdmin` / `sweepUnflaggedTrades` / `sweepSupersededHoldFlags` / `sweepLeagueForMultiAccounts` | **DEFERRED** | Real operator surfaces: `npm run audit:verify`, `admin:grant`, `trades:sweep`, `integrity:sweep` (`package.json`, `scripts/*.ts`). An operator console page for chain health is its own work with its own authz. | Backlog — LOW (operator console) |
| `src/identity` | `NOTIFICATION_CATALOG` / `channelStatus` / `deliverableChannels` | **SURFACED (read-only, correctly)** | `NotificationSummary` (`account-room/components/notification-summary.tsx`) renders the catalog and states email is not connected. A toggle for a channel with no sender is the switch-wired-to-nothing this codebase refuses. | Task 18 retones it, adds no control |
| `src/review-service` + `src/chat-service` | `reportReview` / `reportMessage` | **GAP → Task 21 plus backlog, MEDIUM** | The only two member-facing paths into the dispute queue (`app/api/reviews/[reviewId]/report`, `app/api/leagues/[leagueId]/chat/[messageId]/report`). No way to raise a question about a trade, a draft, a league, or a manager, and no page explains what the queue is or when an answer arrives. | Task 21 Step 4 (the support page, the named entry the 3.5 loop deferred); a real report-a-league-thing flow is backlog MEDIUM |
| `src/trades`, `src/ai-advisor`, `src/chat-room`, `src/draft-service` | Trade valuation, trade advisor, chat reactions, GIF picker, chat reporting, removed-message tombstones, draft queue, slot preference and its post-draw outcome, owed picks | **SURFACED** | Re-verified: `trades/fairness.ts` → `trade-verdict.tsx`/`trade-card.tsx`; `ai-advisor` → `advisor-panel.tsx` via the two advisor routes; `reaction-bar.tsx`, `gif-picker.tsx`, `report-dialog.tsx`, `removed-message.tsx` all render inside `message-list.tsx`; `draft-service/queue.ts` and `slot-preference.ts` → `room-dock.tsx`/`slot-preference-panel.tsx`; owed picks → `draft-board.tsx`/`room-rail.tsx`/`room-dock.tsx`/`player-pool.tsx`. | — |

## `SYSTEM_ACTION_CODES`, each one verified for a reader

The parent's Task 14 Step 4 proves every code has a **publisher**. `system-action-surfaces.test.ts`
proves every code has a **reader**. Nine codes today (the seed said eight; `house_league_opened`
was the ninth, added in the Phase 3.5 addendum after the seed was written):

| Code | Visibility (`SYSTEM_ACTION_VISIBILITY`) | Reader |
|---|---|---|
| `stat_week_corrected` | everyone | Activity feed (`activityRowFor` → `renderSystemAction`) **and** a personal notice (`NOTICE_TEMPLATES.stat_week_corrected`) |
| `chain_verification_failed` | hidden | No reader, on purpose: an unread accusation before a human reviews the output (Plan A ruling 8). The one code this map's enforcement test lets stay silent, by name. |
| `lineup_auto_set` | subject_only | Activity feed (subject-scoped) **and** a personal notice |
| `trade_held_for_review` | hidden (from the league feed) | A personal notice reaches both parties — written to the platform chain, so `listLeagueActivity` never reads it, but the trade's own participants are told directly |
| `tier_blocked_join` | hidden (from the league feed) | A personal notice reaches the refused member — same platform-chain reasoning, same direct notice |
| `draft_auto_started` | everyone | Activity feed **and** a personal notice |
| `draft_pick_skipped` | subject_only | Activity feed (subject-scoped) **and** a personal notice |
| `draft_fill_triggered` | everyone | Activity feed **and** a personal notice |
| `house_league_opened` | everyone | Activity feed only — written to the new league's own chain (`spawnHouseLeagueInTx`), read once members arrive. No notice, by design: a league with no members yet has nobody to notify. |

## The component walk (F10)

`src/*-room/components/**`, five directories, 67 non-test component files. Every one traces
through a render chain to an app route:

- **`src/league-room/components`** (36 files) — the amended parent plan's Task 11 already claims
  the eight components this addendum's brief flagged as previously "untouched": `create-league-
  form.tsx`, `create-league-panel.tsx`, `invite-panel.tsx`, `trade-composer.tsx`, `matchup-
  celebration.tsx`, `live-matchup-week.tsx`, `held-trade-banner.tsx`, `join-league-entry.tsx`, and
  `join-public-league-button.tsx` (nine files; Task 11's Files block groups two of them under one
  bullet). All nine ARE rendered today — `create-league-form.tsx` → `create-league-panel.tsx` →
  `first-run-panel.tsx`/`start-or-join-disclosure.tsx` → `home-board.tsx` → `app/app/page.tsx`;
  `invite-panel.tsx` and `matchup-celebration.tsx` → `league-home.tsx` → the league page;
  `trade-composer.tsx`/`held-trade-banner.tsx` → `trade-card.tsx`/`trade-inbox.tsx` → the trades
  page; `live-matchup-week.tsx` → the matchups page directly; `join-public-league-button.tsx` →
  `public-league-list.tsx` → `/browse`. **ASSIGNED to Task 11**, not a GAP: what they lack is the
  v2 retone, not a render path, which is exactly what Task 11 Step 3b does for them by name.
- **`src/league-room/components`**, the other 27 files — SURFACED, each with a confirmed consumer
  chain ending at an `app/**` page (`standings-table.tsx`, `matchup-panel.tsx`, `activity-feed.tsx`,
  `lineup-editor.tsx`, `waiting-room.tsx`, `moderation-summary.tsx`, and the rest).
- **`src/draft-room/components`** (15 files) — SURFACED. `room-shell.tsx` dispatches to
  `snake-room.tsx`/`auction-room.tsx`, both reached from `draft-room.tsx` →
  `app/app/drafts/[draftId]/page.tsx`; `tv-board.tsx` → `app/draft/[draftId]/board/page.tsx`.
- **`src/chat-room/components`** (7 files) — SURFACED. `league-chat.tsx` is rendered inside both
  `league-home.tsx` and `draft-room.tsx`; every child (`chat-composer.tsx`, `gif-picker.tsx`,
  `message-list.tsx`, `reaction-bar.tsx`, `removed-message.tsx`, `report-dialog.tsx`) chains
  through it.
- **`src/account-room/components`** (7 files) — SURFACED, all reached from
  `app/app/profile/page.tsx` or `app/reviews/page.tsx`.
- **`src/admin-room/components`** (2 files) — SURFACED, both reached from
  `app/app/admin/queue/[flagId]/page.tsx`.

No GAP found in the component walk. Every file the addendum's F10 finding named as "left in the
old palette" is a render-path SURFACED capability waiting on a retone, which is a different problem
than an inventory task solves — the retone is Task 11's job and already has it.

## GLOSSARY term triage (Step 4)

Ten terms, none deleted (they are correct definitions of things this product genuinely has), all
now either wired or listed in `UNSURFACED` (`src/help/glossary.source.test.ts`) with a reason:

- `stake-tier`, `matchup`, `standings-record` — the parent plan's league space, Task 11. The honest
  homes are `league-terms-panel.tsx`, `matchup-panel.tsx`, and `standings-table.tsx` — all three
  already in Task 11's Files block. Handed to it by name here rather than duplicated as a step.
- `ppr`, `half-ppr`, `te-premium`, `custom-scoring`, `flex`, `snake-draft`, `auction-draft` —
  format vocabulary. These land on the league-rules page this addendum's Task 21 Step 4 creates,
  which already names them explicitly as getting "their first real caller" there.

Neither set is wired yet (Tasks 11 and 21 run after this one), so every term above is in
`UNSURFACED` today with the sentence recording where it lands. `glossary.source.test.ts`'s second
test is the guard against the allowlist becoming a graveyard: the moment either task wires a term
up, its `UNSURFACED` entry must be deleted in that same commit or the test fails.

## Reorder ruling (Step 5)

**No GAP found in this walk changes the shape of Tasks 16 through 21.** Every GAP above already
has an owner inside the addendum's existing task boundaries (Task 18's account room absorbs the
two participation-about-oneself GAPs and already covers that surface; Task 21's support page
already exists as a Files-block entry and absorbs the report-a-league-thing GAP as its named
deferred scope) or lands in Task 22's backlog with a severity and an owner phase, per the table
above. No task's Files block required amendment. The three GLOSSARY terms assigned to Task 11 and
the seven assigned to Task 21 Step 4 were already named, by exact term, in the addendum's own plan
text before this task ran — this walk confirms rather than discovers that assignment.

The backlog rows this task adds to Task 22's closeout:

| Item | Severity | Owner phase |
|---|---|---|
| `listNotices` cursor (no cap on a member's own audit-anchored record) | HIGH | TBD — a service change, not a design addendum |
| `leagueModerationSummary` in a house league (no commissioner to gate it on) | MEDIUM | TBD — an authority decision |
| A real report-a-league-thing flow (trade, draft, league, manager) | MEDIUM | TBD |
| An operator console page for chain health | LOW | TBD |

## Full module list

The eighteen service-module directories this walk covers, confirmed present and checked:
`src/league-service`, `src/draft-service`, `src/chat-service`, `src/review-service`,
`src/identity-service`, `src/integrity-service`, `src/trades`, `src/participation`,
`src/moderation`, `src/ai-advisor`, `src/stats`, `src/stats-pipeline`, `src/help`,
`src/matchmaking`, `src/chat`, `src/identity`, `src/reviews`, `src/gifs`.
