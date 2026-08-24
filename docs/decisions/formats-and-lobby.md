# Formats and the Lobby — Phase 3.5

A new document rather than more sections on `docs/decisions/enforcement-and-tiers.md` — that
document is about who may join and who is watched; this one is about what a league IS (its
formats and toggles) and how a lobby fills. Read this with `docs/league.md`, `docs/draft-engine.md`
and `docs/draft-moderator.md`, which this document corrects and points back to rather than
restates. Each section records what was chosen, why, and what would have to change for the choice
to be wrong — written to the code that shipped, not to the plan that proposed it
(`docs/superpowers/plans/2026-08-22-phase3p5-competitiveness.md`).

## 1. Toggles, not queues — and what that excluded

Every new format this phase ships — superflex, the median game, the overnight pause,
skip-and-return, draft-slot preferences, the sit-and-go fill trigger — surfaces as a **badge or a
term** on one canonical public league family, never as a `BrowseFilter` axis a visitor can narrow
on. `BrowseFilter` (`src/matchmaking/contract.ts`) still carries exactly the two axes it had before
this phase — `format` and `experienceTier`, plus the cosmetic `stakeTier` — and `normalizeBrowseFilter`
was not touched to add a third. `PublicLeagueSummary` grew two new fields, `medianGame` and
`startTrigger`, and both render as a badge/sentence on the card (`public-league-list.tsx`), never
as a filter control.

The reasoning is liquidity, not taste: an open seat that a filter hides from somebody who would
have taken it is a seat that sits empty longer. Fragmenting the launch pool across format axes
strands seats the same way fragmenting it across ten leagues would. The two axes that already
existed — `experienceTier` and `stakeTier` — stay, because they exist to keep people apart on
purpose (a beginner pod, a stakes preference), which is a different kind of axis than "I only want
to see superflex."

**What this excluded, by name.** Mock drafts (a public lobby full of drafters nobody occupies) are
out for a schema reason, not a scope reason: `teams.user_id` is a `NOT NULL` foreign key to a real
user, so a mock seat needs a first-class non-human participant this codebase has nowhere to put —
ledgered to Phase 6. Two-layer prizes and real stake tiers stay cosmetic pending Phase 4's
payout-structure domain. Best ball and guillotine are post-launch fast follows that would fragment
the pool this phase concentrates. Third-round reversal and linear draft order are real formats in
the competitive taxonomy that nobody in the underlying research asked to browse by. Dynasty and
keeper depth need multi-season trust this platform has not earned yet (Phase 9). None of these are
difficulty rulings — they are scope rulings, and this document records the schema or product fact
that would have to change first for each one.

**This is wrong only if** a manager would rather see zero leagues than a league carrying a toggle
they did not personally pick — which the liquidity doctrine itself already rules out as the exact
failure to avoid.

## 2. The median's storage split

A median game is a per-league toggle (`leagues.median_game`, boolean, default `false`) and a
per-league-week fact (`weeks.median_score`, nullable `real`) — two different tables for two
different questions, and neither is `scoring_settings` or a new `median_results` table.

`scoring_settings` is fifteen flat weight columns, and `describeScoring` derives a browse label
from precisely those weights. A boolean living in that table would make the label function either
silently wrong (a median toggle it never reads) or newly aware of a column that isn't a scoring
weight at all — neither is acceptable for a function whose whole contract is "derive the label from
the weights, and only the weights."

`weeks` has carried nothing but its own primary key since Phase 1, and "one median per league week"
is exactly that table's cardinality — no join, no new foreign key, no new row shape. A dedicated
`median_results` table (one row per team per week) was considered and rejected: it would store N
numbers to encode a fact that the N scores already stored in `matchups` imply on their own, and
computing the comparison (`leagueMedian`, `src/league/median.ts`) is cheaper than persisting and
maintaining the row that would replace it.

**The record itself never touches `pointsFor`/`pointsAgainst`.** `applyMedianResult`
(`src/league/standings.ts`) folds a team's own result against the week's median into
`wins`/`losses`/`ties` only — the same columns a head-to-head matchup fills — and leaves the points
columns alone. Folding the median into `pointsAgainst` would describe an opponent that does not
exist; folding a team's own score in twice would double the points-for column outright. The
columns say what actually happened, and the tiebreaker (points for) still compares real schedules.

**No pseudo-matchup row exists for the median, on the schema's own terms.**
`matchups.home_team_id`/`away_team_id` are `NOT NULL` foreign keys to `teams.id`, and the primary
key is `(league_id, week_number, home_team_id)` — a median row would need a sentinel team and a
relaxed key. It would also break three things that read `matchups` as a season:
`stampSeasonCompleteInTx`'s `NOT EXISTS(unscored matchup)` check would never be satisfied by a row
nothing scores, `seasonProgress.playedWeeks` would count it as an extra week, and `computeStandings`
would double every points column trying to fold it in. One nullable number on `weeks` breaks none
of these.

**This is wrong only if** two teams with identical records must be separated by their median
opponents specifically — a tiebreaker no format in the competitive field actually runs.

## 3. The pause: command-time-only, and its two DST answers

The overnight pause (`DRAFT_PAUSE_WINDOW`, `src/draft-engine/config.ts` — 2 AM to 5 AM Eastern,
applying only at the hour-or-longer clock tiers) is read in exactly two places: `selectors.ts`,
where a deadline is *computed* (`currentDeadline`, `nudgeDeadline`, `pausedUntilFor`, `isPaused`),
and nowhere inside `reduce.ts`, `snake.ts`, `auction.ts` or `apply-pick.ts`. A source-level test
(`flag-only.test.ts`-style) asserts the reducer files never import `pause.ts` or reference
`pauseWindow`, so the boundary is proven, not just documented in a comment somebody could let
drift.

The reasoning is replay determinism, and the codebase has already paid for getting this wrong
once: raising the clock schedule's floor from 60s to 90s turned every already-persisted
`TIMER_EXPIRE` into a permanent 500 on replay, because the old code re-judged history against
today's constant. `DRAFT_PAUSE_WINDOW` is a tunable exactly like that floor was — if the reducer
read it, a deploy that moved the window would silently rewrite what an already-accepted
`TIMER_EXPIRE` did the next time the log replayed. Reading it only at command/view time means a
deploy that shifts the window changes what the product does *next* and can never change what it
already did.

This is the deliberate asymmetry with Task 5's skip policy (`DraftSkipPolicy`), which **is**
snapshotted onto `START_DRAFT`. The difference is *who reads it*: `skipEligible` is a REDUCER guard
— it decides who gets skipped, and that decision is replayed — so it has to travel in the action
log the same way `minBid` already does. The pause window is read only by selectors outside the
reducer, so it may live in `DraftConfig` and be re-attached fresh by `loadDraftConfig` on every
load. Two clock-shaped tunables, two different homes, one rule (does the reducer read it?)
deciding both.

**The two DST answers.** `zonedHourToUtcMs` (`src/draft-engine/pause.ts`) resolves a local
wall-clock hour to a UTC instant with the standard two-pass correction: guess the local hour as if
it were UTC, correct once by the offset at that guess, correct once more by the offset at the
corrected instant.
- **Fall back** (the repeated hour, e.g. 2 AM ET on the first Sunday of November): the second pass
  converges past the repeat, landing on the instant local clocks read after the repeat resolves.
- **Spring forward** (the hour that never happens, e.g. 2 AM ET in March): the two offsets never
  agree no matter how many more passes run, which is the signature of a genuine gap — the function
  returns the FIRST correction, the instant local clocks actually read the moment they spring
  forward, the same skip-the-gap convention every timezone library uses.

**This is wrong only if** a draft needs a pause window that crosses local midnight — `pausedUntil`
assumes `window.startHour < window.endHour`, true of `DRAFT_PAUSE_WINDOW` and every window this
module has ever been asked to compute against.

## 4. The skip's consent test, and the owed-pick invariant

Punitive instant-autopick — the clock choosing for a stalled manager the moment it expires — was
the single most-complained-about draft-room behavior on legacy hosts. `skipEligible`
(`src/draft-engine/snake.ts`) replaces it with a decision that turns on **consent**, evaluated in
this order:

| Has a queue? | Tier's pick length | Under the owed allowance? | Result |
|---|---|---|---|
| Yes | (any) | (n/a) | Autopick — the queue is that team's own instruction. |
| No | Fast (below `appliesAtOrAbovePickSeconds`) | (n/a) | Autopick — a live room can't hold a hole. |
| No | Slow | Yes | **Skip.** The pick is owed, not made. |
| No | Slow | No (already at `maxOwedPerTeam`) | Autopick — one owed pick is the whole allowance. |

A team with a usable queue is autopicked exactly as before this phase, because honoring
`bestAvailableFor`'s own instruction is not a punishment. A team with no queue in a slow tier is
skipped, because instant autopick there is the exact behavior the complaint data names. A team
with no queue in a fast tier is autopicked, because a live room near kickoff cannot hold a hole for
anybody.

**The owed-pick invariant.** A skipped pick is never forgiven — `owedPicks[teamId]` holds the pick
numbers FIFO, redeemable at any time (mid-draft, on somebody else's turn, or on the catch-up
clock), and `advanceSnake` refuses to complete the draft past the last normal pick while
`hasOwedPicks(state)` is true. The alternative (forgiving the pick outright) would leave one roster
a player short, and every downstream consumer — `commitDraftResults`, `defaultLineup`,
`validateLineup`, the lineup editor, the standings — assumes every team filled the same slots. A
draft that could end with an unequal roster count is a worse product failure than the timeout this
mechanism exists to fix. The CATCH-UP phase that opens once the normal schedule runs out
**never skips again** (`reduceCatchUpExpiry` always autopicks via `bestAvailableFor` +
`redeemOwedPick`), which is what forces the draft to terminate even if nobody ever redeems by hand.

**One owed pick per team, config, tested both sides.** `DRAFT_SKIP_POLICY.maxOwedPerTeam` is 1 —
Underdog's own ceiling. An unbounded allowance is an abandoned seat with extra steps (eleven
managers waiting out a draft for somebody who left); one is enough to cover a person who missed a
turn and too few to cover a person who is gone.

**Auction is deliberately excluded.** `reduceAuctionExpiry` never reads `owedPicks` or
`skipPolicy` — a stalled nominator always auto-nominates at the minimum bid, exactly as before this
phase, because while a lot is open the clock belongs to everybody and a skipped nomination would
freeze eleven people who are ready to bid. The auction's own forgiving behavior is the bid window,
which already restarts on every bid.

**The snapshot.** `DRAFT_SKIP_POLICY` rides `START_DRAFT.skipPolicy` into `state.config.skipPolicy`
— see §3 above for why this and the pause window are deliberately NOT symmetric.

**This is wrong only if** a manager who sets no queue means "pick for me" — an interpretation the
underlying complaint data contradicts.

## 5. The KDS snapshot argument (draft-slot preferences)

A draft-slot preference (the "Kentucky Derby System" ranking of which draft position a manager
wants) is a **table**, `draft_slot_preferences` — written and read by `setSlotPreference` and
`slotPreferencesFor` (`src/draft-service/slot-preference.ts`) — never a `SET_QUEUE`-style action in
the replayed log.

The distinction is *when* the value is consulted. `SET_QUEUE` is an action because a queue is
consulted **during** the draft, at an arbitrary pick, so replay has to know what the queue was AT
that moment — a queue edited at pick 9 must not retroactively change what autopick did at pick 7.
A slot preference is consulted exactly **once**, at `START_DRAFT`, before any other action exists:
`assignDraftSlots` (`src/draft-service/order.ts`) runs the Kentucky Derby draw over the drawn team
order and every team's saved ranking, and its only consequence is the resulting permutation, which
is snapshotted into `START_DRAFT.draftOrder` — the same field that already snapshots the shuffled
draw itself (`drawSequenceFor`). That is precisely the shape of the player pool, which is also read
from Postgres once and snapshotted, and nobody has ever wanted the pool in the log twice either.

**The consequence worth stating out loud:** a manager who edits their ranking after the draw has
run changes nothing. `setSlotPreference` refuses to write once `drafts.status` is no longer
`'scheduled'` (`SLOT_PREFERENCE_REFUSALS.alreadyStarted`), and the panel says so rather than
silently accepting a write that would do nothing.

**This is wrong only if** a slot preference needed to be re-consulted after the draw — which would
mean the draw itself is not actually a draw.

## 6. The fill trigger: a time, not a button

`fireWhenFullInTx` (`src/league-service/fill-trigger.ts`) writes exactly one thing when a
sit-and-go league's last seat fills: `drafts.kickoff_at`, moved to
`now + MATCHMAKING_CONFIG.sitAndGo.graceSeconds`. It does not start the draft, does not call
`store.startDraft`, and adds no third door into that function.

Two doors already start drafts — a commissioner's press (`POST /api/drafts/[draftId]/start`) and
`autoStartDueDrafts` — and both funnel through `store.startDraft`'s guarded status transition,
which is the only cross-instance-safe start this product has (PgBouncer's transaction pooling mode
forbids advisory locks, so no leader election exists to arbitrate a race between instances). A
third door for the fill trigger would need its own idempotency proof and would be the next thing
to get wrong the moment `startDraft` changed. Writing a time instead reuses the machinery that
already exists: the same in-process ticker that scans `drafts` for a passed `kickoff_at`
(`dueDraftsQuery`, `autoStartDueDrafts`) picks it up and starts it through the identical,
already-proven-idempotent path a commissioner-scheduled draft uses. `fireWhenFullInTx` runs inside
`joinLeagueInTx`'s own transaction, which already holds `leagues FOR UPDATE` before it ever inserts
a team — writing the kickoff time inside that same lock reuses the exact exclusion that makes seat
counting correct, rather than acquiring a second lock to protect a second write.

**Public-matchmade only, and not by widening the auto-start query.** Sit-and-go is scoped to the
public lobby, where the fill population is deepest; `createLeagueSchema` refuses
`startTrigger: "when_full"` on anything but `visibility: "public"` outright, with a message naming
the remedy. `fireWhenFullInTx` itself never reads `isPublicMatchmade` — it reads
`drafts.start_trigger` instead, which the schema refusal above already guarantees can never be
`'when_full'` on a private league. Asking the same question from two different data sources is how
the two answers eventually disagree; asking it once, at the write boundary, is how they can't.

**This is wrong only if** a private commissioner would rather the platform started their draft than
press the button they already have — a preference no research behind this phase evidences.

## 7. The house shelf (Phase 3.5 addendum, Task 14)

The fill trigger above is one mechanism a member-created sit-and-go league can opt into.
`docs/decisions/house-leagues.md` covers the addendum in full — the nullable-commissioner schema,
the reconciler that keeps a catalog of platform-run leagues stocked, and the two commissioner doors
a house league closes — but the shelf itself is the lobby surface this document already owns, so it
gets a section here rather than only there.

`listPublicLeagues` (`src/league-service/browse.ts`) now returns `{ leagues, house }`: `house` is a
second query (`houseShelfQuery`), not a sort key folded into the first, because the member list and
the house shelf answer different questions (`isNull(leagues.houseRung)` vs. `isNotNull`) and the
shelf's own ordering rule differs from the member list's. `HouseLeagueShelf`
(`public-league-list.tsx`) renders it above both the filters and the member list — "the house lobby
is the front door," per the founder's own ruling, restated by this addendum's Task 14 step 2 and
kept un-filterable on the identical §1 reasoning above: `houseShelfQuery` takes no `BrowseFilter`
parameter at all, so there is no filter axis to loosen later by mistake.

**The shelf's ordering corrects a claim this addendum's own plan made about itself.** Both
`leagues_house_rung_idx`'s own docblock and `house-factory.ts`'s `openHouseLeaguesQuery` docblock
originally assumed the shelf would read its order straight off that index's `(house_rung,
created_at)` shape. That is true WITHIN one rung — a `scheduled` rung's kickoff is itself
creation-ordered by its own stagger — but false ACROSS rungs, since `open_12` and `beginner_12`
stagger on independent clocks. The shipped shelf orders `ORDER BY drafts.kickoff_at ASC` instead, a
`Sort` node after the index's own filtering scan, and both docblocks were corrected in the same
commit rather than left to describe a shelf that does not match what ships. `src/db/
index-plans.test.ts` pins both the index scan and a mutation-proof `"Sort Key"` assertion, seeded
with `kickoff_at` in the exact reverse of `created_at` so a regression back to trusting the index's
own column order reddens the id-order assertion directly, not just the plan string.

**No new filter axis, on the identical §1 reasoning: a house league's rung is a badge, not a
narrowing control.** Every house league shares one canonical format, scoring preset and roster
shape (`docs/decisions/house-leagues.md` §5), so the only fact worth stating per card is which rung
and when it drafts — never a second copy of the format/scoring line the member card already
carries, which would be identical on every house card and not worth printing twelve times.

## 8. The roll (Phase 3.6, Task 7), and why it never touches a sit-and-go league

The founder's "roll until full" ruling — no draft ever fires below a full room — is a THIRD
mechanism in the lobby, alongside the fill trigger (§6) and the house shelf (§7), and it is
scoped to exactly the population those two are not: `dueUnfilledScheduledDraftsQuery`
(`src/league-service/roll.ts`) selects `drafts.start_trigger = 'scheduled'` only. A `when_full`
league is exempt from the roll by construction, not by a runtime guard that could disagree with
the schema-level refusal §6 already documents — it has no chosen target time to be late for until
its own fill trigger writes one, and once that trigger fires, `autoStartDueDrafts` picks the write
up through the same guarded path a commissioner-scheduled draft uses. The roll and the fill
trigger therefore never compete for the same row: one exists because a promised time was kept
short, the other because a promised time was missed. `rollUnfilledDraftInTx`'s own docblock states
this exemption as a SQL predicate rather than an assumption, the same discipline `fireWhenFullInTx`
holds itself to when it reads `drafts.start_trigger` instead of `leagues.is_public_matchmade`
(§6's own "asking the same question from two different data sources is how the two answers
eventually disagree" argument, applied here in the opposite direction).

**The house shelf's scheduled rungs roll exactly like a member league's would.** The roll's own
scan narrows to public-matchmade leagues (the same `ENFORCED_LEAGUE_SQL` gate `dueDraftsQuery`
already holds itself to), which every house rung already satisfies by construction — a house
league carries no special case in `rollUnfilledDraftInTx`, because it needs none. Verified
directly against `house-catalog.ts`'s own `CANON`: **two of the shipped catalog's three rungs are
`'scheduled'`** (`open_12`, `beginner_12`) and genuinely reachable by the roll; only `sitandgo_12`
is `'when_full'` and exempt by the SQL predicate above. A scheduled house rung that misses its
target time rolls forward exactly as a member league would, and its members get the identical
`draft_kickoff_rolled` notice a member league's seats would. There is no separate "retire the room
and mint a fresh edition" path for a scheduled rung that misses its window — the roll is what
keeps it alive instead of the reconciler replacing it, and the reconciler's own replacement logic
(`docs/decisions/house-leagues.md`) fires only on a league actually completing or being abandoned,
never on a late kickoff.

See `docs/decisions/design-v2.md` §6 for the full mechanism (the KEY SHARE lock-order fix and the
due-ness re-derivation) and `docs/league.md`'s own "The roll" section for the notice contract.

## Cross-cutting: no new realtime event, no new coverage gate, no new config file

**No new realtime event type.** The pause and the owed picks ride `DraftClockView`, which is
already on `draftStateView` and on every `draft.*` payload, so neither field can ever be staler
than the frame that would refresh it. A fill-triggered start publishes the same `draft.status` a
commissioner's press does. Everything else (the skip notice, the fill notice) reaches its member
through the existing `notice.created` primitive.

**No new coverage gate — the count stays at twenty-one.** Every pure module this phase adds lands
inside a directory already gated at 100%: `roster-shape.ts`, `median.ts` and `clinch.ts`'s renamed
parameter in `src/league`; `pause.ts` in `src/draft-engine`; `order.ts`'s KDS extension and
`slot-preference.ts` in `src/draft-service`; `fill-trigger.ts` in `src/league-service`. `src/domain`
gains one line — `SUPERFLEX` joining `RosterSlotType`, and `startTrigger`'s union — but stays
ungated, on the same reasoning it always has: it holds types the whole product shares, a 100% claim
over it is separate work, and this phase's one addition there is pinned by tests in the two gated
directories that actually use it.

**No new config file.** The pause window and the skip policy are draft-clock rules and sit in
`src/draft-engine/config.ts` beside `DRAFT_CLOCK_SCHEDULE`, which is the thing they modify. The
roster-shape default is league product configuration and sits in `LEAGUE_CONFIG.defaults`
(`rosterShape: "standard"`) beside the scoring preset, exactly as the plan called for. The sit-and-go
grace period is a lobby tunable and sits in `MATCHMAKING_CONFIG.sitAndGo`, which is already
browser-safe, so the sentence a waiting manager reads and the number the server enforces are the
same import.

**Correction:** the median default did not land in `LEAGUE_CONFIG.defaults` the way the roster-shape
default did — it is a literal `false` at the two places a league's `medianGame` column is actually
set: `medianGame: z.boolean().default(false)` (`createLeagueSchema`,
`src/league-service/schemas.ts`) and `input.medianGame ?? false` (`createLeague`,
`src/league-service/creation.ts`). Both agree on the same value, so no league can end up with a
different default depending on which path set it, but the value itself is not centralized the way
every other default in this section is. Worth fixing the next time either file is touched for an
unrelated reason; not fixed here, because Task 11 documents what shipped rather than quietly
patching it mid-closeout.

**Updated (Phase 3.5 addendum, Task 16): checked directly rather than assumed, this carry was not
resolved by the addendum, and grew by one site rather than shrinking.** `creation.ts`'s
`writeLeagueInTx` (Task 13's rewrite of `createLeague`'s write body) still falls back to `input.
medianGame ?? false` twice — once for the `leagues` insert, once for the audit payload — and
`HOUSE_CATALOG`'s own `CANON` (`src/matchmaking/house-catalog.ts:72`) hardcodes a third literal
`medianGame: false` directly, because there is nothing centralized in `LEAGUE_CONFIG.defaults` for
it to spread the way `format`, `teamCount`, `scoringPreset` and `rosterShape` all are. All three
still agree, so no behavior bug exists, but the carry is now three literal `false`s rather than
two. See `docs/decisions/house-leagues.md` §12.
