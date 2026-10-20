# Lane 95 report: once your week is locked, the action screens turn to next week

Backlog B07, B12, B15, B16 (screen part). Branch `worktree-agent-affd3b91d62eaa09d`, merged with origin/main at b1346fae (Lane 91).

## The rule, in one API function

`advisor.addressedWeek()` (`api/internal/inseason/advice.go`): from the member's Lineup slots at the page clock, the week is `Snap.Week` until every starter with a game (byes aside) has kicked off or is final by the one game state (`gameStateAt`), then `Snap.Week+1` when the schedule holds games that week. It reads `everyStarterPast(slots, state)`, the same helper Lane 91's `weekDone` now reads (with `final`), so the Lineup's sentence and the turn never fork. `Service.addressed` / `leagueAdvisor(..., actionWeek)` turns the advisor (`turnTo`): that week's Season (games, kickoffs, byes) with spent designations dropped (`Season.WithoutSpent`), that week's published projection, its own trade search. Routes on the action week: `/waivers`, `/trades`, `/trades/check`, the front door's chips (`/me/week`), and the warm run (so the warmed search is the one Trades reads). Lineup, Matchup, Scoreboard, Order and player routes stay on the platform's week.

New additive, optional wire fields (openapi, `make check-gen`):
- `WaiverAdvice.for_week`, `TradeAdvice.for_week`: the week the page addresses. `week` stays the platform's week, because `claimMove` sends it and hostmoves refuses a claim whose week is not ESPN's scoring period (`hostmoves/claim.go:44`).
- `projection_arrives_at` on both: set while no projection is read for `for_week`: its first kickoff less `ProjectionCaptureLead` (2 h, research `kickoff_slots.py` LEAD), nil once read or past.
- `WeekLeague.chips_week`.

## Per item

**B12 Waivers (DONE).** Label prints `for_week` ("Week 7"). Rows carry week 7's games ("vs NYG Sun 12:00 pm"). With no week 7 projection read, the page takes the season Gain order (new branch in `Waivers` after Lane 85's `orderOf`; `season_order.go`, `pageOrder` and Beats untouched) with basis `UnprojectedOrderWords`: "Pickups go in Gain order until week 7's published projection is in.", and the basis says "Week 7 projections arrive Thursday." in place of the Proj sentence. The Proj column stays (shows "--"); hiding it is the table's structure, next lane's.
- Verb: ESPN's league snapshot carries no waiver/free-agent status (only Yahoo fills `Snapshot.Pool`; ESPN's `kona_player_info` status is read per player at claim time, `espn/claims.go:179`). Kept "Add", as the brief allows. A "Claim" word needs the ESPN read to fetch pool status, a later lane.

**B15 Trades (DONE).** Strip says Week 7; `TradeFinder` drops the "This week, Proj" group (`weekShown`) while `projection_read_at` is null, the basis says the arrival and keeps Room's sentence alone. Gains unchanged (weeks 7 to 17).

**B07 Front door (DONE).** Chips come from the turned advisor: a week's designation (Q/D/O) listed no later than his club's last kickoff is spent; a season-long one stands. To date listings, the injury run read now covers every status (`boards.DesignationRuns`, renamed from `SeasonRuns`; `Designation.Listed`); `Since` keeps its old meaning exactly (status-level season-long codes). Head reads "One fact for week 7."; bye/pickup lines say "in week 7"; the stamp says "Read Fri 4:00 pm", never "Listed".
- Scope call: the spent filter applies only on the turned view. On Tuesday, once ESPN turns to week 7, the normal view shows the provider's current list again, so a carried-over Out can come back until the provider updates. A generic rule ("listed since his last game") would also hide real carry-overs. Dev data, Saturday Oct 11 capture: 10 of 43 Q and 39 of 192 O runs began before week 5's Sunday games. Coordinator's call.

**Lineup (no change, report).** Lineup follows `Snap.Week` = ESPN `scoringPeriodId` (`leaguesync/espnhost.go:143`), so it turns when ESPN does. When ESPN turns can't be seen from our data: `app.league_snapshots` keeps one row per league and stores no ESPN reads.

**B16 player read label (DONE, small).** The caption already says the week ("Written Sun 12:01 am Central, for week 6", run's text). The section was labelled "The week ahead"; it now reads `weekReadLabel` "Our read for week 6". Cadence is Lane 96's.

## When week N+1's published projection first appears

Not readable from data here: production is off-limits, and dev (5432) and every 5433 copy hold zero `research.tank01_projection_rows` (dev's capture archive has one Sep 9 projections snapshot). By the capture code (`research/pipeline/tank01/capture.py run_capture_harvest`, `projections.py projection_slot_due`), a week's projection is captured only in a kickoff slot's window, opening 2 h before the slot's first kickoff. Week 7's first is Thursday Oct 22, CHI vs NE 7:15 pm Central (`research.provider_games`), so the first rows land Thursday about 5:15 to 6:00 pm Central. Week 6's matched: the slot capture missed its Thursday and a one-shot ran Oct 17 (progress.md). **The brief's "arrive Tuesday" premise is wrong**; the footer's day is computed from the schedule (`projection_arrives_at`), so it says Thursday, or Wednesday in a week with a Wednesday game. The same applies Tuesday to Thursday of the normal week view: no projection, so season order and the arrival line. One production read of `select week, min(captured_at) from research.tank01_projection_rows group by week` would confirm.

## Tests (fixed clocks, through the engine)
- `api/internal/inseason/addressed_week_test.go`: Sunday morning gives 6, Monday night with starters final gives 7, Thursday morning (platform on 7) gives 7. Kicked-off vs upcoming slots; no turn past the schedule; Monday-night routes: waivers/trades `week` 6 `for_week` 7, arrival at Thursday's slot, season order and words, rows on week 7 games, Lineup still week 6 with `week_done`. Week 7 projection read gives week order, no arrival. Front door: listed Friday shows the chip Sunday and drops it Monday night; listed after the game keeps it. Mutation-checked (without `WithoutSpent` the Monday case fails).
- `spent_test.go` (Season rule), boards `TestDesignationSince` (Listed for every status), `TestRunCodes`.
- `review66f_test.go TestWaiverAnswerCarriesTheTable` now reads a projection (its invariant is week order's).
- Web: `next-week.test.ts`, `week.test.ts` (turned chips, aside, Read stamp), `trades.test.ts`/`waivers.test.ts` (arrival basis), `week-read.test.ts`.
- Fixture: `scripts/inseason-fixture/turn.ts` mirrors the turn (week 7 schedule in `data/week7-games.json` from `research.provider_games`), `FIXTURE_MONDAY_NIGHT_CLOCK`; `scripts/week-turn-shots.ts` asserts and shoots.

## Shots (`lane-95-shots/`, dark, 1280 and 390, fixture clocks)
- `monday-night/` (Mon 11:00 pm Central): front (One fact for week 7, spent Questionable gone), waivers (Week 7, week 7 games, arrival line), trades (Week 7, no week group, arrival line).
- `saturday/` (week clock): same screens on Week 6 with the week group, unchanged.

## Deploy pair
- New API + previous web: fields are additive and optional, `week` keeps its meaning (claims unaffected), and `season_gain` is an order the previous web already draws. The previous web would label the chips "this week" and still print "Listed".
- New web + previous API: `for_week`, `projection_arrives_at` and `chips_week` absent read as the platform's week, with no arrival line and an unturned strip. Tests cover the absent cases (`addressedWeek({week:6})`, `turnedWeek(SUCK)`, `arrivesPart` without the field).

## Concerns
1. The "Tuesday" premise (above): the footer says Thursday by the schedule.
2. Tuesday flicker of carried-over designations on the strip (above).
3. The order route stays on the platform's week while Trades turns: in the Monday-night window the pair's trade search cache holds alternating content (one extra search per switch). Moving the order to the action week is Lane 96's board.
4. `npm run build` needs `PUBLIC_RUN_ID=latest PUBLIC_RUN_BASE_URL=.runs` in a worktree with no `.env` (the `.env.example` values); passed that way.
5. ESPN "Claim" verb needs a pool-status read (not in the snapshot).

## Gates (after merging origin/main b1346fae)
- web `npm run check` exit 0
- web `npm run lint` exit 0
- web `npm run standin && PUBLIC_RUN_ID=latest PUBLIC_RUN_BASE_URL=.runs npm run build` exit 0
- web `npm test` exit 0 (685 pass, 0 fail)
- web `node scripts/script-bytes.ts` exit 0 (player page 70,831 B gz of 73,728)
- api `gofmt -l` empty (exit 0)
- api `go vet ./...` exit 0
- api `go build ./...` exit 0
- api `make check-gen` exit 0
- api `CI=true TEST_DATABASE_URL=.../lane95_test go test -race -count=1 -p 1 ./...` exit 0
- `week-turn-shots.ts` CLOCK=monday-night exit 0, CLOCK=saturday exit 0
