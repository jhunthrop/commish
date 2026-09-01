# Vegas Laws: team-quality signals enter the discovery harness

Date: 2026-09-01
Status: approved direction (founder asked for Vegas odds coverage: player props, team
performance, team record odds; the free win-totals half proceeds now, the props half waits
on The Odds API key and tier)
Owner: engine
Backbone: docs/research/2026-08-31-market-edge-closeout.md (the harness, the bar, the blend),
docs/research/2026-09-01-live-board-closeout.md (the live board this would feed)

## Why

The board's only team-quality inputs today are indirect: the market anchor inherits whatever
drafters believe about a team, and the coach-change law died at the evidence bar (effect
-0.05, CI [-0.61, +0.49]). The founder's Achane question (new coach, team projected among
the worst) names a signal class we never measured: the market's own preseason judgment of a
TEAM, as distinct from its judgment of a player. Vegas season win totals are that judgment,
published before every season since 2003, with odds and results, free.

## What is gettable (sourcing verified 2026-09-01)

- Historical team win totals WITH odds and results, 2003 to present: the nfelo win-totals
  page (public, open-source project by greerreNFL; their GitHub carries game lines in
  nfelomarket_data but NOT the win-totals table, so the page is the source), cross-checkable
  against the covers.com sportsoddshistory futures archive. About 700 team-season rows,
  one-time fetches at human rates.
- Current 2026 win totals: the same nfelo page carries the current season; The Odds API
  ($29 Professional key, pending from the founder) is the API-grade alternative once wired.
- Player season props: The Odds API Business tier only ($99/month, archive back to May
  2023). OUT OF SCOPE for this round; deferred with the props-as-anchor test design noted
  in the close-out.

## Part 1 - Historical win totals into the store

- Fetch the nfelo win-totals tables (one page fetch per season or one bulk page, human
  rate), save the RAW fetched material under data/raw/ the way other one-time ingests do,
  parse into team-season rows: season, team, closing win total, over price, under price
  (when present), actual wins.
- Cross-check discipline (the Wikipedia-cross-check analog): actual-wins column must match
  the store's own schedule-derived wins for every season both know; any mismatch is
  investigated, never averaged. Win totals themselves cross-checked against the covers.com
  archive for at least 3 spot seasons.
- Storage: TEAM_METRICS gains vegas metrics in the team store (team_week_observations,
  week-0 or the store's season-scoped convention, whichever the schema already prefers for
  season-scoped team facts). Stamp: the season's first kickoff minus the same eve
  convention legacy depth uses, because closing win totals are preseason-published by
  construction. The stamp MUST be visible to the measurement harness's historical reads
  and to replay moments; an explicit firing-count audit proves it (a quantity nobody can
  read measures nothing).
- 2026's own win totals ingest through the same path (from the nfelo current table, or The
  Odds API if the key has landed and its tier covers futures), so anything confirmed can
  fire on the live board.

## Part 2 - Two quantities, not ten

The discovery family's size is the multiple-comparisons budget. This round adds exactly two
quantities to QUANTITY_DEFS, mirroring the incoming-coach shape (context of the season being
predicted, known preseason):

- incomingTeamWinTotal: the Vegas win total published for the predicted season, for the
  player's team that season.
- incomingTeamWinTotalDelta: that total minus the team's ACTUAL wins the prior season (the
  market says this team collapses or surges; the Achane case is a large negative delta).

Both tri-state (null when the team-season has no ingested line, never fabricated). Both get
the standard template treatment (threshold q70/80/90 both signs, YoY delta where the
quantity's own shape supports it, AND-pairs per the existing generator rules).

## Part 3 - The harness re-run, honestly versioned

- Growing the family changes the BH correction for EVERYONE. The whole discovery run
  re-executes (same seeds, same folds, same MIN_TRAIN_PAIRS=20 and Student's-t reference);
  discovered.json regenerates; every EXISTING confirmed discovered law's verdict is
  re-checked under the larger family and any change is reported prominently, never
  silently absorbed. laws:discover -- --check re-baselines deliberately, in the same
  commit as the regeneration, with the diff summarized in the ledger.
- Tribal registry untouched: the Achane hypothesis is discoverable (threshold and delta
  templates over the two new quantities cover it); no new hand-written tribal law.
- Verdict bar unchanged: full-window CI excluding zero, sign-consistent replication in
  every fold, pair floors. If nothing confirms, that IS the result and ships as one.

## Part 4 - The board, only if something confirms

- A newly confirmed law prices onto the board through the existing gate: trainEffect from
  the predictor-window partition, position-gated by the candidate's own position, capped by
  the fitted caps like every non-rookie channel.
- If (and only if) a new law confirms: blend constants regenerate, BOARD_SOURCE bumps to
  v7, all five seasons re-persist, replay boards proven unchanged where the law does not
  reach them, the held-out scorecard re-runs, and the market-edge close-out gains an
  addendum with the re-measured figures, whatever they say. The 2026 top 50 reprints.
- If nothing confirms: no board change, no source bump, and the close-out records the
  null with the same prominence a confirmation would have gotten.

## Out of scope

Player season props and the props-as-anchor test (Business-tier archive; designed in the
close-out's deferrals, waiting on the founder's tier decision). Implied per-team offensive
totals derived from game lines (nfelomarket_data): a candidate quantity for a later round.
Weekly in-season odds movement. Any unmeasured channel touching the blend.

## Test and copy rules

As every round: engine suites TDD and serial (ONE vitest runner, --no-file-parallelism);
UI suites stay on the deferred ledger; no em-dashes anywhere printed or rendered; every
figure from a run or a measured object; fail fast; never fabricate. Raw fetched pages are
committed under data/raw/ (or the repo's existing raw-ingest convention) so the parse is
reproducible without refetching.
