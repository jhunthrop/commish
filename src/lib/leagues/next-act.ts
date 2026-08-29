import { nextAction, type NextActionKind } from "@/league";
import type { LeagueHomeBody, LineupBody } from "@/league-room/contract";
import { actionHref } from "@/league-room/lib/action-href";

/**
 * The one act a league is waiting on, with the words that go on the button and the place the
 * button lands — the shape a lower third's verb takes (Sunday v5, law 6).
 *
 * `null` is a real answer: a league with nothing pending renders no verb at all rather than a
 * disabled one. That is law 6's own diagnostic — *"if a screen has no lower third, either it needs
 * no decision, or the decision is hidden"* — spent on the verb rather than on the whole strip.
 */
export interface LeagueAct {
  /** Which act it is, for a caller that needs to branch on the act itself rather than render it —
   *  the league home promotes its lineup editor on `fix-lineup` and nothing else. */
  readonly kind: Exclude<NextActionKind, "none">;
  readonly label: string;
  readonly href: string;
}

/**
 * WHY THIS LIVES IN `src/lib` AND NOT IN THE ROOM. `nextAction` is a value import from `@/league`,
 * which `src/league-room/**` is forbidden (`eslint.config.mjs`'s client-boundary rule) — a room is
 * browser code by construction. Three server pages now need the identical answer (the league home,
 * the matchup week, the trade inbox), so the assembly lives here once instead of as three copies
 * of the same ten lines drifting apart about what "lineup set" means.
 *
 * `lineupSet`'s input is an approximation and it is stated plainly, carried verbatim from the
 * league home page that first made it: `crossLeagueHome`'s own `lineupSet` reads a real
 * `notExists(lineup_slots WHERE teamId AND weekNumber)` query these single-league reads do not run,
 * so this reads the SAME signal `LineupBody` already carries instead — every starter slot filled.
 * The two can disagree only when a `lineup_slots` row exists but leaves a slot empty on purpose, a
 * real state that `fix-lineup`'s own copy describes just as honestly. Only the fix-lineup/set-lineup
 * boundary can move, and both land on the same editor.
 *
 * A page with no lineup read at all passes `null` and gets the same treatment a manager with no
 * team gets: the lineup branches simply do not fire.
 */
export function leagueAct(home: LeagueHomeBody, lineup: LineupBody | null): LeagueAct | null {
  const lineupSet = lineup === null || lineup.starters.every((slot) => slot.playerId !== null);
  const action = nextAction({
    isCommissioner: home.isCommissioner,
    filledTeams: home.teams.length,
    teamCount: home.teamCount,
    myTeamId: home.myTeamId,
    draftStatus: home.draftStatus,
    weekStatus: home.weekStatus,
    lineupSet,
  });
  if (action === null) return null;
  // `actionHref` is the one place a next-action's destination is decided, shared with the leagues
  // board so the two can never send a manager to different pages for the same act.
  return { kind: action.kind, label: action.label, href: actionHref({ id: home.leagueId, draftId: home.draftId, nextAction: action }) };
}
