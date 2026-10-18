/** Our call as the room shows it (Lane 66o): our top three as rows, the call first, each with the
 * chance the card recorded for him, and the column heads and basis that name what the chance is of.
 * Read off the card the API recorded for the turn. */
import { pickLabel } from '#lib/format/draft.ts';
import type { Position } from '#lib/types/player.ts';
import type { CallRow } from '#lib/types/room.ts';
import type { RoomCard } from './api.ts';
import type { Board, RoomPlayer } from './model.ts';

/** The call card's rows: the call and the next two of our shortlist. */
const CALL_ROWS = 3;

export interface CallView {
	/** The player we would take. */
	player: RoomPlayer;
	/** The call first, then the next two of the shortlist still in the pool. */
	rows: readonly CallRow[];
	/** The pick the call is for, "5.08". */
	forLabel: string;
	/** The pick the chances look to, "6.05", null at your last pick. */
	nextLabel: string | null;
	conditional: boolean;
}

/** The pool's basis, printed over it: whose points rank it, on which board, and where the chances come
 * from. Every number on the call card and the pool names its basis here, once. */
export function poolBasis(
	board: Board,
	card: RoomCard | null,
	teams: number,
	callMissing = false
): string {
	return `${board.basis} ${stillThereBasis(card, teams, callMissing)}`;
}

function stillThereBasis(card: RoomCard | null, teams: number, callMissing: boolean): string {
	if (card === null && callMissing) return 'No call for this pick.';
	if (card === null) return 'Still there lands with our call.';
	const to = card.next_pick === null ? 'your last pick' : pickLabel(card.next_pick, teams);
	if (card.source === 'advisor') {
		return `Still there at ${to}: where drafters take each player and how far they stray from it.`;
	}
	return `Still there at ${to}: ${String(card.runs)} runs of this room, each seat drafting as it has so far.`;
}

/** The chance column's head: "Still there 6.05" on your clock, "Reaches 5.08" on a call that waits on
 * the board, none at your last pick. */
export function chanceHead(view: CallView): string | null {
	if (view.conditional) return `Reaches ${view.forLabel}`;
	return view.nextLabel === null ? null : `Still there ${view.nextLabel}`;
}

/** The call's one verb, of the player in the row: "Draft him", or "Draft them" for a defense. */
export function draftWords(position: Position, verb = 'Draft'): string {
	return `${verb} ${position === 'DST' ? 'them' : 'him'}`;
}

function rowOf(player: RoomPlayer, chance: number | undefined): CallRow {
	return {
		player,
		vor: player.vor,
		adp: player.adp,
		chance: chance ?? null
	};
}

/** The frame the call panel holds before the first card of a room has come: the best players left by
 * points over replacement, with no chances. It is only ever drawn as the reading skeleton, so it
 * shapes the panel and says nothing. */
export function frameView(
	board: Board,
	drafted: ReadonlySet<string>,
	teams: number,
	pick: number
): CallView | null {
	const left = board.players
		.filter((p) => !drafted.has(p.id) && p.vor !== null)
		.sort((a, b) => (b.vor ?? 0) - (a.vor ?? 0))
		.slice(0, CALL_ROWS);
	const player = left[0];
	if (!player) return null;
	return {
		player,
		rows: left.map((p) => rowOf(p, undefined)),
		forLabel: pickLabel(pick, teams),
		nextLabel: null,
		conditional: false
	};
}

export function callView(
	card: RoomCard,
	board: Board,
	drafted: ReadonlySet<string>,
	teams: number
): CallView | null {
	const player = board.byId.get(card.call);
	if (!player) return null;
	const rest = card.shortlist
		.map((c) => board.byId.get(c.player_id))
		.filter((p): p is RoomPlayer => p !== undefined && p.id !== player.id && !drafted.has(p.id))
		.slice(0, CALL_ROWS - 1);
	return {
		player,
		rows: [player, ...rest].map((p) => rowOf(p, card.still_there[p.id])),
		forLabel: pickLabel(card.for_pick, teams),
		nextLabel: card.next_pick === null ? null : pickLabel(card.next_pick, teams),
		conditional: card.conditional
	};
}
