/** Our call between two players, said one way wherever it is printed: the compare page and the
 * system page's specimen both read it from here. */
import { lastName } from '#lib/format/draft.ts';
import { designationWord, type DesignationStatus } from '#lib/format/designation.ts';
import { fixed, plural } from '#lib/format/number.ts';

/** What the call needs about each player: who he is and his place and value on our board. */
export interface Contender {
	id: string;
	name: string;
	ourRank: number;
	vor: number;
	/** His season-long designation (Lane 63), absent or null when he is available: his rank is
	 * never set against another's, since his figure assumes he plays. */
	held?: DesignationStatus | null;
}

export type Verdict<T extends Contender> =
	/** The same player on both sides: there is nothing to call. */
	| { kind: 'same' }
	| {
			kind: 'call';
			leader: T;
			other: T;
			/** How each is named in the sentence and on the verbs: the last name, or the whole name
			 * when the two share one (Chase Brown and Amon-Ra St. Brown). */
			leaderName: string;
			otherName: string;
			sentence: string;
	  };

/** The sentence for the same player twice. */
export const SAME_PLAYER = 'That is the same player twice. Pick someone else on one side.';

/** "on injured reserve": the designation in the middle of a sentence. */
function heldWords(status: DesignationStatus): string {
	const word = designationWord(status);
	return word.charAt(0).toLowerCase() + word.slice(1);
}

function names(leader: Contender, other: Contender): { leaderName: string; otherName: string } {
	const shared = lastName(leader.name) === lastName(other.name);
	return {
		leaderName: shared ? leader.name : lastName(leader.name),
		otherName: shared ? other.name : lastName(other.name)
	};
}

/** The call when a side is on a season-long list: the available player, or between two held ones
 * their points over replacement if they play, never their places on the board. */
function heldCall<T extends Contender>(a: T, b: T, formatLabel: string): Verdict<T> {
	if (a.held && b.held) {
		const [leader, other] = a.vor >= b.vor ? [a, b] : [b, a];
		const { leaderName, otherName } = names(leader, other);
		return {
			kind: 'call',
			leader,
			other,
			leaderName,
			otherName,
			sentence: `Both are on season-long lists, so neither sits above the available players on our ${formatLabel} board. If both play, ${leaderName} has ${fixed(leader.vor - other.vor)} more points over replacement.`
		};
	}
	const held = a.held ?? b.held;
	if (held == null) throw new Error('A held call needs a side on a season-long list.');
	const [leader, other] = a.held ? [b, a] : [a, b];
	const { leaderName, otherName } = names(leader, other);
	return {
		kind: 'call',
		leader,
		other,
		leaderName,
		otherName,
		sentence: `We'd take ${leaderName}: ${otherName} is ${heldWords(held)}, so he sits below the available players on our ${formatLabel} board.`
	};
}

export function verdict<T extends Contender>(a: T, b: T, formatLabel: string): Verdict<T> {
	if (a.id === b.id) return { kind: 'same' };
	if (a.held || b.held) return heldCall(a, b, formatLabel);
	const [leader, other] = a.ourRank <= b.ourRank ? [a, b] : [b, a];
	const { leaderName, otherName } = names(leader, other);
	const places = other.ourRank - leader.ourRank;
	return {
		kind: 'call',
		leader,
		other,
		leaderName,
		otherName,
		sentence: `We'd take ${leaderName}: ${plural(places, 'place')} higher on our ${formatLabel} board, ${fixed(leader.vor - other.vor)} more points over replacement.`
	};
}
