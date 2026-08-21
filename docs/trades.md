# Commish — Trades

Read this with `docs/conventions.md`, `docs/advisor.md` and `docs/decisions/trades-and-fairness.md`
before touching anything under `src/trades/`, `src/league-service/trades.ts`,
`src/league-service/trade-transfer.ts`, `src/league-service/trade-reversal.ts` or
`src/integrity-service/trade-fairness.ts`. This is the one place the whole sequence — propose,
analyze, accept, flag, reverse — is described end to end.

## What the surfaces are

| Layer | Path | Rule |
|---|---|---|
| Pure | `src/trades/` | `TRADE_CONFIG`, the lifecycle/status vocabulary, the asset union, the wire contract, and `tradeBalance` — the one fairness function. NO I/O, no clock, no database. 100% coverage. Browser-safe: a fourth pure exempt directory on the client-boundary list, beside `src/chat`, `src/matchmaking`, `src/identity`, `src/help`, `src/reviews` and `src/moderation`. |
| Service | `src/league-service/trades.ts`, `trade-transfer.ts`, `trade-reversal.ts` | The only code that talks to Postgres for a trade: propose, withdraw, reject, accept (the transfer, the supersede sweep, the notices, the two league-chain events) and the operator's reversal. Blocked from the browser, same as `@/league-service` always is. |
| Detector | `src/integrity-service/trade-fairness.ts` | `evaluateTradeBeforeExecute` (inside the accept transaction) and `raiseTradeFairnessFlag`/`sweepUnflaggedTrades` (after commit, the platform chain). |
| Browser | `src/league-room/components/trade-composer.tsx`, `trade-inbox.tsx`, `trade-card.tsx`, and the trade page under `src/app/app/leagues/[leagueId]/trades/` | Reuses `AdvisorPanel`'s surface shape. Value-imports `@/trades` directly (pure); reaches the service layer only over the wire. |

## Who may call what

Every route goes through `withLeagueMemberActor` — a manager with a team in the league, or the
commissioner; a signed-in stranger gets 403, and a trade naming two OTHER teams answers 404 to
everybody else (the codebase's non-oracle discipline: a 403 would confirm that a guessed id names
a real negotiation between two named managers).

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

Every transition is legal from `open` and from nowhere else — enforced in SQL, by the guarded
`UPDATE`'s own `WHERE status = 'open'`, not by a prior read: a losing concurrent caller matches
zero rows, never a stale "yes".

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
| `autoHoldThreshold` | `null` | No trade is ever held on merge. The seam exists (`evaluateTradeBeforeExecute`'s `hold` field) but nothing supplies a number — that is a later plan's decision, not a code path this one leaves half-built. |
| `sweepBatchSize` | 100 | `sweepUnflaggedTrades`'s page size — bounded for the same reason every operator-script read in this codebase is. |

All four thresholds — `evenDelta`, `lopsidedDelta`, `fairnessFlagThreshold`, `autoHoldThreshold` —
are ordered by one test (`even <= lopsided <= fairnessFlagThreshold <= autoHoldThreshold` where
each is set), because an inversion silently breaks a real property: `even > lopsided` makes a
verdict unreachable, `lopsided > fairnessFlagThreshold` fills the operator queue with trades the
advisor itself calls fine, and `fairnessFlagThreshold > autoHoldThreshold` (once a hold threshold
exists) would hold trades nobody flagged.

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
   CURRENT roster (not the roster at propose time), computes the fairness evaluation, freezes
   every already-locked week's actual lineup for both teams (`materializeLockedLineupsInTx` —
   see below), moves both rosters (`applyTradeInTx`), supersedes every other open offer the move
   just invalidated, notices everyone owed a word, and appends `trade_accepted` and `roster_move`
   to the league chain in one batch. Immediate execution, no veto window, no commissioner
   approval, no league vote (founder decision #6) — an accepted trade that should not have
   happened is undone by an operator's reversal (step 5), which is a strictly better answer than
   a delay every honest trade pays for.
4. **Flag.** After the accept transaction commits — in its OWN, separate transaction, because a
   transaction may append to at most one chain and `trade_accepted` is league-scoped while a flag
   is platform-scoped — `raiseTradeFairnessFlag` checks the gap computed in step 3 against
   `fairnessFlagThreshold` and, if it crosses, writes one `trade_fairness` flag into the operator
   queue with the analyzer's own reasoning stored verbatim. If that write never lands (the process
   dies between the two transactions), `npm run trades:sweep` re-raises every accepted trade over
   the threshold with no flag — idempotent by construction, off the same open-subject unique index
   every other flag type uses.
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
`roster_move` — the one audit event type every roster mutation in this product shares — means
draft picks, lineup changes and trades, and nothing else; a `reason` it doesn't recognize renders
as nothing (`renderRosterMove` returns `null`) rather than guessing, which is the seam a future
waivers phase opts into by name rather than inherits by accident. There is likewise no season trade
deadline — a real fantasy concept, deliberately not invented here, because it is a league setting
with a commissioner decision and a browse-visible term behind it, not a constant to guess. A trade
is refused only while the CURRENT week is locked (`isLineupLocked`, the same rule `setLineup`
reads), never by a season-wide cutoff.

**There is no commissioner approval step.** Two managers agree; the trade executes. No veto
window, no third party, no vote. See `docs/decisions/trades-and-fairness.md` §7 for the reasoning
and what would have to change for it to be wrong.
