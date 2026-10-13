/** Our call as the room shows it: the player, the one big number, the runner-up for the sentence, and
 * where the odds come from. Read off the card the API recorded for the turn. */
import { pickLabel } from '#lib/format/draft.ts';
import type { RoomCard } from './api.ts';
import type { Board, RoomPlayer } from './model.ts';

export interface CallView {
	player: RoomPlayer;
	/** The call's chance: of lasting to your next pick, or on a conditional card of reaching yours. */
	odds: number | null;
	/** The best player left by points over replacement when it is not the call. */
	runner: RoomPlayer | null;
	runnerOdds: number | null;
	/** The pick the call is for, "5.08". */
	forLabel: string;
	/** The pick the odds look to, "6.05", null at your last pick. */
	nextLabel: string | null;
	conditional: boolean;
	/** The advisor's sentence for him, when the advisor made the card. */
	why: string | null;
}

/** The pool's basis, printed over it: whose points rank it, on which board, and where the odds come
 * from. Every number names its basis in the same view. */
export function poolBasis(board: Board, card: RoomCard | null, teams: number): string {
	return `${board.basis} ${oddsBasis(card, teams)}`;
}

function oddsBasis(card: RoomCard | null, teams: number): string {
	if (card === null) return 'The odds land with our call.';
	const to = card.next_pick === null ? 'your last pick' : pickLabel(card.next_pick, teams);
	if (card.source === 'advisor') {
		return `Odds to ${to} from where drafters take each player and how far they stray from it.`;
	}
	return `Odds to ${to} from ${card.runs} runs of this room, every seat drafting the way it has so far.`;
}

export function callView(
	card: RoomCard,
	board: Board,
	drafted: ReadonlySet<string>,
	teams: number
): CallView | null {
	const player = board.byId.get(card.call);
	if (!player) return null;
	const best = board.players
		.filter((p) => !drafted.has(p.id) && p.vor !== null)
		.reduce<RoomPlayer | null>(
			(top, p) => (top === null || (p.vor ?? 0) > (top.vor ?? 0) ? p : top),
			null
		);
	const runner = best && best.id !== player.id && (best.vor ?? 0) > (player.vor ?? 0) ? best : null;
	const why = card.shortlist[0]?.why ?? null;
	return {
		player,
		odds: card.still_there[player.id] ?? null,
		runner,
		runnerOdds: runner ? (card.still_there[runner.id] ?? null) : null,
		forLabel: pickLabel(card.for_pick, teams),
		nextLabel: card.next_pick === null ? null : pickLabel(card.next_pick, teams),
		conditional: card.conditional,
		why
	};
}
