import type { Position } from "@research/domain/player";
import type { PlayerFactsDepthChart, PlayerFactsDepthChartNeighbor } from "./types";

/**
 * HIS LISTED SLOT, AND WHO IS LISTED AROUND HIM (spec §4, fact 6; inventory row 6).
 *
 * A depth chart is the cleanest read there is on a role a season has not produced any play-by-play
 * for yet, and the sheet carried none of it: the board's own share facts all describe LAST season,
 * so a rookie who has just been listed first, or a veteran who has just been listed third, looked
 * identical on the page.
 *
 * DATED, ALWAYS. The observation's own `as_of` is the release instant, and it is printed, because
 * a depth chart is a claim about a moment and goes stale by design ("depth charts are current-only"
 * is the harvest's own word for the feed beside this one).
 *
 * THE NEIGHBOURS ARE HIS OWN TEAM AND HIS OWN POSITION, no wider. A running back listed second is
 * behind ONE man and that man's name is the fact; who the team's fourth receiver is says nothing
 * about him. `MAX_NEIGHBORS` keeps a deep position group from turning one line into a roster dump.
 *
 * NOTHING IS INFERRED FROM AN ABSENCE. A player the chart does not list gets `null`, never "off the
 * chart" or a slot behind the last man it does list: the chart not naming him is the release being
 * silent, which is not the same claim as the team having no place for him.
 */

const MAX_NEIGHBORS = 4;

/** One player's slot on one team's chart, as `collect-depth.ts` joins it: the observation's own
 *  value and stamp, plus the team and position the roster and the universe supply. */
export interface DepthRow {
  readonly playerId: string;
  readonly team: string;
  readonly position: Position;
  readonly slot: number;
  readonly season: number;
  readonly asOf: Date;
}

/** His own slot and the men listed around him, or `null` when the chart never named him. */
export function depthChartFor(playerId: string, team: string, position: Position, rows: readonly DepthRow[], names: ReadonlyMap<string, string>): PlayerFactsDepthChart | null {
  const mine = rows.find((row) => row.playerId === playerId && row.team === team && row.position === position);
  if (mine === undefined) return null;

  const aroundHim: PlayerFactsDepthChartNeighbor[] = rows
    .filter((row) => row.team === team && row.position === position && row.playerId !== playerId)
    // Slot ascending, then player id, so a tie at the same slot is broken the same way on every
    // run rather than by whatever order the database handed the rows back.
    .sort((a, b) => a.slot - b.slot || a.playerId.localeCompare(b.playerId))
    .slice(0, MAX_NEIGHBORS)
    .map((row) => ({ name: names.get(row.playerId) ?? row.playerId, slot: row.slot }));

  return { season: mine.season, asOf: mine.asOf.toISOString().slice(0, 10), slot: mine.slot, aroundHim };
}
