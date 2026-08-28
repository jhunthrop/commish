import type { Player } from "@/domain/player";
import type { MatchupLineupEntry } from "../contract";

/**
 * One roster slot's occupant as a domain `Player`, or `null` for an empty slot.
 *
 * LAW 3 NEEDS A WHOLE OBJECT, NOT FIVE LOOSE FIELDS. `PlayerFace` and `PlayerRow` both take a
 * `Player` because the face, the club colour and the position sticker are one thing a manager
 * recognises, not three props a call site assembles differently on each of five surfaces. The
 * wire carries the parts (`MatchupLineupEntry`, widened for exactly this) and this is the one
 * place they become the object, so the matchup page, the trade room and the lineup editor can
 * never disagree about how a slot turns into a player.
 *
 * `playerId` is the field that decides. A slot with no player has no name, no club and no face,
 * and `null` here is what lets every caller write one guard instead of four — a slot can be empty
 * and that is an ordinary state, not a missing value to paper over. Every other field falls back
 * to something honest for the never-observed case where an id resolved to no `players` row:
 * an empty name, no club (`PlayerFace` renders the bare face rather than a grey rectangle
 * pretending to be somebody's colours), no headshot, no ADP.
 *
 * `position` is the one field with no honest fallback — a `Position` is a closed union and there
 * is no "unknown" member — so an entry carrying a player id with no position resolves to `null`
 * here too, and the caller renders the slot the same way it renders an empty one. That case
 * cannot arise from `matchupWeek`, which reads both fields off the same row; the guard exists so
 * the type is honest rather than asserted past.
 */
export function playerOf(entry: MatchupLineupEntry): Player | null {
  if (entry.playerId === null || entry.position === null) return null;
  return {
    id: entry.playerId,
    name: entry.playerName ?? "",
    position: entry.position,
    nflTeam: entry.nflTeam ?? "",
    headshotUrl: entry.headshotUrl,
    adp: entry.adp,
  };
}
