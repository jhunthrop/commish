/**
 * The draft room's name lookups now live in the shared display module — the league room
 * needs the identical `teamsById`/`playersById`/`teamName`/`playerName` pattern, and two
 * copies of it was the DRY violation this re-export closes. `queueButtonLabel` stays here:
 * it is draft-room-only vocabulary (the pool's star and the dock's chips share its phrasing).
 */
import type { DraftFormat } from "@/domain/league";

export { teamsById, playersById, teamName, playerName } from "@/lib/display/lookups";

export function queueButtonLabel(name: string, queued: boolean): string {
  return queued ? `Remove ${name} from your queue` : `Queue ${name}`;
}

/**
 * "Draft" for snake, "Nominate" for auction — the SAME word `SnakeRoom`/`AuctionRoom` hand
 * `PlayerPool` as `actionLabel`, decided in exactly one place so `RoomTour`'s own copy (which
 * names this button so a first-timer knows what to click) can never quietly drift from the
 * real button text.
 */
export function actionLabelFor(format: DraftFormat): string {
  return format === "auction" ? "Nominate" : "Draft";
}
