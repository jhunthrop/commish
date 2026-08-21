# Decisions — Trades and Fairness

Phase 3 Plan C. A new document rather than more sections on `docs/decisions/audit-and-integrity.md`
(662 lines, the chain) or `docs/decisions/operators-and-moderation.md` (672 lines, the operator) —
this plan's rulings are about a third subject, the trade itself, and belong beside those two
rather than inside either. Each section records what was chosen, why, and what would have to
change for the choice to be wrong. Every claim below describes the code as it shipped, including
what two fix rounds changed from the plan's own first draft.

## 1. Where a trade is recorded, and why it is the league chain

`operators-and-moderation.md` §5 wrote the sentence that decides this: *a record about a person
under review is not the league's business; a record about a consequence the league already sees
is.* A trade is league content — it moves two rosters, changes everyone's matchups, and is visible
in the standings — so `trade_proposed`, `trade_rejected`, `trade_accepted` and `roster_move` all
carry a real `leagueId` and land on that league's chain.

The reversal is the case that shows the split working in one afternoon. `reverseTradeInTx`
(`src/league-service/trade-reversal.ts`) writes exactly one event, `roster_move`, to the LEAGUE
chain — the compensating transfer is a consequence every member in the league can already see, the
same as the original trade was. The `flag_raised` that put the trade in front of an operator and
the `flag_resolved` that records the operator's `trade_reversed` decision are about the ACCUSED
PAIR being looked at, and both carry `leagueId: null` onto the PLATFORM chain, exactly as Plan B's
`flag_raised`/`flag_resolved` already do for every other flag type. One transaction reversing one
trade therefore produces a row every league member reads (the roster move) and a row no league
member can reach (the flag's resolution), and nothing filters the second one out of
`listLeagueActivity` — it is structurally absent, because `scopeFor` derives an event's chain from
its own `leagueId` column and a platform-scoped event is never even a candidate row for a
league-scoped query.

This is wrong only if a trade turns out to be private league content, which it cannot be: two
rosters changed and the league can already see both.

## 2. One fairness function, and where it now lives

`tradeBalance` moved from `src/ai-advisor/valuation.ts` to `src/trades/fairness.ts` in Task 1, and
`src/ai-advisor/valuation.ts` now re-exports every name — `tradeBalance`, `TradeBalance`,
`TradeVerdict`, `TradeFlag`, `fairnessGap`, `crossesFairnessThreshold` — so the diff at every
existing advisor consumer is zero. `src/ai-advisor/fairness-reexport.test.ts` (Task 1) asserts
`expect(reExported).toBe(tradeBalance)` — object identity, not merely equal output — which is what
keeps a re-export from silently becoming a second, drifting copy later.

Three properties made `src/ai-advisor` the wrong home, and all three are that directory's OWN
rules, not a preference imported from outside it:

- **It is not coverage-gated.** `src/ai-advisor/**` is deliberately excluded from
  `COVERAGE_GATED_DIRS` (`docs/advisor.md`'s own "Why `src/ai-advisor/**` is not on the coverage
  gate" section) because it mixes pure code with a genuinely nondeterministic LLM call. That
  exclusion is correct for the advisor's prose layer and wrong for the one piece of arithmetic
  this whole phase's integrity story rests on — a detector `acceptTrade` calls inside a
  transaction had no gate over it at all.
- **It is on the client-boundary BLOCKED list.** `src/league-room/components/trade-composer.tsx`
  needs `TRADE_CONFIG.maxAssetsPerSide` and `TradeProposalView` as VALUES, and no browser code may
  value-import `@/ai-advisor`.
- **`advisory-only.test.ts` exists to prove nothing under `src/ai-advisor/**` writes.** A function
  the write path calls inside a transaction is a strange resident of a directory whose own test
  suite polices the opposite property.

`ADVISOR_CONFIG` already moved out of `src/ai-advisor` for the first of these reasons, in an
earlier phase, and said so in its own docblock; this finishes that move for the function itself.
`src/domain/trade.ts` stays where it is and keeps `TradeProposal` (the pure Phase 1 shape) and
`isBalancedProposal` — `src/ai-advisor` already imports them, and moving them would be churn with
no property attached.

**Reversed if:** a future reader concludes `src/trades` is advisor code. It is not — the docblock
on both `src/trades/fairness.ts` and `src/ai-advisor/valuation.ts` says which is which, and the
identity-pinned re-export is what proves the split cost nothing at every call site.

### The four-threshold order

`ADVISOR_CONFIG.evenDelta` (3) and `.lopsidedDelta` (12) are advisor copy decisions with
deliberately lenient boundaries — a gap of exactly 3 still reads `"even"`
(`tradeBalance`'s own `gap <= evenDelta`), and a gap of exactly 12 is NOT called lopsided (the flag
only fires on `gap > lopsidedDelta`). `INTEGRITY_CONFIG.trade.fairnessFlagThreshold` (20) and
`.autoHoldThreshold` (`null` on merge) use `crossesFairnessThreshold`'s `>=` instead — a threshold
whose exact value can never be reached is a threshold nobody can configure precisely, and
leniency is a kindness to a member reading a verdict that has no meaning at all to a detector.

`src/integrity/config.test.ts` orders all four on one axis, not just the two the original spec
named, because every adjacent pair guards a real property an inversion would break:

- `even > lopsided` makes a verdict unreachable — nothing could ever be neither.
- `lopsided > fairnessFlagThreshold` fills the operator queue with trades the advisor itself calls
  fine to a member's face.
- `fairnessFlagThreshold > autoHoldThreshold` (once a hold threshold is a real number) holds trades
  nobody flagged — a trade would freeze before anyone ever asked a question about it.

## 3. The proposal's shape

**The valuation week is derived, never supplied.** `weekNumber` was a caller-supplied field on
`proposeTradeSchema` until the plan's final whole-branch review proved live what that costs. The
week a trade is priced at IS the collusion detector's basis: `assembleAdvisorContext`'s trend
window is `[weekNumber - ADVISOR_CONFIG.trendWeeks, weekNumber)`, so a package named at a week far
enough ahead reads an EMPTY window, values every player at `averagePoints: 0`, produces `gap: 0`,
and can never cross `fairnessFlagThreshold`. Week 8 in a league living in week 4 is a real,
in-season, `scheduled` week — no nonsense value was needed — and the same field also decided which
`stat_weeks` row the live-week lock read and which key the score cache evicted. Worse, the
documented remedy inherited the evasion: `reDeriveAcceptedTradeValue` re-derived at the same frozen
week, so `npm run trades:sweep` looked at a rigged trade and passed it.

The ruling: the week is NEVER the caller's to name, for exactly the reason `proposerTeamId` never
was. It is gone from the wire entirely — `proposeTradeSchema` is a `z.strictObject`, so a body
carrying one is REFUSED rather than silently stripped — and the server derives it from
`currentWeekOf` (`src/league-service/schedule.ts`), which reads the league's own `matchups` and
asks `seasonProgress` (`src/league/schedule.ts`), the one definition of "the current week" in this
codebase. Deriving is what the fix turns on, not bounding: a membership check against the league's
season, the shape `setLineup` uses for its own week argument, would have passed week 8 cleanly.

**Propose-time and accept-time can differ, and accept-time governs.** An offer lives for
`proposalTtlHours` (72), which straddles a week boundary. `proposeTrade` stores the week it derived
so the offer's advisory verdict is explicable while it sits open; `acceptTrade` re-derives inside
its own transaction and that value governs all four consumers — the valuation, the `stat_weeks`
lock, the cache eviction, and the row's own `week_number`, re-stamped in the guarded `UPDATE`. So an
accepted row names the week the rosters actually moved in, which is what makes the sweep's
re-derivation at that row's week the right question rather than a repeat of the evaded one.

**The fingerprint.** `proposalFingerprint` (`src/league-service/trades.ts`) hashes the league id,
the ORDERED team pair, and both asset lists SORTED by player id — sha256 over
`canonicalSerialize`'s rejecting encoder, the same encoder the audit chain itself uses, because key
order is not part of an offer's meaning and neither is array order. A partial unique index,
`trade_proposals_open_fingerprint_idx` on `fingerprint WHERE status = 'open'`, is what makes
sending the identical package twice one question rather than two — the same shape
`integrity_flags_open_subject_idx` uses, for the same reason. Sending a DIFFERENT package to the
same manager is ordinary negotiation, not a duplicate question, and is bounded by
`maxOpenProposalsPerTeam` instead of by uniqueness.

**Why the mirror offer is a different offer.** Team B offering back exactly what Team A asked for
hashes differently on purpose: the ordered team pair sorts the SAME two ids into the SAME
canonical order regardless of who is proposing, but the two asset lists have swapped roles —
`proposerAssets` and `counterpartyAssets` are not interchangeable in the hash, so A→B and B→A are
two rows, two audiences, two live negotiations. Merging them would collapse two different
questions — "will you take my offer" and "will you take my counter" — into one row a losing party
never gets to answer.

**Why `reversed_at` is a stamp and not a status.** `status` reaches `'accepted'` and stays there
forever; a reversal writes `reversedAt`/`reversedByFlagId` on the SAME row rather than moving it
to a sixth status, because `trade_accepted` is already on the immutable league chain and a status
that overwrote the acceptance would make the row and the chain disagree about the same afternoon
(§8 below has the full reversal ruling).

**Why assets are `jsonb`, and what Phase 9 adds.** `TradeAsset` (`src/trades/assets.ts`) is a
discriminated union with ONE arm today — `{ kind: "player"; playerId: string }` — stored in two
bounded `jsonb` columns (`proposer_assets`, `counterparty_assets`) rather than normalized into a
child table, because `docs/decisions/data-layer-hardening.md`'s own rule is to derive over a
bounded set: every proposal is capped at `TRADE_CONFIG.maxAssetsPerSide` (5) per side, so a jsonb
column here is never an unbounded-growth risk, and a normalized table would model one arm today as
a nullable-column layout a second arm would have to widen rather than extend. `TradeAssetKind`'s
own docblock names the reason directly: `plans/phase-9-dynasty-and-keeper-depth.md` adds a
`{ kind: "pick"; draftId: string; round: number }` arm, and every `switch` this plan writes over
`TradeAssetKind` (`describeAsset`, `assetPlayerIds`) is exhaustive with no `default` — Phase 9's
arm is a compile error everywhere it lands unhandled, rather than a silent fallthrough somewhere.
The cost of shipping the union now instead of a bare `playerIds: string[]` is one discriminator
field per asset, which is nothing next to the fork a later widening would otherwise force.

## 4. The transfer, and the settled week

Ruling 14 in full, because this is the section a future reader most needs and least expects.

`getLineup` (`src/league-service/lineups.ts`) returns saved `lineup_slots` rows when they exist and
falls back to deriving a lineup from `roster_slots` when they do not — a deliberate rule so a
manager who never opens the lineup editor still fields a legal team every week. Two callers read
through that same fallback long after the roster it derives from has possibly changed:
`finalizeWeek` scores a week through it, and Plan B's `correctSettledWeek` RE-SCORES an
already-settled week through the identical call, weeks later.

A trade that moves a player therefore silently changes what a manager is RECORDED as having
started in every week before the trade that they never explicitly saved a lineup for — not because
anything about that old week actually changed, but because the fallback that reconstructs it reads
today's roster, and today's roster now has a different player on it. This surfaces only when
somebody re-settles an old week and gets a different answer than the one everybody already saw —
the single worst class of bug this phase could ship, because the audit chain would faithfully
record a score nobody watching that week could explain.

`materializeLockedLineupsInTx` (`src/league-service/trade-transfer.ts`) is the fix, and it is
deliberately not a decision: for every week already locked (`isLineupLocked`, the same rule
`setLineup` reads, over the SAME `stat_weeks` rows), for either team involved in the trade, if no
`lineup_slots` row already exists for that team and week, it writes EXACTLY the rows `getLineup`'s
own fallback would have derived a moment earlier. A real save is already immune and is never
touched. This is a freeze of a fact that was already true, not a choice about what should have
been true, and it runs FIRST inside `applyTradeInTx` — before either roster moves — for both an
ordinary trade and a reversal (`reverseTradeInTx` calls the same function through the same
`applyTradeInTx` call, with the two sides swapped).

It deliberately covers ONLY locked weeks. An open week must keep falling back to the roster, or a
player just traded in would be unstartable in the current week until his new manager noticed the
editor and saved a lineup by hand — materializing an open week would freeze a roster that is about
to be legitimately live-edited.

**The `stat_weeks` race this closes.** `persistTick` (`src/stats-pipeline/persist.ts`) flips a
week's status in its own transaction with no coordination with anything else, under this
codebase's default READ COMMITTED isolation. Without a lock, a boundary week could flip
`scheduled` → `in_progress` in a `persistTick` transaction that commits AFTER
`materializeLockedLineupsInTx`'s own read but BEFORE the trade's transaction commits — the read
would see a stale `scheduled`, skip materialization, and the roster move that follows would then
retroactively change what that week's `getLineup` fallback derives, for a week that had, by the
time the trade's transaction actually committed, already started. `FOR SHARE` on the `stat_weeks`
read, taken FIRST — ahead of every other read in the function and in `applyTradeInTx`, matching
`setLineup`'s own position exactly — blocks this read against `persistTick`'s uncommitted row and
forces it to see whichever value actually wins the race. This was a real HIGH finding from Task
4's review, confirmed live with a deterministic two-connection race test before the fix landed
(fix round 1).

## 5. The lock order for a roster-moving transaction

Three writers move a roster: `setLineup` (Phase 1), `acceptTrade` and `reverseTradeInTx` (this
plan). All three take `stat_weeks[week] FOR SHARE` FIRST — ahead of every other lock the
transaction takes, including their own business rows. The position matters more than the lock
class itself: Plan A's real production deadlock was three transactions each honoring an
"anchor-last" rule while taking IMPLICIT foreign-key locks AFTER the anchor, and the lesson that
review recorded is that a lock order is only a real rule if every writer takes the same locks in
the same SEQUENCE, not merely the same set. Taking the week lock in the identical first position is
what keeps `setLineup`, `acceptTrade`, `reverseTradeInTx` and `persistTick` from ever forming a
cycle with each other — `lock-order.test.ts` drives all three against a parked `persistTick`
transaction, on separate connections, through the same `pg_stat_activity` rendezvous the suite
already uses for every other lock-order proof.

The SECOND lock both `acceptTrade` and `reverseTradeInTx` take is BOTH teams' rows, `FOR UPDATE`,
in CANONICAL SORTED-BY-ID order — never "proposer first." Two concurrent accepts on MIRROR trades
(each side is the proposer of the OTHER trade) would deadlock under a proposer-first rule: accept
one locks A-then-B while accept two locks B-then-A, and each waits on the row the other already
holds. Sorted-id ordering makes both converge on the same acquisition order regardless of which
side proposed which trade, and it is deadlock-free against both a concurrent `proposeTrade` (which
only ever locks the proposer's own team row) and a concurrent mirror accept. `lock-order.test.ts`'s
two-connection proof drives the mirror-trade pair directly, not just asserted by reasoning.

## 6. Where the flag is written, and the hole that leaves

`raiseTradeFairnessFlag` runs AFTER `acceptTrade`'s own transaction has already committed, in its
own separate transaction. This is not a style choice — it is forced by a constraint the original
spec could not have accounted for: `trade_accepted` is league-scoped and `flag_raised` is
platform-scoped, and Plan A's ruling 3 says a transaction appends to at most one chain (`recordAll`
throws outright on a batch that spans two). A spec written as "subscribes to `TRADE_ACCEPTED`" as
one flow cannot be one transaction here.

The honest consequence: a process that dies between the accept commit and the flag-raising call
leaves a genuinely lopsided trade with no flag. The trade itself is correct and complete, the audit
chain is complete, and only the QUESTION is missing. That is why the failure is logged rather than
surfaced to the manager who accepted — they did nothing wrong and can do nothing about a write
that failed on the platform's own side — and why `npm run trades:sweep`
(`scripts/sweep-trade-fairness.ts` → `sweepUnflaggedTrades`) exists as the remedy: it re-derives
every accepted trade with no `trade_fairness` flag at all and re-raises. `raiseFlag`'s own
open-subject unique index makes a re-run idempotent by construction — a second raise for a trade
that already has a flag returns the existing one and writes no second event.

This is the SAME after-commit exception, with the SAME operator remedy, that Plan B's own
multi-account sweep already carries (`sweepLeagueForMultiAccounts` / `sweepQuietly`), and it is
recorded here beside that precedent so the two read as one pattern rather than two separate
gambles: an audit chain that appends to at most one scope per transaction, applied honestly, always
produces exactly this shape of after-commit gap wherever a write needs to cross scopes, and the
remedy in both cases is the identical shape — a bounded, idempotent, operator-run sweep.

One additional wrinkle unique to trades: the sweep's re-derivation, long after rosters have moved
on, cannot read the exact rosters `evaluateTradeBeforeExecute` saw a moment before the trade
executed. `reDeriveAcceptedTradeValue` instead reads the UNION of both teams' CURRENT rosters at
the trade's own recorded `weekNumber` — a necessity, not a freshness choice, since a traded asset
ordinarily sits on the other side of this very trade by sweep time unless a LATER trade moved it
again. This means the sweep's number can, in principle, differ from the number computed at accept
time (ordinary stat drift cannot move it, because `reDeriveAcceptedTradeValue` anchors to the
trade's own frozen week; the residual vectors are rare — a retroactive stat correction, a scoring
settings change). The honest remedy adopted here is not to hide that gap but to LABEL it: every
`trade_fairness` flag's evidence carries a `basis` discriminator — `"accept_evaluation"` from the
after-commit call, `"sweep_rederivation"` from the sweep — surfaced in plain language on the
operator's flag detail card, so an operator reading a flag always knows which of the two questions
it is actually answering.

## 7. The trade governance default

Founder decision #6 ships as the only shape Steps 3 and 5 of the original spec were ever written
against: immediate execution on acceptance, no veto window, no commissioner approval, no league
vote. Every alternative adds a third party to what is, by construction, a two-party transaction.

**Why this is safe to default rather than block on:** the reversal path exists in the SAME plan. A
trade that should not have happened can be undone by an operator — a strictly better answer than a
delay every honest trade would have to pay for, on the mere chance that one trade in many turns out
to deserve a second look. The founder retains a real veto over the default itself, and the cost of
exercising it is bounded and already scaffolded: `evaluateTradeBeforeExecute` already returns a
`hold` boolean computed inside the accept transaction, from `INTEGRITY_CONFIG.trade
.autoHoldThreshold`. A veto window is therefore a STATUS and a TIMER layered over a seam that
already exists — a branch in a result a later plan reads, not a re-opened design. This plan does
not flip `SYSTEM_ACTION_SUMMARY_ALLOWED.trade_held_for_review` for the identical reason Plan B
denied it: no publisher exists (`autoHoldThreshold` is `null`, no trade is ever held), and flipping
a flag for an event nobody emits would be a control wired to nothing.

**What a commissioner-approval step would actually change:** not a UI addition, but a third party
inserted into what has been, throughout this design, a two-party transaction — every lock-order
ruling in §5, the notice pairing in §8, and the visibility ruling in this plan all assume exactly
two counterparties. That is a bigger question than it looks, and this plan does not answer it.

## 8. The reversal

A compensating transfer, forward-only, refused when the world has moved on, and never re-scoring a
settled week. Three properties, each with a rejected alternative:

- **Not a delete.** `trade_accepted` is permanently on the league chain and nothing may edit it —
  a reversal that erased the acceptance would make the row and the chain disagree about the same
  afternoon.
- **Not a status change**, for the identical reason — `reversedAt`/`reversedByFlagId` are stamped
  on the SAME row beside `status: "accepted"`, never a sixth status that would require the row to
  stop meaning what it always meant.
- **Never re-settles a played week.** A week that already happened was scored with the rosters as
  they stood at the time; both managers already saw that result. Re-scoring it after a later
  reversal would be the platform editing a result on the strength of a decision made afterward.
  `reverseTradeInTx` calls `applyTradeInTx`, which calls `materializeLockedLineupsInTx` first — the
  identical freeze §4 describes, now protecting the weeks between the ORIGINAL accept and this
  reversal from the reversal itself, which is just as much a roster mutation as the trade it
  undoes.

The asymmetry this leaves is real and deliberate: the standings still reflect a trade that has been
undone. A competitive manager will notice and may dispute it — this is the smaller of two wrongs,
chosen on purpose, not an oversight. The alternative (silently rewriting history that has already
been played and seen) is the worse failure mode this whole plan exists to prevent in the general
case (§4), and it would be strange to reintroduce it specifically for the one operation whose job
is to undo a mistake.

Both managers are told the identical words — the product never signals which of the two was the
one under suspicion. A free-text operator note reaches both, guarded (§9 in
`operators-and-moderation.md`'s companion sense — every note-carrying decision, `trade_reversed`
included, is pre-validated at the shared `NOTE_REACHES_SOMEONE_ELSE` seam against the same
accusatory-terms list a notice may never contain).

**Retry provenance.** `resolveFlag`'s own platform-chain stamp commits in a SEPARATE, LATER
transaction than `reverseTradeInTx`'s league-chain one (the same one-transaction-one-chain
constraint §6 describes). If the reversal commits but the flag's own resolution stamp then fails,
a retry of the identical decision re-enters `reverseTradeInTx` with the same `flagId`.
`reversedByFlagId` — the SAME column the guarded `UPDATE` stamps alongside `reversedAt`, not a
second column — is what a retry checks: if it already names THIS flag, the transfer is this flag's
own completed work, and the retry reports success without re-running it (re-running would violate
forward-only history as surely as a fresh double-reversal would), letting `resolveFlag` proceed to
close the flag it never got to stamp the first time. Reversed by a DIFFERENT flag remains the
ordinary refusal.

## 9. What a `trade_fairness` flag is and is not

It is a QUESTION about collusion raised on a completed trade — never a review of somebody's
trading judgment. That is why its threshold (20 points per week) sits well above the point at
which the advisor calls a trade lopsided to a member's face (12): every gap past 12 reaching an
operator would be a queue full of ordinary bad trades, not a queue of trades worth a human asking
"did these two coordinate."

**The known false positives**, all of which should reach an operator and almost all of which
should resolve `no_action`:

- A rebuilding manager selling a star for future value at a discount — a real, legitimate strategy
  that produces a large one-sided gap on paper.
- A lopsided trade between two friends who trust each other and do not care that the numbers are
  uneven.
- A manager who simply values a player differently than the platform's own scoring-based
  valuation does — disagreement is not evidence of anything.

All three are indistinguishable from real collusion at the moment the flag is raised — that is
precisely why suppressing them (raising the threshold further, or filtering by some heuristic
meant to "catch only the real ones") would suppress the one case that actually matters: it looks
identical from here. A human, not a formula, is what separates them, and the whole design of the
resolution vocabulary (`no_action`, `trade_reversed`) exists so that the common, harmless case
costs an operator ten seconds and the rare, real one has a remedy.

## 10. Threat model additions

What this plan adds to Plan A's threat model (`docs/decisions/audit-and-integrity.md` §9) and to
`operators-and-moderation.md` §11's operator-role tier: two accounts under one person's control can
now move value between themselves in a single, audited transaction — a trade between a manager's
own two teams in the same league is completely legal at the application layer (nothing in
`proposeTrade` checks whether the two `userId`s behind two teams are the same person) and moves
real roster value in one clean, hash-chained record.

That is EXACTLY the behavior `trade_fairness` detection exists to raise a question about: an
unusually lopsided trade between two specific teams is the observable signature this whole
mechanism was built to notice, regardless of why the two sides agreed to it. The detector cannot
and does not attempt to determine WHO controls each team — it only measures the gap and raises a
flag when the gap crosses a threshold; who is behind either team is a question for the operator
reading the flag, informed by whatever else the queue already surfaces (join dates, device
signals, the same evidence `operators-and-moderation.md` §11 already documents for the
multi-account detector).

**The detector's own inputs are therefore part of the threat model.** The one thing a colluding
pair must not be able to do is choose the terms the detector measures them on. That is why the
valuation week is derived server-side and refused on the wire (§3): it was the single input that,
supplied by the party being detected, switched detection off entirely with a legal in-season
value and no compensating control anywhere. The general rule this generalizes to, stated for the
next detector: any input that determines what a detector MEASURES belongs to the server, on the
same footing as `teamId`, and a bounds check on such an input is not a substitute for owning it.

**What this plan does NOT add:** no account action of any kind is reachable from a trade flag —
`src/integrity/flag-only.test.ts` covers `src/integrity-service/trade-fairness.ts` the same way it
covers the multi-account detector, proving no code path reachable from evaluation or the sweep can
suspend, ban, or restrict anything. No money moves — this product has no money-movement surface at
all yet. And there is no path from a flag straight to an automatic consequence: every
`trade_fairness` flag waits in the same oldest-first, no-severity-sort queue every other flag type
does, and a human decides `no_action` or `trade_reversed`, every time.
