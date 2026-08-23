# Commish — Trades

Read this with `docs/conventions.md`, `docs/advisor.md`, `docs/decisions/trades-and-fairness.md`
and `docs/decisions/enforcement-and-tiers.md` before touching anything under `src/trades/`,
`src/league-service/trades.ts`, `src/league-service/trade-transfer.ts`,
`src/league-service/trade-reversal.ts` or `src/integrity-service/trade-fairness.ts`. This is the
one place the whole sequence — propose, analyze, accept, hold, flag, reverse — is described end to
end.

## What the surfaces are

| Layer | Path | Rule |
|---|---|---|
| Pure | `src/trades/` | `TRADE_CONFIG`, the lifecycle/status vocabulary, the asset union, the wire contract, and `tradeBalance` — the one fairness function. NO I/O, no clock, no database. 100% coverage. Browser-safe: the seventh pure exempt directory on the client-boundary list, beside `src/chat`, `src/matchmaking`, `src/identity`, `src/help`, `src/reviews` and `src/moderation` (`eslint.config.mjs` names all seven). |
| Service | `src/league-service/trades.ts`, `trade-transfer.ts`, `trade-reversal.ts` | The only code that talks to Postgres for a trade: propose, withdraw, reject, accept (the transfer, the supersede sweep, the notices, the two league-chain events) and the operator's reversal. Blocked from the browser, same as `@/league-service` always is. |
| Detector | `src/integrity-service/trade-fairness.ts` | `evaluateTradeBeforeExecute` (inside the accept transaction) and `raiseTradeFairnessFlag`/`sweepUnflaggedTrades` (after commit, the platform chain). |
| Browser | `src/league-room/components/trade-composer.tsx`, `trade-inbox.tsx`, `trade-card.tsx`, and the trade page under `src/app/app/leagues/[leagueId]/trades/` | Reuses `AdvisorPanel`'s surface shape. Value-imports `@/trades` directly (pure); reaches the service layer only over the wire. |

## Who may call what

Every route goes through `withLeagueMemberActor`, and then refuses a caller with no team of their
own: all three handlers 403 on `actor.teamId === null`. So a commissioner who fields no team in
their own league reaches nothing here — trading is a manager's act, and there is nobody for a
teamless caller to trade as. A signed-in stranger gets the same 403, and a trade naming two OTHER
teams answers 404 to everybody else (the codebase's non-oracle discipline: a 403 would confirm that
a guessed id names a real negotiation between two named managers).

| Route | Who | Notes |
|---|---|---|
| `GET /api/leagues/[leagueId]/trades` | a manager with a team in the league | Three bands: `inbox` (offers to answer), `outbox` (offers sent), `history` (the league's executed trades plus the caller's own dead offers). |
| `POST /api/leagues/[leagueId]/trades` | same | Body: `{ counterpartyTeamId, proposerAssets, counterpartyAssets, note }`, and nothing else — the schema is strict, so an unknown key is a 400. The proposing team is resolved from the session and the valuation week from the league's own schedule; neither is a field a body could name. Returns the new offer's id and the proposer's own private, advisory `tradeBalance` read. |
| `POST /api/leagues/[leagueId]/trades/[tradeId]` | the trade's counterparty (`accept`/`reject`), or the proposer (`withdraw`) | Body: `{ action: "accept" \| "reject" \| "withdraw" }`. `accept` runs the whole execution transaction. |

## The lifecycle statuses, and which are terminal

| Status | Terminal | Meaning |
|---|---|---|
| `open` | no | Live, answerable, counting against the proposer's open-offer cap. |
| `accepted` | **yes** | Both managers agreed and the rosters moved. A later operator reversal stamps `reversedAt` on this SAME row — `status` never moves off `accepted`, because the acceptance happened and a status that erased it would make the row and the audit chain disagree about the same afternoon. |
| `rejected` | yes | The counterparty said no. |
| `withdrawn` | yes | The proposer took it back. |
| `expired` | yes | Declared in the vocabulary, and NEVER WRITTEN. Expiry has no event moment without a scheduler, so it is DERIVED, not stored: `isExpired` (`src/trades/lifecycle.ts`) answers it from `expiresAt`, and a dead offer sits in the table still `open`. See "How expiry actually works" below. |
| `superseded` | yes | A DIFFERENT trade moved a player this offer named. Distinct from `rejected` because nobody declined it, and the notice says so ("Nobody declined it") so a manager does not draw a false conclusion about a leaguemate. |
| `held` | no | Phase 3 Plan D. Both managers agreed, but the gap crossed `INTEGRITY_CONFIG.trade.autoHoldThreshold` in a public, platform-enforced league, so NOTHING executed — no roster moved, no other offer superseded — and a `trade_hold` flag waits on an operator. Deliberately not `accepted` with a nullable timestamp beside it (nothing has happened yet, unlike a reversal) and not `open` either (nobody may accept, reject or withdraw it the ordinary way — it is a question for an operator now, not the two managers). See "The auto-hold" below. |
| `blocked` | yes | Phase 3 Plan D. An operator's `trade_blocked` decision on a `held` trade. Reachable ONLY from `held`. Distinct from `rejected` for the identical reason `superseded` is: neither manager declined it, and "declined" would be a false word for what actually happened. |

Every ordinary lifecycle transition (`accept`/`reject`/`withdraw`/`expire`) is legal from `open` and
from nowhere else — enforced in SQL, by the guarded `UPDATE`'s own `WHERE status = 'open'`, not by a
prior read: a losing concurrent caller matches zero rows, never a stale "yes". `hold` is the same
`open`-only guard (`acceptTrade`'s own branch, replacing an ordinary accept). `supersede` is the one
verb the world can still apply to a `held` trade — a DIFFERENT trade moving one of its players is
the world moving on, not the fairness review's own answer — so it runs from `open` OR `held`.
`release`/`block` are the two ways out of `held`, and only of `held`: an operator has no decision
that reaches an `open` offer. `src/trades/lifecycle.ts`'s `SOURCE_OF`/`TARGET_OF` declare every one
of these exhaustively, and `transitionIsLegal` restates the SQL guard so a test can ask it directly.

## How expiry actually works

**Derived, never stored, and load-bearing anyway.** There is no scheduler in this phase, so there
is no moment at which anything could honestly write `status = 'expired'` — a row that ran out did
so because time passed, not because something happened. So nothing writes it, and a dead offer
stays `open` in the table. `isExpired` (`src/trades/lifecycle.ts`, the browser-safe half) is the
one function that answers the question, and BOTH sides of the product ask it:

- **The card.** `TradeCard` gates its "Needs your answer" badge and its Accept/Decline pair on it,
  against its own ticking clock, so an offer that ages out while the page is open loses its
  controls without a refetch. Its expiry line says `Expired August 18.` — the state and the day —
  rather than "Expires today." forever.
- **The server.** `acceptTrade` and `rejectTrade` refuse a dead offer in the guarded `UPDATE`'s
  own `WHERE`, with product copy ("That offer expired before anyone answered it.") and no trace
  left behind.
- **Withdraw is the exception, deliberately.** A proposer may still withdraw an offer that ran
  out: clearing your own dead offer is housekeeping, not answering it, and refusing it would leave
  a manager looking at a card with no control on it that works.

An expired-but-open offer stays visible to its two parties in their own inbox and outbox — the
boxes filter on `status = 'open'`, which it still is — and stays out of the league's shared
history, which is `status <> 'open'` by construction. Visible, honest, never actionable except by
its own proposer's withdraw.

## Where the thresholds live, and what each one does

Two configs, two audiences — "would a commissioner tune this?" is the line between them.

**`TRADE_CONFIG`** (`src/trades/config.ts`), the product's own numbers:

| Field | Value | What it does |
|---|---|---|
| `proposalTtlHours` | 72 | How long an offer stands before it stops being answerable. |
| `maxAssetsPerSide` | 5 | Matches `ADVISOR_CONFIG.maxPlayersPerSide` — a proposal the advisor cannot assess is a proposal a manager accepts blind. |
| `maxOpenProposalsPerTeam` | 10 | Open offers one team may have outstanding at once, counted inside the proposing transaction so two near-simultaneous proposals can't both slip past a pre-check. |
| `noteMaxLength` | 280 | The optional note a proposer attaches, read by one other human. |
| `rateLimit` | 20 / 60s | Shared across propose/withdraw/reject/accept — the same "one budget across sibling routes" call `advisorRateLimited` and the notices rate limit both make. |

**`INTEGRITY_CONFIG.trade`** (`src/integrity/config.ts`), the platform's collusion-detection
numbers, on the SAME points-per-week axis `ADVISOR_CONFIG.evenDelta`/`.lopsidedDelta` sit on:

| Field | Value | What it does |
|---|---|---|
| `fairnessFlagThreshold` | 20 | A COMPLETED trade whose per-week gap reaches this raises a `trade_fairness` flag into the operator queue. Deliberately above `lopsidedDelta` (12) — a flag is a question about collusion, not a review of somebody's judgment. |
| `autoHoldThreshold` | **35** (Phase 3 Plan D) | A trade whose gap reaches this, in a public platform-enforced league, is HELD before it executes rather than flagged after — see "The auto-hold" below. Nearly twice `fairnessFlagThreshold`, on purpose: a flag costs an operator ten seconds and costs the members nothing, while a hold costs two members their agreement and their time, so its bar sits well past the flag's own. |
| `sweepBatchSize` | 100 | `sweepUnflaggedTrades`'s page size — bounded for the same reason every operator-script read in this codebase is. |

All four thresholds — `evenDelta`, `lopsidedDelta`, `fairnessFlagThreshold`, `autoHoldThreshold` —
are ordered by one test (`even <= lopsided <= fairnessFlagThreshold <= autoHoldThreshold`, all four
live today), because an inversion silently breaks a real property: `even > lopsided` makes a
verdict unreachable, `lopsided > fairnessFlagThreshold` fills the operator queue with trades the
advisor itself calls fine, and `fairnessFlagThreshold > autoHoldThreshold` would hold trades nobody
flagged — a trade frozen before anyone ever asked a question about it. See
`docs/decisions/enforcement-and-tiers.md` §8 for the number's own reasoning.

## The auto-hold (Phase 3 Plan D)

`acceptTrade` branches on `fairness.hold && enforcementAppliesTo({ isPublicMatchmade })` — the
IDENTICAL platform-enforcement predicate the tier-segregation join gate reads
(`@/league-service/enforcement`), so a private league's trade is never held however lopsided. When
both are true, nothing executes: `applyTradeInTx` is never called, no roster moves, no other offer
is superseded, and the row moves `open` → `held` instead of `open` → `accepted`. In the SAME
transaction (nothing happens in the league, so nothing crosses into a second chain — see Plan A's
one-transaction-one-chain rule), a `trade_hold` flag is raised on the platform chain and both
managers are notified (`trade_held_for_review`) with the identical sentence founder decision #10
asks for: "somebody at Commish looks at it," never "under review" or "suspicious."

An operator resolves the flag one of two ways, both new `ResolutionDecision`s scoped to a
`held_trade` subject:

- **`trade_released`** runs `releaseHeldTradeInTx` — the trade the two managers agreed to actually
  executes, re-validated against the CURRENT rosters (which may have moved while the trade sat
  held) rather than trusted from propose time. Moves the row to `accepted`.
- **`trade_blocked`** runs `blockHeldTradeInTx` — the trade never happens, both rosters stay exactly
  as they were, and both managers get the identical notice (byte-for-byte, with no
  `counterpartyTeamName`, since "your trade with X" would read as two different sentences to two
  different recipients). Moves the row to `blocked`.

A held trade can still be superseded by a different trade moving one of its players — the world
moving on is not a review outcome, and the superseded flag closes itself honestly rather than being
left open over a trade nothing can execute or block any more. See
`docs/decisions/enforcement-and-tiers.md` §§7–8 for the full reasoning, including the known false
positives (a rebuilding manager, a genuine salary dump, two friends) and why all three are expected
to reach an operator and usually resolve `trade_released`.

## The sequence, as a numbered walk

1. **Propose.** A manager picks a counterparty team and names players on both sides.
   `proposeTrade` (`src/league-service/trades.ts`) checks — in order — that the caller has a team
   in the league, isn't trading with themselves, both sides are non-empty
   (`isBalancedProposal`), the counterparty team exists, every named player is actually owned by
   the side offering it, the resulting rosters would still be legal once cleared and refilled
   (`plannedTransfer`, a preview only — nothing moves), the proposer isn't already at
   `maxOpenProposalsPerTeam`, and finally that the identical open offer doesn't already exist (a
   sha256 fingerprint over the league, the ordered team pair, and both sorted asset lists — the
   same offer twice is one question, not two, but two DIFFERENT packages to the same manager is
   ordinary negotiation and is capped by count instead). On success: a `trade_proposed` audit
   event on the LEAGUE chain, a `trade_proposed` notice to the counterparty (hidden from the
   league's activity feed — a bid discloses what a manager thinks his own players are worth), and
   the proposer's own private `tradeBalance` verdict, shown to nobody else.

   **The week is the server's, never the caller's.** Both sides are priced at the league's current
   week — `currentWeekOf` (`src/league-service/schedule.ts`), which reads the league's `matchups`
   and asks `seasonProgress`, the same one definition `leagueHome` shows the member. The wire has
   no `weekNumber` field and the schema refuses a body carrying one. The week is the collusion
   detector's own valuation basis: a package priced far enough ahead gets an empty trend window,
   values every player at zero, and reads as perfectly even, so letting the party being detected
   name it would have been a switch to turn the detector off.
2. **Analyze.** The verdict from step 1 is advisory only, computed once at propose time for the
   proposer's own eyes. The recipient's own read happens lazily, on interaction, inside the trade
   inbox — the identical `tradeBalance` function, run again over the current offer, never stored
   and never conflated with the after-acceptance detector in step 4, which runs its own
   valuation independently for a different audience.
3. **Answer.** The counterparty accepts, rejects, or the proposer withdraws. Reject and withdraw
   share one implementation (`settleProposal`): a guarded `UPDATE` stamps the terminal status,
   fires the matching notice (`trade_rejected` or `trade_withdrawn` — one audit event type,
   `trade_rejected`, with `payload.outcome` naming which, because `AUDIT_EVENT_TYPES` is a frozen
   pg enum). Accept (`acceptTrade`) is the wide transaction: re-derives the league's current week
   and re-checks that it isn't locked (a 72-hour offer can straddle a week boundary, so the
   accept-time week is the one that governs the valuation, the lock and the cache eviction, and it
   is re-stamped onto the row so the sweep re-derives at the week the trade actually happened in),
   locks both teams' rows in canonical sorted-by-id order, re-checks ownership against the
   CURRENT roster (not the roster at propose time), computes the fairness evaluation. **Phase 3
   Plan D's branch happens here, before anything else moves**: if the gap crosses
   `autoHoldThreshold` in a public, platform-enforced league, none of the rest of this paragraph
   runs — the row moves to `held` instead, and a flag goes to an operator (see "The auto-hold"
   above). Otherwise, execution continues: freezes every already-locked week's actual lineup for
   both teams (`materializeLockedLineupsInTx` — see below), moves both rosters
   (`applyTradeInTx`), supersedes every other open offer the move just invalidated, notices
   everyone owed a word, and appends `trade_accepted` and `roster_move` to the league chain in one
   batch. Immediate execution, no veto window, no commissioner approval, no league vote (founder
   decision #6) for a trade under the hold threshold — an accepted trade that should not have
   happened is undone by an operator's reversal (step 5), which is a strictly better answer than
   a delay every honest trade pays for.
4. **Flag.** After the accept transaction commits — in its OWN, separate transaction, because a
   transaction may append to at most one chain and `trade_accepted` is league-scoped while a flag
   is platform-scoped — `raiseTradeFairnessFlag` checks the gap computed in step 3 against
   `fairnessFlagThreshold` and, if it crosses, writes one `trade_fairness` flag into the operator
   queue with the analyzer's own reasoning stored verbatim. If that write never lands (the process
   dies between the two transactions), `npm run trades:sweep` re-raises every accepted trade over
   the threshold with no flag — idempotent by construction, off the same open-subject unique index
   every other flag type uses. A trade carrying a `trade_hold` flag is never a candidate, open flag
   or resolved one: the auto-hold asked this same question at a stricter threshold on the same
   evidence, so an operator who released one has already answered it and the sweep does not reopen
   the decision (final review F1).
5. **Reverse.** An operator resolving a `trade_fairness` flag `trade_reversed` runs
   `reverseTradeInTx` — a compensating transfer, not an undo: it runs the same transfer machinery
   with the two sides swapped, and stamps `reversedAt`/`reversedByFlagId` on the ORIGINAL row
   rather than moving its status. It refuses if a traded player has since moved to a third team,
   and it never re-scores an already-settled week (the standings keep reflecting the trade that
   happened, which was real at the time). Both managers get the identical words, because the
   product never signals which of the two was under suspicion.

## Lineup materialization

Every trade — and every reversal — freezes what both teams actually fielded in every week that has
already locked, before it moves a single player. `getLineup` (the same function the lineup editor
and `finalizeWeek` use) falls back to deriving a lineup from the roster when a manager never saved
one, which means a roster change silently changes what a manager is RECORDED as having started in
every already-played week they never saved — a bug that would only surface when somebody re-settles
an old week and gets a different answer. `materializeLockedLineupsInTx` writes exactly the rows the
fallback would have derived a moment earlier for every locked week with no saved lineup, which
freezes a fact rather than making a decision. It runs first, inside `applyTradeInTx`, ahead of the
roster write itself, both for an ordinary trade and for a reversal.

## What a reader will look for and not find

**There is no waiver wire and no free agency.** A roster is fixed from draft to season end.
`roster_move` is the audit event type for a roster change that is NEITHER a draft pick NOR a
lineup change (`src/domain/audit.ts`) — those two have their own types, `draft_pick` and
`lineup_change`. Today `roster_move` therefore means exactly one thing, the player transfer a trade
performs, plus the compensating transfer a reversal performs. A `reason` it doesn't recognize
renders as nothing (`renderRosterMove` returns `null`) rather than guessing, which is the seam a
future waivers phase opts into by name rather than inherits by accident. There is likewise no season trade
deadline — a real fantasy concept, deliberately not invented here, because it is a league setting
with a commissioner decision and a browse-visible term behind it, not a constant to guess. A trade
is refused only while the CURRENT week is locked (`isLineupLocked`, the same rule `setLineup`
reads), never by a season-wide cutoff.

**There is no commissioner approval step, and the auto-hold is not one.** Two managers agree; the
trade executes. No veto window, no third party, no vote — a commissioner has exactly the same
power over a trade as any other member: none. Phase 3 Plan D's auto-hold does not change this: it
is a PLATFORM review, not a commissioner's, it applies only in a public platform-enforced league
(never a private one, however lopsided the trade), and it fires on a fixed configured threshold
rather than anybody's discretion. See `docs/decisions/trades-and-fairness.md` §7 and
`docs/decisions/enforcement-and-tiers.md` §§7–8 for the reasoning and what would have to change for
either to be wrong.
