# Commish — Automated Enforcement (Phase 3 Plan D)

Read this with `docs/conventions.md`, `docs/decisions/enforcement-and-tiers.md`, `docs/trades.md`
and `docs/draft-room.md` before touching anything under `src/participation/`,
`src/league-service/enforcement.ts`, `src/league-service/auto-lineup.ts`,
`src/draft-service/auto-start.ts` or the trade auto-hold branch in
`src/league-service/trades.ts`. This is the one place the whole enforcement story — what the
platform does on its own, where, and how to turn it off — is described end to end.

## What the platform does automatically, and in which leagues

**Exactly one predicate decides whether the platform acts on a league at all**, and every
automated action in this document asks it rather than re-deriving its own answer:

```ts
enforcementAppliesTo(league) === league.isPublicMatchmade && INTEGRITY_CONFIG.participation.enforceTierSegregation
```

(`src/league-service/enforcement.ts`.) A **private league never sees any of this**, however overdue
its draft, however lopsided its trade, however veteran its would-be joiner — the platform is never
a private league's commissioner, and this plan does not change that. A **public matchmade league**
sees all four actions below, and only while `enforceTierSegregation` (the platform-wide switch, see
"Rollback switches" below) is on.

Nothing here is a punishment. Every action either refuses something before it happens (a join, a
trade) or materializes a fact a manager left unset (a lineup, a draft's start) — never an account
action, never a reversal of something a person chose, and never something a member cannot see.

## The four automated actions, in the order a member meets them

A prospect meets the door first; a manager who is already in a league meets the other three across
a season.

### 1. Tier-blocked join

**Trigger:** a `veteran` account (three or more completed seasons,
`INTEGRITY_CONFIG.participation.veteranSeasonCutoff`) tries to join, OR create, a public matchmade
league declared `beginner`. There are THREE doors into a league, and this predicate covers two of
them. Checked at both of those with the SAME predicate (`tierJoinPrecondition`) — the join gate
(`publicJoinPrecondition`) and the creation gate (`createLeague`), because a self-declared
`beginner` label binds its own declarer just as much as a stranger
(`docs/decisions/enforcement-and-tiers.md` §4).

The third door is the INVITE (`acceptInvite`, `src/league-service/invites.ts`), and it is exempt on
purpose. `invitePrecondition` checks expiry and use count and never asks this question, in a public
matchmade `beginner` league as much as in a private one, because the exemption is about the
mechanism rather than the visibility flag: an invite is always a human handing a specific code to a
specific person, and this platform never polices what a commissioner does inside a group they
invited by hand. `src/league-service/join.test.ts` pins the public-league case in both directions —
the same account and the same league, refused at the join door and admitted at the invite one. See
`docs/decisions/enforcement-and-tiers.md` §4 for the full account, including the residual it leaves.

**What it does:** refuses the join (409) or the creation (409) before anything is written — no
half-created league, no half-joined seat. The join's own refusal is also recorded, in a SEPARATE
platform-scoped transaction after the refused join's own transaction rolls back (never inside it —
a refused join must not leave a league-chain row behind, and the refusal itself is what the caller
is waiting for).

**What it tells them:** a `TIER_BLOCKED_JOIN` notice, sent to the person turned away and to
NOBODY else — "This league is reserved for newer players so everyone starts on a level footing.
Browse the open leagues to find one you can join." It never states WHY (no completed-season count,
no tier label) — the same no-oracle discipline that keeps a private league's existence unconfirmed
to a stranger, one level down. `SYSTEM_ACTION_VISIBILITY.tier_blocked_join` is `hidden`: the event
is written on the PLATFORM chain, and nobody else in the league needs to know a stranger was
refused at the door.

### 2. Draft auto-start

**Trigger:** a public matchmade league's draft is still `scheduled` and its
commissioner-chosen `kickoff_at` (or the computed default, if nobody ever chose one) has passed.
Checked by the ticker's own due-kickoff scan (`autoStartDueDrafts`, `src/draft-service/
auto-start.ts`) on every tick.

**What it does:** starts the draft through the IDENTICAL path a commissioner's own button calls
(`store.startDraft`) — one start implementation, not two — claiming with a guarded status
transition (`UPDATE drafts SET status = 'in_progress' WHERE status = 'scheduled'`), never a lock,
because PgBouncer transaction pooling forbids `pg_advisory_lock`. The claim, the `START_DRAFT`
action append and the announcement all commit in the SAME transaction, so there is no crash window
where a draft is started with no audit trail.

**What it tells them:** a `DRAFT_AUTO_STARTED` notice to EVERY team in the league — "Your draft in
`<league>` has started. The draft reached its scheduled time, so we started it." —
`SYSTEM_ACTION_VISIBILITY.draft_auto_started` is `everyone`: a fact about the league's shared
calendar, true for everyone in it, about nobody's conduct.

### 3. Lineup auto-set

**Trigger:** a stat week is locked (`isLineupLocked`) and a manager in a public matchmade league
never saved a lineup for it. LEVEL-derived, not edge-derived: the ingestion worker fires it on
every tick the week is locked (`runTick`, `src/stats-pipeline/worker.ts`), and the candidate query
names only the leagues that still have a team missing a row for that week, bounded at
`AUTO_SET_CONFIG.maxLeaguesPerRun` (**100**). A league whose own transaction rolled back is
therefore set on the next tick, with no retry counter and no bookkeeping anywhere; a league that is
already done costs nothing. Any rollbacks the run does report reach an operator through the
worker's own due-report channel.

**What it does:** materializes a lineup through `MISSED_DEADLINE_LINEUP_STRATEGY` — today, the
ONLY declared strategy, `repeat_previous_week` — carrying the manager's own last saved choice
forward, dropping anyone no longer on the roster and refilling from the bench exactly as a manual
edit would. A team's very first week with nothing to carry forward gets the roster's own default
lineup, silently — nothing was carried forward to report. A team that already saved a row for the
week is left ENTIRELY alone.

**What it tells them:** a `LINEUP_AUTO_SET` notice, only to the manager whose lineup was set, only
when something was actually carried forward — "We set your week `<N>` lineup for you. Week `<N>`
kicked off in `<league>` before you set a lineup, so we started the same team you started in week
`<N-1>`." `SYSTEM_ACTION_VISIBILITY.lineup_auto_set` is `subject_only`: the same competitive-
sensitivity reasoning that keeps a manual `lineup_change` private to its own manager — broadcasting
one manager's missed deadline to the whole league would be worse than either extreme.

### 4. Trade auto-hold

**Trigger:** two managers agree to a trade in a public, platform-enforced league, and the gap
between what they are trading reaches `INTEGRITY_CONFIG.trade.autoHoldThreshold` (**35**) — nearly
twice the threshold that merely raises a flag for a completed trade (20), and almost three times
the one at which the advisor calls a trade lopsided to a member's face (12).

**What it does:** stops the trade BEFORE it executes. `acceptTrade` never calls `applyTradeInTx` —
no roster moves, no other offer is superseded — and the row moves to a seventh status, `held`,
instead of `accepted`. In the SAME transaction (nothing happened in the league, so there is no
second chain to cross), a `trade_hold` flag reaches the operator queue. An operator resolves it
`trade_released` (the trade executes, re-validated against current rosters) or `trade_blocked`
(the trade never happens, both rosters stay exactly as they were).

**What it tells them:** a `TRADE_HELD_FOR_REVIEW` notice to BOTH managers, in founder decision
#10's own words — "Your trade with `<counterparty>` in `<league>` is on hold while somebody at
Commish looks at it." — never "under review" or "suspicious." `SYSTEM_ACTION_VISIBILITY
.trade_held_for_review` is `hidden`, for a structural reason: the hold's event is written on the
PLATFORM chain and is never read by the league's own activity feed at all.

## Where every threshold lives, and what changing it does

| Threshold | Lives in | Value | Changing it |
|---|---|---|---|
| `veteranSeasonCutoff` | `INTEGRITY_CONFIG.participation` | 3 | Moves how many completed seasons make an account a `veteran` for join/creation segregation. Read at the moment of a join or creation attempt — never stored, never cached — so a config change takes effect on the very next attempt with no backfill. |
| `verifiedSeasonCutoff` | `INTEGRITY_CONFIG.participation` | 1 | Moves how many completed seasons earn the review feed's "Verified" badge. |
| `enforceTierSegregation` | `INTEGRITY_CONFIG.participation` | `true` | The platform-wide rollback switch — see below. |
| `autoHoldThreshold` | `INTEGRITY_CONFIG.trade` | 35 | Moves the gap at which a trade is held rather than merely flagged. Ordered against `fairnessFlagThreshold`, `lopsidedDelta` and `evenDelta` on one axis by `src/integrity/config.test.ts`; an inversion is a test failure, not a silent misconfiguration. |
| `fairnessFlagThreshold` | `INTEGRITY_CONFIG.trade` | 20 | Not itself an automated ACTION (a flag reaches an operator, nothing is refused or held) — listed because raising it past `autoHoldThreshold` would be the inversion the ordering test catches. |
| `MISSED_DEADLINE_LINEUP_STRATEGY` | `src/league-service/auto-lineup.ts` | `"repeat_previous_week"` | The ONLY declared strategy — `MISSED_DEADLINE_LINEUP_STRATEGIES` is a one-value tuple, not a config field, because an undeclared `best_legal_lineup` arm would be an enum value with no implementation, the exact "control wired to nothing" shape this phase refuses (`docs/decisions/enforcement-and-tiers.md` §6). Changing this means writing a second strategy and its own implementation, not flipping a value. |
| `kickoff_at` (default) | `LEAGUE_CONFIG.defaults`, `drafts.kickoff_at` | computed default, commissioner-overridable up to `maxDraftDaysAhead` (60 days) | A commissioner's own choice via `PUT /api/leagues/[leagueId]/draft-schedule`, bounded by `LEAGUE_CONFIG.defaults.maxDraftDaysAhead` so the clock can never sit at its widest tier for months. Not itself a Plan D config field — Phase 1's own league config, made choosable by this plan. |

## Both rollback switches, and what each one stops

There are exactly two, and neither is a database column invented for this purpose — see
`docs/decisions/enforcement-and-tiers.md` §10 for why a per-league boolean with no writer was
refused.

| Switch | Scope | What it stops |
|---|---|---|
| `leagues.is_public_matchmade` | Per-league, pre-existing (Phase 1) | Set it `false` (a commissioner's own choice, made at creation) and NONE of the four actions above ever run for that league — the platform was never that league's commissioner, and this plan does not change who is. |
| `INTEGRITY_CONFIG.participation.enforceTierSegregation` | Platform-wide, one config flag, settable at deploy with no business-logic change | Set it `false` and ALL FOUR actions stop, across every public matchmade league at once: no join or creation is ever blocked, no lineup is ever auto-set, no trade is ever held, no draft is ever auto-started. **Tier computed, but inert** — the spec's own words. Every label, filter and the verified badge keep working exactly as before; only enforcement stops. |

## What a reader will look for, and not find

**There is no account action anywhere in this phase.** The strongest thing any automated action in
this document can do to a person is refuse them a seat, hold a trade, or set a lineup they left
unset — never suspend, restrict or otherwise touch an account. `flag-only.test.ts`'s
`INTEGRITY_DIRS` sweep, which `src/participation` joined the same commit it was created, enforces
this by test rather than by review alone.

**There is no state-conditional branching in the tier.** `veteranSeasonCutoff` is one constant,
read the same way for every account on the platform. Strategy §4.1's own premise is a platform-wide
default rather than a jurisdiction toggle, and this plan does not build one — searching this
codebase for a state, region or jurisdiction check anywhere near `participationTierFor` will not
find one.

**There is no automated action in a private league at all.** Every one of the four actions above
gates on `enforcementAppliesTo`, and a private league answers `false` regardless of the platform
switch — `is_public_matchmade` is the axis that puts a league in front of a stranger at all, and
this platform never polices what a commissioner does inside a group they invited by hand.
