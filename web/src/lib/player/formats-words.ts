/** The every-format table's rank words (Lane 220, B184): the column is his place at his position, the
 * head's own figure, so the table and the head say one rank. */
export const FORMATS_RANK = {
	/** The column's head. */
	head: 'Position rank',
	/** Under the table when a format's rank cell reads "--": the read places him in its own format
	 * alone, so another format shows its points at the read with no place at his position yet. */
	unranked: (labels: readonly string[]): string =>
		`${joinLabels(labels)} ${labels.length === 1 ? 'shows' : 'show'} no position rank at this read, only ${labels.length === 1 ? 'its' : 'their'} points.`
} as const;

/** "Half PPR", "Half PPR and Standard", "Half PPR, Standard and Superflex". */
function joinLabels(labels: readonly string[]): string {
	if (labels.length <= 1) return labels.join('');
	return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1) ?? ''}`;
}
