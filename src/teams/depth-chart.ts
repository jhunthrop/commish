import type { Position } from "@research-ts/domain/player";
import { TEAM_PAGE_CONFIG } from "./config";
import type { DatedDepthChart, DepthChartGroup, DepthChartSlot } from "./contract";

/**
 * TWO DEPTH CHARTS, ONE SHAPE (coordinator's section 5): the release's own week-one chart from the
 * observation store, and the harvest's current chart from the newest `tank01_depth_charts`
 * capture. Both are dated on the object because a depth chart is a claim about a moment.
 *
 * NOTHING IS INFERRED FROM AN ABSENCE, the same rule `depth-chart.ts` in the fact-sheet round keeps:
 * a position group the chart does not list is not rendered, and a chart with no offensive group at
 * all is `null`. The harvest payload is read defensively off `unknown` — a shape this module does
 * not recognise yields an empty chart, never a throw and never a guessed room.
 */

/** One listed player, as the caller joins him: his slot, his name, and the product id if resolved. */
export interface DepthListing {
  readonly position: Position;
  readonly slot: number;
  readonly name: string;
  readonly playerId: string | null;
}

const OFFENSIVE_GROUPS: readonly Position[] = TEAM_PAGE_CONFIG.depthChartPositions;

/** The harvest spells the kicker's group `PK`; the product spells the position `K`. */
const HARVEST_GROUP_KEYS: Readonly<Record<string, Position>> = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", PK: "K", K: "K" };

function groupsFor(listings: readonly DepthListing[]): readonly DepthChartGroup[] {
  return OFFENSIVE_GROUPS.flatMap((position) => {
    const slots: readonly DepthChartSlot[] = listings
      .filter((listing) => listing.position === position)
      // Slot ascending, then name, so a tie at one slot reads the same way on every run.
      .sort((a, b) => a.slot - b.slot || a.name.localeCompare(b.name))
      .slice(0, TEAM_PAGE_CONFIG.depthChartSlots)
      .map(({ slot, name, playerId }) => ({ slot, name, playerId }));
    return slots.length === 0 ? [] : [{ position, slots }];
  });
}

/** A dated chart from listings, or `null` when no offensive group is listed. */
export function depthChartFor(asOf: Date, listings: readonly DepthListing[]): DatedDepthChart | null {
  const groups = groupsFor(listings);
  return groups.length === 0 ? null : { asOf: asOf.toISOString().slice(0, 10), groups };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** "RB2" → 2; anything else → `null`. The slot is the trailing number of the feed's own label. */
function slotOf(depthPosition: string | null): number | null {
  const match = depthPosition === null ? null : /(\d+)$/.exec(depthPosition);
  return match === null ? null : Number(match[1]);
}

/** One team's listings out of a `tank01_depth_charts` payload: an array of clubs, each with a
 *  `depthChart` keyed by group, each group a list of `{ playerID, longName, depthPosition }`. */
export function harvestListingsFor(payload: unknown, code: string): readonly DepthListing[] {
  if (!Array.isArray(payload)) return [];
  const club = payload.map(asRecord).find((team) => asText(team.teamAbv) === code);
  if (club === undefined) return [];
  const chart = asRecord(club.depthChart);
  const listings: DepthListing[] = [];
  for (const [key, position] of Object.entries(HARVEST_GROUP_KEYS)) {
    const group = chart[key];
    if (!Array.isArray(group)) continue;
    for (const raw of group) {
      const entry = asRecord(raw);
      const name = asText(entry.longName);
      const slot = slotOf(asText(entry.depthPosition));
      if (name === null || slot === null) continue;
      listings.push({ position, slot, name, playerId: asText(entry.playerID) });
    }
  }
  return listings;
}
