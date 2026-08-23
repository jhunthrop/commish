# Enforcement and Tiers — Phase 3 Plan D

A new document rather than more sections on `docs/decisions/audit-and-integrity.md`,
`docs/decisions/operators-and-moderation.md`, `docs/decisions/trades-and-fairness.md` or
`docs/decisions/identity-and-trust.md` — each is already 400 to 700 lines about other subjects,
and this plan's decisions belong together: they are the platform's first automated actions, not
another chapter on a spine that already has one. Read this with `docs/enforcement.md` (the
end-to-end walk of what happens and when) and the four decision docs above, which this document
corrects and points back to rather than restates.

Each section records what was chosen, why, and what would have to change for the choice to be
wrong.

## 1. Three tiers, three names, one document

`users.experience_tier` (`beginner` | `experienced`) is self-reported at sign-up and drives
`helpLevel` defaults and first-run ordering — an answer a user gave about themselves once, revisited
rarely. `leagues.experience_tier` (the same two-value enum, a different table) is self-declared by
a commissioner and rendered on `/browse` — an answer a commissioner gave about their own league.
`participationTier` (`newcomer` | `veteran`, `src/participation/tier.ts`) is neither: it is
COMPUTED from how many seasons an account has actually finished on this platform, and it is
ENFORCED — it can block a join.

The spelling difference is the mechanism, not a style choice. Reusing `beginner`/`experienced` for
the computed tier would type-check against BOTH existing columns and guarantee that somebody,
someday, hands a self-reported sign-up answer to a join gate that is supposed to be reading a
computed participation record — three meanings on one word is how a future reader ships the wrong
one, and the failure would be silent because all three are `beginner`-shaped strings. A different
noun AND a different vocabulary means the mistake is a compile error: `participationTierFor`
cannot be handed a `users.experience_tier` value, and `matchesBrowseFilter` cannot be handed a
`ParticipationTier`. `PARTICIPATION_TIERS` (`["newcomer", "veteran"]`) shares no member with
`EXPERIENCE_TIERS` (`["beginner", "experienced"]`) — a `ParticipationTier` and an `ExperienceTier`
are structurally incompatible even though both are two-value string unions.

**This is wrong only if the three facts turn out to be one fact**, which they cannot be: one is
what somebody said about themselves, one is what somebody said about a league, and one is what the
platform observed.

## 2. Where a completed season is recorded, and why it is a stamp

The spec asks to source the tier from "the audit log / league-membership records," and neither can
answer it: no audit event says a season ended, and the only observable completion is every matchup
in a league carrying a score.

**The query that asks it directly cannot use the obvious index.**
`NOT EXISTS (SELECT 1 FROM matchups WHERE league_id = $1 AND home_score IS NULL)` cannot use
`matchups_unsettled_idx`, whose leading column is `week_number` — so asked on every join or
creation attempt, it degrades with the size of the whole product rather than the size of one
league. `docs/decisions/data-layer-hardening.md`'s rule decides the split exactly: derive over a
bounded set, roll up over an unbounded one. The unbounded half — every matchup in the product —
gets stamped ONCE, in `finalizeWeekInTx` (`src/stats-pipeline/finalize.ts`), the ONE transaction
that can know a season just ended, because it is the transaction that just wrote the last matchup's
score. `stampSeasonCompleteInTx` (`src/league-service/participation.ts`) is that stamp:

```sql
UPDATE leagues SET season_completed_at = $occurredAt
 WHERE id = $leagueId
   AND season_completed_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM matchups WHERE league_id = leagues.id AND home_score IS NULL)
```

It runs LAST inside `finalizeWeekInTx` — not for ordering safety within that transaction (nothing
inside it takes a lock this statement conflicts with), but because it is the natural final
statement of "did that just finish the season." It is a ONE-WAY STAMP, the same discipline
`reviews.removed_at` and `integrity_flags.resolved_at` both already use: the guard against
re-stamping lives in the `UPDATE`'s own `WHERE season_completed_at IS NULL`, not in a prior read, so
`correctSettledWeek` re-running `finalizeWeekInTx` weeks later on an already-completed season
leaves the original date alone — a season ended when it ended, not when somebody last touched it.

**The lock note.** `joinLeagueInTx` takes `leagues[id] FOR UPDATE` first, before anything else it
does. This statement takes a row-exclusive lock on exactly one `leagues` row and nothing else — no
FK out of `leagues` it touches. The property that keeps it safe is not its position among
`finalizeWeekInTx`'s own statements but that a settlement transaction takes NO other lock
`joinLeagueInTx` also takes: a league whose last week is being scored has a complete draft
(`checkFinalizeGuards`), and a league with a complete draft already refuses joins at
`publicJoinPrecondition` before it locks anything at all.

**The bounded half, on demand.** `completedSeasonsFor`/`completedSeasonsForMany`
(`src/league-service/participation.ts`) count an account's OWN teams whose league has a
`season_completed_at` — one indexed join (`teams` INNER JOIN `leagues`), bounded by the leagues one
account has joined, never a scan of the platform. A stored per-user counter was considered and
rejected for the reason `data-layer-hardening.md` gives: a second source of truth for a number one
indexed count already answers, needing the same in-transaction discipline anyway for no benefit.

**This is wrong if a league can complete a season without its last week being scored**, which is
not a state this product has — `finalizeWeekInTx` is the only writer of a matchup's score, and it
is the same transaction that checks whether that was the league's last one.

**The index, and the prediction that flipped by measurement.** `leagues_season_completed_idx`
(migration `0028_season_completion.sql`, partial on `season_completed_at IS NOT NULL`) shipped in
Task 1 with no consumer yet in scope — a residual the review escalated: an index with no query that
chooses it is index-on-faith. Task 2's browse composition (the "N newcomers, M veterans" count on a
public browse card) turned out to need exactly this: `seatCompletedSeasonsQuery`'s `ON` clause
matches the partial predicate exactly, and `src/db/index-plans.test.ts`'s "DOES choose
`leagues_season_completed_idx`" proves an Index Only Scan over a 5,000-league corpus, not asserted
on faith. **The index earned its keep by measurement, flipping what had been the reviewer's own
prediction** that it would need dropping — recorded here because a future reader who finds an
unused-looking index should check for a consumer before assuming one was never coming.

## 3. The cutoffs, and the grandfathering that is structural rather than special

Founder decisions #7 and #8, as shipped: `veteranSeasonCutoff` is **3**, `verifiedSeasonCutoff` is
**1**.

**Why three, and not a state's own number.** Tennessee separates under-51 contests from 500-plus;
Mississippi marks 1,000-plus. Those numbers count CONTESTS — a single daily-fantasy entry — and
this product's unit is a season-long league, so borrowing either figure verbatim would misread the
unit, not just the threshold. Strategy §4.1 asks for one platform-wide default rather than a state
toggle (ruling 21 in the plan's own numbered list restates why: no state-conditional branching
exists anywhere near `participationTierFor`). Three finished seasons is a real fantasy history by
any reading, and it is config-driven for the reason the spec itself gives: this is the number most
likely to need tuning once the platform has a real history to tune against.

**Why one, for "verified."** A verified badge cannot be experienced enough to segregate and too
inexperienced to have played here — `verifiedSeasonCutoff` is necessarily at or below
`veteranSeasonCutoff`, and the docblock states the inequality as a fact a config test could check,
not a coincidence.

**Ordered by a test.** `src/integrity/config.test.ts` asserts `verifiedSeasonCutoff <=
veteranSeasonCutoff` alongside the four trade thresholds (§8) — one axis, one test, every inversion
named.

**The stamp/read window, and why it needs no lock.** The gate's count is a plain unlocked `SELECT`
(`completedSeasonsQuery`, `src/league-service/participation.ts`) run against a one-way stamp
(`stampSeasonCompleteInTx`) that a settling week writes under a `leagues` row lock. Those two can
interleave, and the interleaving is left alone deliberately rather than overlooked. Because
`seasonCompletedAt` is written once and never cleared, the count is monotonically non-decreasing,
so the error is ONE-DIRECTIONAL: a join can be admitted against a count that was true a moment ago
and is now one lower than reality (**admitting a stale newcomer is possible**), and no join can
ever be refused against a count that is too high (**refusing a stale veteran is impossible**). The
possible half is exactly the outcome the grandfathering rule below already accepts on purpose —
nobody seated is ever reclassified out — reached a few milliseconds early. The impossible half is
the one that would be unfair to a person, and it cannot happen. A lock here would buy nothing and
cost the join gate a write lock on the league row.

**Grandfathering is structural, not a special case.** Segregation is enforced at the JOIN and the
CREATION (§4), and nowhere else — never re-checked against an existing membership. Nobody already
seated in a league is ever reclassified out of it, because nothing ever asks the question again
once they are in. No league on this platform has completed a season yet at the time this plan
merges, which means every account is a `newcomer` today and no join is blocked today — that is the
mechanism being CORRECT and not yet firing, the identical property `INTEGRITY_CONFIG.trade
.autoHoldThreshold` had while it shipped `null` in Plan C.

## 4. The door, and the door the spec forgot

Step 6 blocks a `veteran` account from JOINING a `beginner`-declared public matchmade league. It
says nothing about CREATING one — and a creator never passes through `publicJoinPrecondition` at
all, because a creator is not joining anything; they are declaring it.

**The hole this leaves.** `leagues.experience_tier` is self-declared by whoever creates the league.
A veteran declaring their own public league `beginner` and waiting for it to fill is the exact harm
§4.1's segregation exists to prevent — a stranger playing among newcomers under a label they chose
for themselves — executed through the one door the join gate does not cover.

**One predicate, two doors, two sentences.** `src/league-service/enforcement.ts` is the single
module both doors ask:

```ts
tierJoinPrecondition(db, { isPublicMatchmade, experienceTier }, userId): Promise<boolean>
```

`publicJoinPrecondition` (`join.ts`) calls it from inside the join transaction; `createLeague`
(`creation.ts`) calls it before its own transaction opens, over the league the caller is ABOUT to
create rather than a row that exists yet. The predicate is asked once, exists once, and answers
once — but the REFUSAL COPY differs at each call site (`ENFORCEMENT_REFUSALS.join` /
`.create`), because being turned away from somebody else's league and being told to change one
field of your own league are different sentences about different situations, not one sentence with
a name swapped in.

**Why a self-declared label binds its own declarer.** A commissioner's `beginner` label is a
promise to whoever reads it on `/browse` — that the league is a reasonable place for a newcomer to
land. Enforcing that promise against the person who made it is not a stricter reading of the label;
it is what makes the label mean anything at all.

**This is wrong only if a league's self-declared tier should not bind its own declarer**, which
would make the label meaningless — a commissioner could then say "beginner" and mean nothing by it.

### The THIRD door, and why it is open on purpose

There are three ways into a league, not two, and the final review was right that this document
never said so. The third is the INVITE: `acceptInvite` (`src/league-service/invites.ts`) runs its
own `invitePrecondition` through `joinLeagueInTx`'s precondition hook, that precondition checks
expiry and use count, and it never calls `tierJoinPrecondition`. A veteran handed an invite code
joins a `beginner` league whatever its visibility. `createInvite` never reads
`is_public_matchmade`, so this covers a PUBLIC matchmade beginner league exactly as much as a
private one.

**That is deliberate, and Task 3's review adjudicated it in those terms:**

> the code's stated rationale ("invited by hand") is about the mechanism (an invite is always a
> human handing a specific code to a specific person), not the league's own visibility flag, so
> this is consistent rather than a gap the rationale doesn't cover.

The rationale itself lives at `src/league-service/enforcement.ts`: this platform never polices what
a commissioner does inside a group they invited by hand. Segregation exists so a STRANGER browsing
`/browse` does not land among newcomers under a label chosen for them; an invite is the opposite
situation in every respect, because somebody who already knows this person chose to hand them a
code. A tier gate on the invite door would mean a commissioner could not invite their own friend
into their own league, which is not a rule this product wants at any visibility setting.

`src/league-service/join.test.ts` pins it in both directions over one league and one account: the
public join door refuses with `ENFORCEMENT_REFUSALS.join`, and the invite door admits. Before the
final review the only invite-path tier test used a private league, so the public combination was
untested in both directions and a later narrowing of the exemption would have gone unnoticed.

**The residual, recorded rather than adjudicated.** A newcomer creates a public beginner league;
`/browse` honestly labels it as all newcomers; other newcomers join on that label; the commissioner
then seats veterans through invite codes. The label stays truthful after the fact — the composition
category is computed from who is actually in the league — but the people who joined on it never
agreed to that. Closing it would mean either gating the invite door by tier (taking a
commissioner's own invitations away from them) or hiding a league from `/browse` once it is
invite-stuffed. Both are product decisions with owners other than this document.

## 5. The fourth deny-by-default dimension

`SYSTEM_ACTION_VISIBILITY` (`src/integrity/system-actions.ts`) — `"everyone" | "subject_only" |
"hidden"`, exhaustive over `SystemActionCode` — is the fourth deny-by-default dimension this
codebase has (after `ACTIVITY_VISIBILITY`'s TYPE gate, each payload renderer's FIELD gate, and the
third, `SYSTEM_ACTION_SUMMARY_ALLOWED`). It SUBSUMES the third rather than sitting beside it:
`systemActionSummaryAllowed(code)` is now `SYSTEM_ACTION_VISIBILITY[code] === "everyone"`, derived,
never a second table two writers could let disagree — the same collapse Plan C performed on
`CONTENT_REMOVAL_WIRED_FOR` for the identical reason.

**The one word Plan B's pre-decided answer got wrong.** `docs/decisions/operators-and-moderation.md`
§9 told this plan, correctly, that it needed a new VISIBILITY rather than a new summary boolean —
and told it, incorrectly, that the shape should be `actor_only`, the same one `lineup_change`
already uses. It cannot be: a `system_action` event carries `actorType: "system"` and therefore
`actorId: null` by construction, and `ACTIVITY_VISIBILITY`'s own `actor_only` branch compares
`event.actorId` to the viewer — `null` can never equal a viewer's own id. `actor_only` cannot mean
anything for an event whose actor is the platform. The path that means something for an actorless
event is the SUBJECT — the member the action was taken ABOUT, carried on `payload.subjectUserId`
and checked by `activityRowFor` (`src/integrity/activity-view.ts`) before `summary` is ever read. A
payload with no `subjectUserId` renders nothing, because deny-by-default has to survive a malformed
payload as well as a missing decision.

**The five entries, and why each is what it is:**

| Code | Visibility | Why |
|---|---|---|
| `stat_week_corrected` | `everyone` | A fact about the league's shared scoreboard, true for everyone in it, about nobody's conduct. |
| `chain_verification_failed` | `hidden` | Restates Plan A ruling 8: telling a league its record may have been tampered with, before a human has read the output, is the accusation this phase spends a denylist preventing. |
| `lineup_auto_set` | `subject_only` | The identical competitive-sensitivity argument that makes a MANUAL `lineup_change` `actor_only` (Plan A ruling 15) — broadcasting one manager's missed deadline to the whole league while every manual change stays private would be worse than either. |
| `trade_held_for_review` | `hidden` | STRUCTURAL, not provisional: the hold's `system_action` is written on the PLATFORM chain (§7), and a platform-chain event is never read by `listLeagueActivity` at all. The denial stopped being a decision anybody has to keep making. |
| `tier_blocked_join` | `hidden` | The identical platform-chain reason. Nobody in a league needs to know a stranger was turned away at the door. |
| `draft_auto_started` | `everyone` | `stat_week_corrected`'s reasoning exactly — a fact about the league's shared calendar, true for everyone in it, about nobody's conduct. |

## 6. The auto-set, and why it is a materialization

`getLineup` already falls back to `defaultLineup` (deriving a lineup from the roster) when a
manager never saved one — an unset lineup has always been legal. But the fallback is PER WEEK and
has no memory: a manager who set week 1 carefully and forgot week 2 fields the raw roster order in
week 2, silently, with no record that anything was ever unset.

`MISSED_DEADLINE_LINEUP_STRATEGY` (`repeat_previous_week`, `src/league-service/auto-lineup.ts`)
carries a manager's own last saved choice forward at the lock, dropping anyone no longer owned and
refilling from the bench exactly as a manual edit would. Where there is no previous choice (a
league's very first week), it writes EXACTLY what the fallback would have derived a moment later —
which is the point: freezing a fact the fallback already implied, never making a decision on the
manager's behalf. That "materialize, don't decide" property is the same one Plan C's locked-week
lineup freeze (`materializeLockedLineupsInTx`, invoked ahead of a trade's own roster move) already
established for a different trigger.

**Why the strategy enum ships with one arm.** The spec names a second strategy,
`best_legal_lineup` — a better lineup, worse consent: the platform choosing the OPTIMAL lineup
rather than repeating the manager's own last choice. `MISSED_DEADLINE_LINEUP_STRATEGIES` is a
one-value tuple (`["repeat_previous_week"]`), not a two-value one with the second unimplemented,
because an enum value with no implementation is the exact "control wired to nothing" shape founder
decision #5 already refused once, for `ACCOUNT_RESTRICTED` (§11). Predictability beats optimality
when the platform is acting without the manager's consent — a manager who forgot to set a lineup
can check what THEY chose last week; nobody can check what the platform decided was optimal without
re-deriving the whole computation themselves. `plannedAutoLineup`'s own `switch` is exhaustive over
the derived union, so adding `best_legal_lineup` later is a compile error everywhere it is
unhandled, never a silent default.

## 7. The hold, and the hole it does not have

**The seam, filled.** Plan C shipped `evaluateTradeBeforeExecute`'s `hold` field and
`INTEGRITY_CONFIG.trade.autoHoldThreshold` as `null` — no trade ever held, a code path with no
number behind it. Task 5 is that number: **35**. `acceptTrade` branches on
`fairness.hold && enforcementAppliesTo({ isPublicMatchmade })` — `enforcementAppliesTo` is the
IDENTICAL predicate the join and creation gates read, so a private league's trade is never held,
however lopsided, because the platform is never that league's commissioner.

**The platform-scoped transaction, and why the hold has no after-commit hole.** Plan C's own
fairness flag (`trade_fairness`) HAS a hole: `trade_accepted` is league-scoped and `flag_raised` is
platform-scoped, Plan A's ruling 3 permits a transaction to append to at most ONE chain, so the flag
has to be raised in a SEPARATE transaction after the accept commits — and the honest consequence is
a trade that can end up unflagged if the process dies between the two, remedied by an operator
sweep (`npm run trades:sweep`).

A hold is the mirror image. Nothing happens in the league — no roster moves, `applyTradeInTx` is
never called — so there is nothing to write to the league chain at all, and no second scope to
cross. The row's status stamp (`open` → `held`) and the `trade_hold` flag's raise both happen in
`acceptTrade`'s OWN transaction, on the platform chain, because a trade that stopped short of
happening was never league news in the first place. **The one-chain rule that COST Plan C a hole
PAYS Plan D a guarantee** — worth stating rather than leaving as a coincidence a reader has to
notice twice.

**The two exits, with the table cell that made them necessary.** `held` joins `TRADE_STATUSES` as a
genuine seventh status rather than reusing three that already mean something else — Plan C refused
a seventh status for its own trade REVERSAL, because a reversed trade still means `accepted` and
the chain says so; a held trade means neither `open` nor `accepted`, and no roster moved, so the row
needs a state it did not have. `resolveFlag`'s two new decisions, `trade_released` (execute the
trade, re-validated against CURRENT rosters — they may have moved while it sat held) and
`trade_blocked` (never execute; both rosters stay exactly as they were), are the only two cells
`DECISION_WIRED_FOR` marks `true` for the `held_trade` subject. Reusing `no_action` for release or
`trade_reversed` for block was rejected on this codebase's own precedent: `no_action` is documented
as noticing nobody BECAUSE NOTHING HAPPENED, and making it move two rosters would put a lie in a
table this codebase reads as documentation; `trade_reversed` describes undoing something that
OCCURRED, the exact false-word class Plan C's ruling 23 already refused when it made `superseded`
its own status rather than calling it `rejected`.

**Release order: the trade executes first, the flag resolves second (ruling 13).** A release runs
the REAL accept machinery in the league's own transaction — week re-derived at release time,
materialization, transfer, supersede sweep, notices, the league-chain audit — and only after that
commits does `resolveFlag`'s platform-chain transaction stamp the flag resolved
(`src/integrity-service/flags.ts:590-604`, whose comment states it — the release transaction is
committed before `resolveFlag`'s own ever opens — driving `releaseHeldTradeInTx`,
`src/league-service/trades.ts:1483`). Note that the OTHER exit does not have this shape and is not
a counterexample to it: `blockHeldTradeInTx` runs INSIDE `resolveFlag`'s own transaction, because a
block moves no rosters and so has no league-chain work to commit first. The order is the
same asymmetric-failure shape the trade REVERSAL established: if the execution succeeds and the
resolution then fails, the trade is genuinely done and the retry path heals the still-open flag
(the reversal's own three-state provenance precedent); the inverse order would record a decision as
resolved while the rosters it promised never moved, which is the lie the whole queue exists to
prevent.

## 8. What a held trade is and is not

A held trade is a QUESTION raised before a trade happens, not a judgment about the two people in
it — which is why the threshold sits where it does on the same points-per-week axis every other
trade threshold lives on:

| Threshold | Value | What crossing it means |
|---|---|---|
| `evenDelta` | 3 | Below this, the advisor's own verdict calls a trade even. |
| `lopsidedDelta` | 12 | Above this, the advisor tells a MEMBER, to their face, that a trade is lopsided. |
| `fairnessFlagThreshold` | 20 | At this, a COMPLETED trade raises a question for an OPERATOR — a flag costs them ten seconds and costs the members nothing. |
| `autoHoldThreshold` | **35** | At this, the platform stops a trade two adults already agreed to — a hold costs two members their agreement and their time. |

The gap between 20 and 35 — nearly double — is the whole content of the number, not an arbitrary
margin: 35 is roughly "one side gave back nothing that starts," the only shape of trade worth
freezing before it happens rather than merely asking a question about it after. `src/integrity/
config.test.ts` orders all four on one axis, and every inversion is named: `even > lopsided` makes
a verdict unreachable; `lopsided > fairnessFlagThreshold` fills the operator queue with trades the
advisor itself calls fine; `fairnessFlagThreshold > autoHoldThreshold` would hold trades nobody ever
flagged — a trade frozen before anyone asked a question about it at all.

**The known false positives, named rather than pretended away.** A rebuilding manager selling
future assets for picks. A genuine salary-dump-shaped trade with no cap in this game but the same
lopsided SHAPE. Two friends who trust each other trading unevenly on purpose. All three cross 35 on
a pure points-per-week read, and all three are EXPECTED to reach an operator — the hold does not
claim to distinguish collusion from an ordinary, if unusual, agreement between two people who
understand what they are doing. That is exactly why the resolution is usually `trade_released`: an
operator's job is to look once, not to presume guilt from a number.

**Who may learn a hold exists, enumerated.** The two managers in the trade, and operators. Not the
commissioner, and not the league. `holdTradeInTx` writes the trade's own `leagueId` onto the
`trade_hold` flag row, and that is provenance rather than an audience: the audit event goes on the
PLATFORM chain, `ACTIVITY_VISIBILITY` never surfaces it, and Task 5's fix round took the hold off
the league-facing trade wire entirely.

The final review (F5) found the one place that enumeration had a hole. `leagueModerationSummary`'s
`openQuestions` counted every unresolved flag scoped to the league with no flag-type filter, so
every auto-hold between any two managers incremented a third party's counter. That count was
sanctioned by Task 8's own brief, correctly, at a time when every flag type in the queue was about
league CONTENT: a removed message, a reported review, a multi-account pair inside this league, a
completed trade the league can already see in its own activity feed. `trade_hold` is the first flag
type that is league-scoped without being league news. **`openQuestions` now counts the four content
types and excludes `trade_hold`**, read from `FLAG_IS_LEAGUE_QUESTION` (`@/integrity/flags`) so the
next flag type has to decide at declaration rather than default into a commissioner's counter. A
count and not a list capped the harm; it did not make the existence of a hold something the
commissioner is entitled to.

## 9. The clock, and the two schedulers

**A commissioner-chosen kickoff.** `drafts.kickoff_at` has existed since Phase 1, computed but
never chosen, never shown, never compared to the clock by anything — Phase 2's persona panel filed
the consequence as a product gap. `setDraftKickoff` (`src/league-service/draft-schedule.ts`) makes
it a real control: a commissioner may move it while the draft is still `scheduled`, bounded by
`LEAGUE_CONFIG.defaults.maxDraftDaysAhead` (60 days) so the clock can never sit at its widest tier
for months. `PublicLeagueSummary` gains `draftAt` as its tenth field — a scheduling fact about the
LEAGUE, not about any person in it, and a visitor who cannot see it cannot tell whether they are
free to attend the one synchronous event this product has.

**The schedule route answers 404, never 403, to a member who is not the commissioner.** The fourth
application of this codebase's non-oracle discipline: `publicJoinPrecondition` answers 404 for a
non-public league, `withAdmin` answers 404 for a signed-in non-operator, Plan C's trade routes
answer 404 for a manager not party to the trade, and this route answers 404 to a member who does
not run the league. A 403 would confirm which member holds the commissioner's chair to anybody who
can reach the league — small, and exactly the kind of small thing that is free to get right and
awkward to fix later.

**A third writer of `kickoff_at` (Phase 3.5, Task 7).** `fireWhenFullInTx`
(`src/league-service/fill-trigger.ts`) joins `setDraftKickoff` (a commissioner's own choice) and
`startDraft` (which stamps it implicitly the instant a draft actually starts, auto or not) as the
third place `drafts.kickoff_at` is written. It writes ONLY when a public matchmade league's
`start_trigger` is `'when_full'` and its last seat has just filled, moving the column to
`now + MATCHMAKING_CONFIG.sitAndGo.graceSeconds` — never earlier than that grace period, and never
on a league whose kickoff a human already set by hand. It does not call `startDraft`: the value it
writes is picked up by the same `autoStartDueDrafts` scan `kickoff_at`'s second writer already
drives, so a sit-and-go draft starts through the identical guarded status transition a
commissioner-scheduled one does — see `docs/decisions/formats-and-lobby.md` §6 for the full
argument against a fourth start path.

**A platform that presses start when nobody trustworthy is there to.** `autoStartDueDrafts`
(`src/draft-service/auto-start.ts`) starts a public matchmade league's overdue draft through the
IDENTICAL path a commissioner's own button calls — `store.startDraft`, one implementation for both
callers. Why the claim is a guarded status transition and never a lock: PgBouncer transaction
pooling forbids `pg_advisory_lock` (`docs/decisions/data-layer-hardening.md`), so leader election
among app instances is unavailable by construction, and the ticker's non-overlap guard is per
PROCESS, not cluster-wide. Exclusion comes from the WRITE instead — `UPDATE drafts SET status =
'in_progress' WHERE status = 'scheduled' RETURNING id`, the same shape the draft nudger's own
`draft_nudges` claim row already uses (`onConflictDoNothing().returning()`, an empty return meaning
somebody else got there first). The claim, the `START_DRAFT` action append and the announcement all
FUSE into `startDraft`'s own transaction (`startDraft`'s `alsoInTransaction` hook, auto-only), so
there is no crash window where a draft is started with no audit trail — see the ledger note below.

**The audit-chain walk is a DIFFERENT scheduler, and it is Phase 2 Plan D's, not this ticker's.**
Two schedulers in this codebase are both named "Plan D," which is why `INTEGRITY_CONFIG.verification`
and `scripts/verify-audit-chain.ts` both spell "Phase 2 Plan D" out in full rather than trusting the
bare name. `fullVerifyIntervalHours` (24) is the number a PRODUCTION scheduler is configured with —
it does not exist yet, and this plan does not build it. The interim control is the operator runbook
line in the script's own docblock. Plan A's documented floor — first-verification-per-chain, because
an unverified chain's tail deletion plus anchor rewind is undetectable — is about COVERAGE, not
CADENCE, and this plan owes only the coverage half: `npm run audit:verify -- --full` in Task 11's
own closing battery is where every chain THIS plan's seed and e2e create gets its first
verification. A claim row would fix cross-instance duplication and leave an integrity job depending
on a dev worker's liveness — worse than the runbook it would replace, which is why this plan
deliberately does not adopt the walk onto the ticker it already has.

**The due-kickoff scan's index, decided by measurement (migration 0029).** The ticker's every-tick
`drafts ⋈ leagues` scan initially rode the single-column `drafts_status_idx`, and the plan
assertion this plan requires of every hot query measured what that actually meant on a realistic
corpus: the index narrowed to `scheduled` and then fetched-and-discarded the 91% of those rows
whose kickoff was not yet due, every tick, uncapped (the `ORDER BY` sorts before the `LIMIT` can
save anything). Migration `0029_draft_due_scan_index.sql` widens the index to
`(status, kickoff_at)` — the measured plan is one Index Cond with zero discards, and the ticker's
other reader (`status = 'in_progress'`, equality on the leading column) measures unchanged. Same
rule as migration 0028's index in §2, opposite direction: there the measurement KEPT an index a
prediction would have dropped; here it RESHAPED one a prediction had blessed.

**Both readers, not one (final review F16).** This paragraph and `schema.ts`'s own index comment
said "measures unchanged" and "TWO READERS, MEASURED" while only the due-kickoff half had an
EXPLAIN assertion behind it. Against this branch's own standard that is an overclaim with two
possible answers, and the cheaper one is also the honest one: the expiry scan is now exported as
`liveDraftsQuery` (`@/draft-service/ticker`) and measured directly, asserting that its Index Cond
names `status` and does NOT name `kickoff_at` — the second column takes no part, which is exactly
the claim the migration comment argued.

**The auto-set's scan, measured for the first time (final review F8).** The sibling automation's
larger scan shipped with no measurement at all while this one got a migration. It is now
`leaguesNeedingAutoSetQuery` (`@/league-service/auto-lineup`), level-derived and bounded at
`AUTO_SET_CONFIG.maxLeaguesPerRun`, and the measurement over the same 5,000-league corpus decided
NO new index: every one of its four relations is reached by index, two of them index-only, and
because the `ORDER BY` comes from an index walk rather than a Sort the `LIMIT` genuinely
short-circuits — the property the due-kickoff scan lacked before 0029. A bound was the fix here;
an index would be a write cost paid for a plan that is already index-only.

## 10. The rollback switches, and why neither is a database column

The spec asks for "a per-league feature flag" for the trade auto-hold and "a flag" for tier
segregation. A boolean column on `leagues` with no UI, no script and no caller able to set it would
be the control wired to nothing this phase has now refused several times over (§6's undeclared
`best_legal_lineup`, this plan's `ACCOUNT_RESTRICTED` precedent, Plan B's `trade_reversed` refusal,
Plan C's untouched `SYSTEM_ACTION_SUMMARY_ALLOWED`).

**What shipped is narrower than the plan's own opening ruling described, and that is worth being
honest about.** Ruling 17 (the plan's own pre-code numbered ruling) named the platform axis as TWO
things — `INTEGRITY_CONFIG.enforcement.enabled` and `INTEGRITY_CONFIG.participation
.enforceTierSegregation`. No `enforcement.enabled` field was ever written; it never existed in any
commit. What shipped is ONE field doing the whole job:
`INTEGRITY_CONFIG.participation.enforceTierSegregation`, read by `enforcementAppliesTo` and asked
by every one of the four automated actions in this plan — not only tier segregation, despite its
name living under `participation`. `docs/enforcement.md`'s own "Rollback switches" table names this
plainly rather than repeating a two-field description the code does not have.

**The two switches that DID ship, both tested in both states:**

- `leagues.is_public_matchmade` — per-league, pre-existing since Phase 1, exactly the axis the
  spec's own matched-pair test already turns on. Set `false` and the platform was never that
  league's commissioner in the first place.
- `INTEGRITY_CONFIG.participation.enforceTierSegregation` — platform-wide, settable at deploy with
  no business-logic change, in the identical shape `autoHoldThreshold: null` shipped in during Plan
  C. Set `false` and every one of the four automated actions stops, everywhere, at once — "tier
  computed but inert," the spec's own words for exactly this switch.

**This is wrong only if the spec's two-field description should be read as a binding interface**
rather than a sketch of an axis to cover — and a single field that answers the identical question
for every automated action, rather than a field per action that could disagree with the others, is
the stronger property, not a shortfall.

## 11. Threat model additions

What automated enforcement adds to Plans A, B and C's threat model: the platform now writes
rosters, starts drafts and refuses joins on its own. A bug in this plan is a bug that ACTS, not
merely a bug that misreports.

**What bounds it:**

- Every action is chain-recorded with `actorType: "system"` — nothing this plan does is invisible
  to the audit spine that already exists to catch a platform bug.
- Every action is reversible or refusable by a human: a blocked join can be answered by browsing
  elsewhere; an auto-set lineup can be edited by hand any week before its own kickoff; a held trade
  has two operator-chosen exits; an auto-started draft is the SAME draft a commissioner would have
  started, just started for them.
- No action touches an account. The strongest thing anything in this plan can do to a person is
  refuse them a seat, hold a trade, or set a lineup they left unset.
- Both rollback switches (§10) turn all of it off without a deploy of business logic.

**What this plan does NOT add:** no new privilege (nothing here grants an operator or the platform
a capability that did not already exist in Plans A–C's own vocabulary — `SYSTEM_ACTION_CODES` grows,
`AUDIT_EVENT_TYPES` does not, per ruling 7), no new account action, and no path from any threshold
in this document to a consequence a person cannot see — every notice this plan sends states what
happened, in the active voice, with no accusatory language, checked by `copyViolations` the same way
every other member-facing sentence in this codebase is.

**What would move this boundary:** the same things Plan A's own §9 already names for the audit
spine generally — a periodically published transparency report, or a state actually adding a
second automated consequence beyond "refuse, hold, or materialize." Neither exists in this plan or
is planned for one after it (ruling 20: no new realtime event type; the `plan-d` arm of
`reserved.test.ts`'s `OWNER` stays unused because there is no plan after this one).
