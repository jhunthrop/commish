/** One fact in a FactStrip (Lane 66o): its figure or word on top, what it is under it. */
export interface FactCell {
	label: string;
	value: string;
	/** A word rather than a number: set in the UI face, not the number face. */
	word?: boolean;
	/** You: the cell in the accent. */
	mine?: boolean;
}
