// Barrel surface: only names actually imported through `@/league-service` elsewhere in the
// repo. Everything else (types, `getLineup`, `isWeekLocked`, `leagueStandings`, and
// `writeSchedule` — whose only caller, `draft-service/commit.ts`, deliberately imports it
// from `@/league-service/schedule` directly so the draft's commit seam never pulls in this
// barrel, or `read.ts`'s import of `@/draft-service/teams` with it) is reached by importing
// the owning submodule directly.
export { createLeague } from "./creation";
export { createInvite, acceptInvite } from "./invites";
export { listLeaguesForUser, leagueHome, matchupWeek } from "./read";
export { setLineup, lineupView } from "./lineups";
export { createLeagueSchema, createInviteSchema, acceptInviteSchema, setLineupSchema, weekNumberSchema } from "./schemas";
