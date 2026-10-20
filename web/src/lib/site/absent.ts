/** What a format page says when the run lacks its format, said one way on the page and the system
 * page's specimen. */
import { listWords } from '#lib/format/list.ts';

export interface AbsentWords {
	title: string;
	line: string;
}

/** "Half PPR is not on our board yet" / "Our board ranks PPR only. Updated Oct 13." */
export function absentWords(
	format: string,
	stamp: string,
	carried: readonly string[]
): AbsentWords {
	return {
		title: `${format} is not on our board yet`,
		line: `Our board ranks ${listWords(carried)} only. ${stamp}.`
	};
}
