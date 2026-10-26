/** The every-format table's rank words (Lane 220, B184): the column is his place at his position, the
 * head's own figure, so the table and the head say one rank. */
export const FORMATS_RANK = {
	/** The column's head. */
	head: 'Position rank',
	/** Under the table once the read has answered: it ranks the one format it reads, so the others'
	 * places read "--" beside their figures at the read's clock. */
	readOnly: (scoring: string): string =>
		`Position rank at the read is in ${scoring} alone, the scoring the read is in.`
} as const;
