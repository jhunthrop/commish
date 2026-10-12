import type { ScoringRules } from "@research-ts/scoring/compute";
import { teamDefenseUniverseIds, TEAM_DEFENSE_UNIVERSE_PREFIX } from "../nflverse/team-codes";
import type { BoardCandidate } from "./board";
import { KICKER_ROSTER_POSITION, type KdefHistory } from "./kdef-history";
import { kickerCandidate, type KickerPriors, type KickerSeason } from "./kicker";
import type { PreseasonRosterRow } from "./store";
import { defenseCandidate, type DefensePriors } from "./team-defense";

/**
 * THE TWO CANDIDATE BUILDERS, ASSEMBLED (the 2026-09-05 kicker and team defence round).
 *
 * ONE BUILDER PER POSITION, AND THEY DO NOT SHARE A LOOP, because the two populations are found in
 * completely different places. A kicker is a person on a week-one roster, exactly like every skill
 * player, and is projected from his own record and his club's. A team defence is not a person at
 * all: there is no roster row for one and there never will be, so the population is the 32 synthetic
 * universe rows `crosswalk.ts`'s `seedTeamDefenseUniverse` writes, and the spec calls for exactly
 * this separation rather than a wider gate that could never match anything.
 *
 * A KICKER'S CLUB DECIDES HIS VOLUME AND HIS OWN RECORD DECIDES HIS RATES, so the two histories are
 * looked up separately and by different keys: his by player id, his club's by the team he is on for
 * the season being projected. That is the whole reason a kicker who changes clubs moves on this
 * board, and it is why the two lookups cannot be collapsed into one.
 */

export interface KdefCandidateOptions {
  readonly season: number;
  readonly roster: readonly PreseasonRosterRow[];
  readonly history: KdefHistory;
  readonly kicker: KickerPriors;
  readonly defence: DefensePriors;
  readonly rules: ScoringRules;
}

/** Every kicker on the week-one roster, projected. */
export function kickerCandidates(options: KdefCandidateOptions): readonly BoardCandidate[] {
  const ownByPlayer = new Map<string, KickerSeason[]>();
  const byTeam = new Map<string, KickerSeason[]>();
  for (const entry of options.history.kickerSeasons) {
    ownByPlayer.set(entry.playerId, [...(ownByPlayer.get(entry.playerId) ?? []), entry]);
    byTeam.set(entry.team, [...(byTeam.get(entry.team) ?? []), entry]);
  }

  return options.roster
    .filter((row) => row.position === KICKER_ROSTER_POSITION && row.status !== "off_roster")
    .map((row) => {
      // The roster's own team code is ALREADY the source's spelling: `preseason_rosters` is built
      // from `weekly_rosters` and the kicking archive from `stats_player`, both nflverse releases.
      // No translation here on purpose — a translation applied to a code already in the target
      // spelling is exactly where a silent mismatch gets introduced.
      const team = row.team;
      return kickerCandidate(
        {
          playerId: row.playerId,
          team,
          season: options.season,
          ownHistory: ownByPlayer.get(row.playerId) ?? [],
          teamHistory: byTeam.get(team) ?? [],
        },
        options.kicker,
      );
    })
    .sort((a, b) => a.playerId.localeCompare(b.playerId));
}

/** All 32 team defences, projected. The population is the universe rows, never a roster. */
export function defenceCandidates(options: KdefCandidateOptions): readonly BoardCandidate[] {
  const byTeam = new Map<string, KdefHistory["defenseGames"][number][]>();
  for (const game of options.history.defenseGames) {
    byTeam.set(game.team, [...(byTeam.get(game.team) ?? []), game]);
  }
  return teamDefenseUniverseIds()
    .map((universeId) => universeId.slice(TEAM_DEFENSE_UNIVERSE_PREFIX.length))
    .map((team) =>
      defenseCandidate({ team, season: options.season, history: byTeam.get(team) ?? [] }, options.defence, options.rules),
    )
    .sort((a, b) => a.playerId.localeCompare(b.playerId));
}

/** Both positions together, in one deterministic order. */
export function kdefCandidates(options: KdefCandidateOptions): readonly BoardCandidate[] {
  return [...kickerCandidates(options), ...defenceCandidates(options)].sort((a, b) =>
    a.playerId.localeCompare(b.playerId),
  );
}
