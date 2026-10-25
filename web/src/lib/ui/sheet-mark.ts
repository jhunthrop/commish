/** The sheet mark's words (Lane 209), one table for the board rows' plus and the Rankings rows' verb:
 * the plus opens to its words on a row's hover, and on a phone's Rankings row the verb says its short
 * word beside the plus, never a bare plus. */
import { ordinal } from '#lib/format/number.ts';

export const SHEET_MARK = {
	/** The words the plus opens to on a row's hover and focus. */
	add: 'Add to my sheet',
	/** The verb's word on a phone's Rankings row, where the row has no hover. */
	addShort: 'Add'
} as const;

/** What a screen reader hears the plus as: "Add Puka Nacua to my sheet". */
export function addLabel(name: string): string {
	return `Add ${name} to my sheet`;
}

/** What a screen reader hears the check as: "Puka Nacua is 3rd on your sheet". */
export function placeLabel(name: string, place: number): string {
	return `${name} is ${ordinal(place)} on your sheet`;
}
