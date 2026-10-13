/** How a tag chip is drawn. `you` takes your color, as everything that is yours does. `loss` is
 * for a tag that steers you away from a player (Avoid), so it never reads as a pick. */
export type TagTone = 'you' | 'loss';

/** A tag as a row prints it: its word and its tone. */
export interface TagMark {
	label: string;
	tone: TagTone;
}
