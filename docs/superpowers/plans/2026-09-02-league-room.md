# Plan: the League Room rebuild

Spec: docs/superpowers/specs/2026-09-02-league-room-design.md
Branch: worktree-league-room. Conventional commits; tsc + eslint + targeted vitest green
after each task. No merge.

## Task 1 - Spec and plan (this commit)

## Task 2 - New service reads
- `byeWeeksByTeam(db)` in src/league-service/nfl-schedule.ts (+ DB test): regular-season
  week with no game per NFL team.
- `pendingWaiverClaims(db, leagueId, teamId)` in src/league-service/claims.ts (+ DB
  test): my pending claims with player name/position, clearsAt, queue position under the
  processWaivers ordering.
- Both exported from their modules (not the barrel unless a page imports through it).

## Task 3 - Pure logic (src/league-room/lib, unit tests first)
- drawer-state.ts: reducer per spec.
- stage-priority.ts: StageInput -> StageKind ladder + attention-card ranking.
- lineup-problems.ts: detect problems (empty slot / bye via fixture absence / OUT
  designation, unlocked only), rank replacement candidates by week projection, compute
  before/after starter totals.
- trade-math.ts: per-side pricing rows (week projection), depth counts before/after per
  position, bye-check sentence inputs.
- claim-drop.ts: lowest-projected bench ranking (projection asc, ADP desc tiebreak).

## Task 4 - DecisionSheet primitive
- src/components/ui/decision-sheet.tsx (+ test): dialog with focus trap, esc, amber
  border, header slot, footer verbs slot. No changes to existing primitives.

## Task 5 - Server composition
- room-data.ts beside the pages: leagueHome + lineupView + matchupWeek + projections +
  fixture labels + byes + listTrades inbox + pendingWaiverClaims + first activity page,
  Promise.all'd; builds TradeRoomContext and rosters-by-team; membership predicate
  unchanged.
- room-page.tsx server component shared by the five room routes.

## Task 6 - Room chrome + drawer shell
- room-shell.tsx (client): keyboard (space, /, esc), drawer reducer + pathname sync via
  history.pushState, sheet layer, layout grid, right rail (chat/terms/members/invite/
  moderation) preserved at xl.
- week-strip.tsx, roster-spine.tsx, room-drawer.tsx (chip row, half/full, mobile bottom
  tabs). Component tests for strip/spine/drawer.

## Task 7 - Stages
- stage-attention.tsx: NEEDS YOU cards (lineup fix card, trade card, claim notice) + THE
  LEAGUE THIS WEEK pulse (standings pulse, next matchup with projected totals when
  available, since you left from activity rows).
- stage-live.tsx: score block (margin protagonist, yet-to-play counts), both lineups with
  live points (matchupWeek refetch on SSE score.update via useLiveScores pattern), the
  swing line from projections, around-the-league ticker.
- Waiting stage: existing WaitingRoom mounted when stage === "waiting".
- Tests: render each stage from fixtures.

## Task 8 - Drawer surfaces
- surface-players.tsx: search + position chips, free-agent table (WK proj, ADP,
  rostered%, honest why-line), claim verb -> claim sheet. Replaces free-agents-board.
- surface-standings/trades/activity.tsx: mount StandingsTable / TradeInbox / ActivityFeed
  in drawer frame.

## Task 9 - Decision sheets
- lineup-fix-sheet.tsx, trade-sheet.tsx, claim-sheet.tsx per spec contracts, wired to the
  existing mutation routes through useLeagueRoomDeps().fetchJson. Tests with fixture deps
  covering commit paths and the multi-arm results (accept outcomes, waiverFiled).

## Task 10 - Rewire routes and delete
- page.tsx + players/standings/trades/activity pages render room-page with initialSurface;
  /team and /matchups/[week] keep their content (team page keeps LineupEditor +
  AdvisorPanel under room chrome via normal navigation).
- Delete league-home.tsx (+test), league-tabs.tsx, free-agents-board.tsx,
  week-slate-strip.tsx, matchup-slate.tsx, trade-inbox-link.tsx (+test). Fix stragglers.

## Task 11 - Verify and shoot
- Full typecheck, lint, league-room + league-service + touched vitest. Screenshots via
  scripts/lab-shot.ts into .superpowers/mocks/screenshots/ if the stack comes up.
