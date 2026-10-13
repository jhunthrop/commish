/** Our call between two players, said one way wherever it is printed: the compare page and the
 * system page's specimen both read it from here. */
import { lastName } from '#lib/format/draft.ts';
import { fixed, plural } from '#lib/format/number.ts';

/** What the call needs about each player: who he is and his place and value on our board. */
export interface Contender {
	id: string;
	name: string;
	ourRank: number;
	vor: number;
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

export function verdict<T extends Contender>(a: T, b: T, formatLabel: string): Verdict<T> {
	if (a.id === b.id) return { kind: 'same' };
	const [leader, other] = a.ourRank <= b.ourRank ? [a, b] : [b, a];
	const shared = lastName(leader.name) === lastName(other.name);
	const leaderName = shared ? leader.name : lastName(leader.name);
	const otherName = shared ? other.name : lastName(other.name);
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
