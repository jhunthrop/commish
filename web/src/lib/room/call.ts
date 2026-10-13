/** Our call as the room shows it: the player, the one big number, the runner-up for the sentence, and
 * where the odds come from. Read off the card the API recorded for the turn. */
import { lastName, oddsWords, pickLabel } from '#lib/format/draft.ts';
import { signed } from '#lib/format/number.ts';
import { firstSentence } from '#lib/format/sentence.ts';
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
export function poolBasis(
	board: Board,
	card: RoomCard | null,
	teams: number,
	callMissing = false
): string {
	return `${board.basis} ${oddsBasis(card, teams, callMissing)}`;
}

function oddsBasis(card: RoomCard | null, teams: number, callMissing: boolean): string {
	if (card === null && callMissing) return 'No odds for this pick.';
	if (card === null) return 'The odds land with our call.';
	const to = card.next_pick === null ? 'your last pick' : pickLabel(card.next_pick, teams);
	if (card.source === 'advisor') {
		return `Odds to ${to} from where drafters take each player and how far they stray from it.`;
	}
	return `Odds to ${to} from ${card.runs} runs of this room, every seat drafting the way it has so far.`;
}

/** The runner-up's sentence, his name in bold and the rest after it. */
export interface RunnerWords {
	name: string;
	rest: string;
}

/** A contrast ("but he is still there...") is drawn only when the odds back it: the runner-up on one
 * side of even and the call on the other. Otherwise both numbers are given plainly. */
const EVEN = 0.5;

/**
 * The runner-up in a sentence, or null when there is none to compare. On your clock the call is the
 * player who will not last, so the contrast is the runner-up lasting while the call does not. Off it
 * (a conditional call) the odds are of reaching your pick, so the contrast is the runner-up not
 * reaching it while the call does. Every sentence names both numbers.
 */
export function runnerWords(view: CallView): RunnerWords | null {
	const { runner, runnerOdds, odds, player } = view;
	if (!runner || runnerOdds === null || odds === null) return null;
	const more = `has more over replacement at ${signed(runner.vor ?? 0)}`;
	const call = lastName(player.name);
	if (view.conditional) {
		const at = view.forLabel;
		if (runnerOdds < EVEN && odds >= EVEN) {
			return {
				name: runner.name,
				rest: `${more}, but he reaches ${at} only ${oddsWords(runnerOdds)} of the time. ${call} reaches it ${oddsWords(odds)} of the time.`
			};
		}
		return {
			name: runner.name,
			rest: `${more}. He reaches ${at} ${oddsWords(runnerOdds)} of the time, ${call} ${oddsWords(odds)}.`
		};
	}
	if (view.nextLabel === null) return null;
	const at = view.nextLabel;
	if (runnerOdds >= EVEN && odds < EVEN) {
		return {
			name: runner.name,
			rest: `${more}, but he is still there at ${at} ${oddsWords(runnerOdds)} of the time. ${call} is there ${oddsWords(odds)} of the time.`
		};
	}
	return {
		name: runner.name,
		rest: `${more}. He is there at ${at} ${oddsWords(runnerOdds)} of the time, ${call} ${oddsWords(odds)}.`
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
		odds: null,
		runner: null,
		runnerOdds: null,
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
	// The reason alone: the odds after it are the call's own big figure.
	const first = card.shortlist[0]?.why;
	const why = first ? firstSentence(first) : null;
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
