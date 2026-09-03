# The League Room: one stage, following the clock

Date: 2026-09-02
Status: founder-approved direction (six blueprint mocks in .superpowers/mocks/ plus the
canvas annotations, which carry the laws verbatim)
Owner: league-room
Branch: worktree-league-room

## The three laws (binding)

1. ONE STAGE, FOLLOWING THE CLOCK. The room is the league home URL. What the stage renders
   is decided by an explicit priority function, not vibes: live matchup > unlocked lineup
   problem near lock > pending trade action > standings pulse. The priority function is a
   pure, unit-tested function over data the page already loads. Wrong-stage is worse than
   tabs.
2. THE ROUTE RULE. The drawer's four surfaces (PLAYERS / STANDINGS / TRADES / ACTIVITY)
   have three heights: chip row, half drawer over the room, full height. Full height IS the
   route: /app/leagues/[leagueId]/players|standings|trades|activity render the same surface
   components at full height with room chrome persisting; deep links land there; back/esc
   collapses to the room. Keyboard: space toggles the drawer, / opens players search, esc
   collapses everything. One expanded surface at a time.
3. DECISION SHEETS, NOT PAGES. Every attention card is a finished diagnosis whose verb opens
   a decision sheet: the lineup fix, the trade sheet, the claim sheet. Esc backs out;
   nothing commits until the one amber verb.

## The priority function (exact)

Pure module `src/league-room/lib/stage-priority.ts` (the repo's ladder idiom:
src/league/next-action.ts):

```
type StageKind = "waiting" | "live" | "attention" | "pulse";

interface StageInput {
  draftComplete: boolean;        // home.draftStatus === "complete"
  hasDraftSchedule: boolean;     // home.draftSchedule !== null
  weekStatus: WeekStatus;        // home.weekStatus (stat_weeks)
  hasMyMatchup: boolean;         // myMatchup !== null for currentWeek
  lineupProblemCount: number;    // from lineup-problems.ts, unlocked slots only
  actionableTradeCount: number;  // open inbox trades addressed to me
}
```

Ordering, first match wins, flat early returns:

1. `waiting` when `!draftComplete && hasDraftSchedule` (preserves the existing
   WaitingRoom/DraftSchedulePanel alternate stage state exactly as today).
2. `live` when `weekStatus === "in_progress" && hasMyMatchup`. The product's own
   definition of live is the stat_weeks status; the room does not invent a second clock.
3. `attention` when `lineupProblemCount + actionableTradeCount > 0`.
4. `pulse` otherwise.

A filed waiver claim is a notice, never an attention card: it needs nothing from the user,
so it can never lift the stage (it rides below the cards and in the week strip).

Attention cards extend the stage's own precedence: lineup problems always lead (they decay
to zero points at kickoff; a trade can wait until its own deadline), ranked by severity
(empty slot > bye > OUT designation, ties by slot order); trades follow, soonest expiresAt
first, no deadline last. This is the mocks' own dealing order (the amber-bordered lineup
card above the Friday-expiring trade). Pure, in `stage-priority.ts`
(`compareAttentionCards`) and `lineup-problems.ts`.

## The drawer state machine (exact)

Pure module `src/league-room/lib/drawer-state.ts`:

```
type DrawerSurface = "players" | "standings" | "trades" | "activity";
type DrawerHeight = "chip" | "half" | "full";
type DrawerState = { surface: DrawerSurface | null; height: DrawerHeight };
```

Invariant: `surface === null` iff `height === "chip"`. One expanded surface at a time.

Events (reducer, pure):
- `chipTap(s)`: closed -> half on s; same surface at half/full -> chip; different
  surface -> switch surface, keep height.
- `expand`: half -> full (the shell then pushes the sub-route URL).
- `space`: chip <-> half on the last-used surface (players when none yet); full -> half.
- `slash`: players at half (full players stays full), shell focuses search.
- `esc`: full -> half, half -> chip (one step down; the sheet layer above consumes esc
  first).
- `routeSync(surface | null)`: pathname is authority — sub-route -> full on that surface;
  room path while at full -> half (the esc/back walk-down); room path otherwise -> keep.

URL integration: full height is the route. The shell uses the Next 15 native
`window.history.pushState` integration (shallow — no server round trip, no remount) when
expanding to full or leaving it, so the drawer animates in place while the URL is honest.
Deep links and reloads hit the real sub-route pages, which server-render the same RoomShell
with the drawer already full. Back button fires popstate -> usePathname change ->
`routeSync`. Esc from full does `history.pushState(room)` + `esc`.

## Decision sheets (contracts)

Rendered by a NEW shared primitive `src/components/ui/decision-sheet.tsx` (dialog, focus
trap, esc closes, amber border, one filled amber verb per sheet — existing Modal is not
modified; parallel build owns it).

- LINEUP FIX (`lineup-fix-sheet.tsx`): headline names the broken slot and why (bye / OUT /
  empty). Recommended start leads: highest current-week projection among eligible bench
  players, evidence line = projection + fixture ("plays Sun 1:00p vs MIN"), delta vs the
  current occupant's projection (0 for a hole). Remaining eligible bench one line each.
  Projected team total before -> after (sum of starters' week projections). Commit: PUT
  /api/leagues/[id]/teams/me/lineup with starting slots. Candidate ranking + totals in pure
  `src/league-room/lib/lineup-problems.ts`.
- TRADE SHEET (`trade-sheet.tsx`): both sides listed with per-player current-week
  projection and the existing trade assessment's side values (generic value chips, no law
  names); roster depth bars per position before/after (pure `trade-math.ts`); byes checked
  via the new `byeWeeksByTeam` read (calls out a new uncovered bye week, or says both sides
  share one). DECLINE / COUNTER / ACCEPT — ACCEPT is the filled amber verb and must handle
  all three accept outcomes (executed / under_review / held). COUNTER closes the sheet into
  the trades surface composer. Commits: POST /trades/[tradeId] {action}.
- CLAIM SHEET (`claim-sheet.tsx`): opened from a players-surface claim verb. Drop
  pre-filled with my lowest-projected bench player (current-week projection, ADP
  tie-break; pure `claim-drop.ts`), swappable; states the waiver clear time
  (onWaiversUntil) or that the add is immediate; SUBMIT CLAIM posts /claims
  {addPlayerId, dropPlayerId} and renders both success arms (added vs waiverFiled with
  clearsAt).

## Honest capability audit (mock figure -> what ships)

The services provide: current-week per-player projections (can be empty on a stale
snapshot), per-player live points via matchupWeek (worker-tick freshness), team-score SSE,
fixture labels + byes (absent team = bye), injury designations, standings, trades inbox
with assessment values, activity rows, free agents with onWaiversUntil. They do NOT
provide: rest-of-season or per-week forward splits, projected finals, win probability,
scouting prose.

- "projected to finish +6.5" (SundayLive): DROPPED. No projected finals exist. The score
  block shows the live margin and yet-to-play counts (matchup-facts helpers).
- "ROS PTS 118.4" (players surface) and "61.2 rest of season" (claim sheet): REPLACED by
  current-week projection + ADP. No ROS totals exist.
- "248.3 rest of season / 15.1 per week" (trade sheet): REPLACED by current-week
  projection per player + the assessment's side values (the number the service already
  computes).
- "WHY HIM" scouting lines ("Lead-back snaps two weeks running"): REPLACED by honest
  facts: waiver state + clear time, injury designation, this-week fixture, ADP.
- "Their QB is questionable" (pulse): KEPT — injuryDesignations covers it.
- "THE SWING" (SundayLive): KEPT, computed from yet-to-play starters' current-week
  projections on both sides (largest projected gap pairing); omitted when the projections
  map is empty.
- "waivers clear Wed 3:00 AM" (week strip): no league-wide clear instant exists; a filed
  claim's own clearsAt shows on its notice row. Strip copy states "lineups lock at
  kickoff" (per-player locks are the real rule).
- "projected 124.8 to 121.2" (next-matchup pulse): KEPT — sum of both sides' starters'
  current-week projections; omitted when the map is empty.
- "FITS MY BYES" filter chip: CUT this round (position filters + search ship).
- Win probability: never rendered anywhere.

## New service reads (src/league-service, 100% coverage, DB-backed tests)

1. `byeWeeksByTeam(db): Promise<ReadonlyMap<string, number>>` in nfl-schedule.ts — the
   week in the regular-season range where an NFL team has no game. Powers the trade
   sheet's bye check.
2. `pendingWaiverClaims(db, leagueId, teamId)` in claims.ts — my pending claims with
   player name, clearsAt, and queue position (rank by the processWaivers ordering:
   teams.waiverPriority ASC, createdAt ASC among pending claims for the same player).
   Powers the claim notice row ("2nd in line - clears Wed").

leagueHome keeps its pinned 12-query budget; all new data is sibling calls composed in
`src/app/app/(shell)/leagues/[leagueId]/room-data.ts` (server helper next to the pages,
outside the client-boundary-ruled room dir).

## Component map

New (src/league-room/components unless noted, each file well under 800 lines):
- room-shell.tsx (client orchestrator: keyboard, drawer machine, sheet layer, layout)
- week-strip.tsx (league name, week chip + status, my rank/record, needs-you chip, live
  pill)
- roster-spine.tsx (44px position rail: projections, BYE, OUT, live ticks; links /team)
- stage-attention.tsx (resting: NEEDS YOU cards + claim notice + THE LEAGUE THIS WEEK
  pulse row: standings pulse, next matchup, since you left)
- stage-live.tsx (score block with margin protagonist, head-to-head starters with live
  points, the swing line, around-the-league ticker)
- room-drawer.tsx (chip row, half/full container, mobile bottom tab bar projection)
- surface-players.tsx (draft-pool-density free agent table, search, position chips, claim
  verbs -> claim sheet; replaces free-agents-board)
- surface-standings.tsx / surface-trades.tsx / surface-activity.tsx (thin wrappers that
  mount StandingsTable / TradeInbox / ActivityFeed at drawer heights)
- lineup-fix-sheet.tsx, trade-sheet.tsx, claim-sheet.tsx (decision sheets)
- src/components/ui/decision-sheet.tsx (NEW shared primitive; existing primitives
  untouched)

New pure logic (src/league-room/lib, unit-tested):
- stage-priority.ts (the priority function + card ranking)
- drawer-state.ts (the reducer above)
- lineup-problems.ts (problem detection, candidate ranking, before/after totals)
- trade-math.ts (depth bars before/after, bye check, per-player pricing rows)
- claim-drop.ts (lowest-projected bench ranking)

Server composition: room-data.ts + room-page.tsx beside the pages; the room page and the
four surface pages all render RoomShell (players/standings/trades/activity with
initialSurface set); membership 404 predicate unchanged on every page.

## Kept vs deleted

Kept working as today: WaitingRoom + DraftSchedulePanel (waiting stage state), /team
(LineupEditor + AdvisorPanel), /matchups/[week] (LiveMatchupWeek), players/[playerId],
LeagueChat + terms/members/invite/moderation rail (judgment call: the mocks omit the rail
but nothing in the room supersedes chat/invite/governance; they keep a narrow right rail
at xl and stack below the stage under it), StandingsTable, TradeInbox family, ActivityFeed,
MatchupCelebration, matchup-hero/panel/strip (matchups route), player-peek.

Deleted completely: league-home.tsx (+ test; replaced by the room), league-tabs.tsx
(chips/routes supersede tabs), free-agents-board.tsx (players surface supersedes),
week-slate-strip.tsx and matchup-slate.tsx (around-the-league ticker and the live stage
supersede; both single-consumer), trade-inbox-link.tsx (+ test; already dead).

## Test plan

- Pure: stage-priority, drawer-state, lineup-problems, trade-math, claim-drop — exhaustive
  unit tests, BASE-fixture + one-override idiom.
- Service: byeWeeksByTeam, pendingWaiverClaims — DB-backed tests (coverage gate).
- Components: renderSurface both-themes + axe for the new surfaces and sheets; DI via
  LeagueRoomDepsProvider fixtures for anything fetching; class-string assertions only
  where a design law is the point.
- No full e2e; screenshots via scripts/lab-shot.ts at the end if the stack is up.
