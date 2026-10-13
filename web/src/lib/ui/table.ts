/** A Table column: its head, its alignment, and whether the phone keeps it. */
export interface Column {
	label: string;
	/** Numbers align to the end, words to the start. */
	align?: 'start' | 'end';
	/** Kept off the phone, where the table keeps only the columns that decide. */
	wideOnly?: boolean;
}
