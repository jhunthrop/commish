/** Our call as the room shows it: the player, the one big number, the runner-up for the sentence, and
 * where the chances come from. Read off the card the API recorded for the turn. */
import { lastName, chanceWords, pickLabel } from '#lib/format/draft.ts';
import { signed } from '#lib/format/number.ts';
import { firstSentence } from '#lib/format/sentence.ts';
import type { RoomCard } from './api.ts';
import type { Board, RoomPlayer } from './model.ts';

export interface CallView {
	player: RoomPlayer;
	/** The call's chance: of lasting to your next pick, or on a conditional card of reaching yours. */
	chance: number | null;
	/** The best player left by points over replacement when it is not the call. */
	runner: RoomPlayer | null;
	runnerChance: number | null;
	/** The pick the call is for, "5.08". */
	forLabel: string;
	/** The pick the chances look to, "6.05", null at your last pick. */
	nextLabel: string | null;
	conditional: boolean;
	/** The advisor's sentence for him, when the advisor made the card. */
	why: string | null;
}

/** The pool's basis, printed over it: whose points rank it, on which board, and where the chance come
 * from. Every number names its basis in the same view. */
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
		return `Still there at ${to} is read from where drafters take each player and how far they stray from it.`;
	}
	return `Still there at ${to} is read from ${card.runs} runs of this room, every seat drafting the way it has so far.`;
}

/** The runner-up's sentence, his name in bold and the rest after it. */
export interface RunnerWords {
	name: string;
	rest: string;
}

/** A contrast ("but he is still there...") is drawn only when the chances back it: the runner-up on one
 * side of even and the call on the other. Otherwise both numbers are given plainly. */
const EVEN = 0.5;

/**
 * The runner-up in a sentence, or null when there is none to compare. On your clock the call is the
 * player who will not last, so the contrast is the runner-up lasting while the call does not. Off it
 * (a conditional call) the chances are of reaching your pick, so the contrast is the runner-up not
 * reaching it while the call does. Every sentence names both numbers.
 */
export function runnerWords(view: CallView): RunnerWords | null {
	const { runner, runnerChance, chance, player } = view;
	if (!runner || runnerChance === null || chance === null) return null;
	const more = `has more over replacement at ${signed(runner.vor ?? 0)}`;
	const call = lastName(player.name);
	if (view.conditional) {
		const at = view.forLabel;
		if (runnerChance < EVEN && chance >= EVEN) {
			return {
				name: runner.name,
				rest: `${more}, but he reaches ${at} only ${chanceWords(runnerChance)} of the time. ${call} reaches it ${chanceWords(chance)} of the time.`
			};
		}
		return {
			name: runner.name,
			rest: `${more}. He reaches ${at} ${chanceWords(runnerChance)} of the time, ${call} ${chanceWords(chance)}.`
		};
	}
	if (view.nextLabel === null) return null;
	const at = view.nextLabel;
	if (runnerChance >= EVEN && chance < EVEN) {
		return {
			name: runner.name,
			rest: `${more}, but he is still there at ${at} ${chanceWords(runnerChance)} of the time. ${call} is there ${chanceWords(chance)} of the time.`
		};
	}
	return {
		name: runner.name,
		rest: `${more}. He is there at ${at} ${chanceWords(runnerChance)} of the time, ${call} ${chanceWords(chance)}.`
	};
}

/** The frame the call panel holds before the first card of a room has come: the best player left by
 * points over replacement, with no numbers. It is only ever drawn as the reading skeleton, so it
 * shapes the panel and says nothing. */
export function frameView(
	board: Board,
	drafted: ReadonlySet<string>,
	teams: number,
	pick: number
): CallView | null {
	const player = board.players.find((p) => !drafted.has(p.id));
	if (!player) return null;
	return {
		player,
		chance: null,
		runner: null,
		runnerChance: null,
		forLabel: pickLabel(pick, teams),
		nextLabel: null,
		conditional: false,
		why: null
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
	const best = board.players
		.filter((p) => !drafted.has(p.id) && p.vor !== null)
		.reduce<RoomPlayer | null>(
			(top, p) => (top === null || (p.vor ?? 0) > (top.vor ?? 0) ? p : top),
			null
		);
	const runner = best && best.id !== player.id && (best.vor ?? 0) > (player.vor ?? 0) ? best : null;
	// The reason alone: the chances after it are the call's own big figure.
	const first = card.shortlist[0]?.why;
	const why = first ? firstSentence(first) : null;
	return {
		player,
		chance: card.still_there[player.id] ?? null,
		runner,
		runnerChance: runner ? (card.still_there[runner.id] ?? null) : null,
		forLabel: pickLabel(card.for_pick, teams),
		nextLabel: card.next_pick === null ? null : pickLabel(card.next_pick, teams),
		conditional: card.conditional,
		why
	};
}
