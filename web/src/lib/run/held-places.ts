/** Where a page places a player beside the injury capture (Lane 63): a player on a season-long list
 * is never given the rank, the position rank or the tier his figure would earn. Every page that prints
 * one of those from the run's board rows reads it here: the players index, the clubs index's lead, a
 * player's tier mates, the offline board and the compare page. */
import { rankWord } from '#lib/format/designation.ts';
import { heldOut } from './board-status.ts';
import { tierGroups, type TierGroup } from './derive.ts';
import type { BoardRow, PlayerStatus } from './schema.ts';

interface Listed {
	status?: PlayerStatus;
}

/** The word a held player's ranks show as ("IR"), null for anyone else. */
export function heldWord(row: Listed): string | null {
	return row.status?.seasonLong === true ? rankWord(row.status.status) : null;
}

/** His place on the board as a page prints it: our rank, or the word. */
export function rankShown(row: Listed & { ourRank: number }): string {
	return heldWord(row) ?? String(row.ourRank);
}

/** His place at his position as a pill prints it: the number, or the word. */
export function positionRankShown(row: Listed & { positionRank: number }): number | string {
	return heldWord(row) ?? row.positionRank;
}

/** The first player a list leads with who is not on a season-long list, null with none. */
export function leadOf<R extends Listed>(rows: readonly R[]): R | null {
	return rows.find((row) => !heldOut(row)) ?? null;
}

/** A player's tier among the available players at his position, the board's position-view rule: a
 * held player is neither a mate nor part of a tier's cliff. Null for a held player himself, who has
 * no tier (his page says so). */
export function availableTierOf<R extends BoardRow & Listed>(
	rows: readonly R[],
	player: R
): TierGroup<R> | null {
	if (heldOut(player)) return null;
	const group = tierGroups(rows, player.position, heldOut).find((g) => g.tier === player.tier);
	if (!group) throw new Error(`${player.name} is in no tier of his position.`);
	return group;
}

/** A league row's pill rank from his said status (run/status-view.ts): the word for a season-long
 * status, his position rank otherwise. */
export function pillRank(
	status: { rank: string | null } | null,
	positionRank: number
): number | string {
	return status?.rank ?? positionRank;
}
