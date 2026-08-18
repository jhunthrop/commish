export { createLeague, type LeagueWriteDeps, type CreateLeagueInput, type CreateLeagueResult } from "./creation";
export {
  createInvite, acceptInvite,
  type InviteDeps, type CreateInviteInput, type CreateInviteResult, type AcceptInviteInput, type AcceptInviteResult,
} from "./invites";
export { listLeaguesForUser, leagueHome, matchupWeek } from "./read";
// `writeSchedule` is exported here for completeness; `draft-service/commit.ts` imports it from
// `@/league-service/schedule` DIRECTLY, so the draft's commit seam never pulls in this barrel
// (and with it `read.ts`'s import of `@/draft-service/teams`).
export { writeSchedule, type WriteScheduleInput, type WrittenScheduleCounts } from "./schedule";
export {
  getLineup, isWeekLocked, setLineup, lineupView,
  type GetLineupInput, type LineupSlotInput, type SetLineupInput, type SetLineupResult,
} from "./lineups";
export { scoreWeek, leagueStandings, type ScoreWeekResult } from "./results";
export {
  createLeagueSchema, createInviteSchema, acceptInviteSchema, setLineupSchema, type CreateLeagueRequest,
} from "./schemas";
