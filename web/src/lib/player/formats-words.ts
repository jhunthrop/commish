/** The every-format table's rank words (Lane 220, B184): the column is his place at his position, the
 * head's own figure, so the table and the head say one rank. */
export const FORMATS_RANK = {
	/** The column's head. */
	head: 'Position rank',
	/** Under the table when a format's rank cell reads "--", the reason for those formats alone
	 * (Lane 234, B211): on an answer from before the per-format ranks the read places him in its own
	 * format alone, so another shows its points with no place; else our order in that format does not
	 * place him. */
	unranked: (labels: readonly string[], reason: 'unread' | 'unplaced'): string =>
		reason === 'unread'
			? `${joinLabels(labels)} ${labels.length === 1 ? 'shows' : 'show'} points at this read with no position rank.`
			: `Our order in ${joinLabels(labels)} does not place him at his position.`
} as const;

/** "Half PPR", "Half PPR and Standard", "Half PPR, Standard and Superflex". */
function joinLabels(labels: readonly string[]): string {
	if (labels.length <= 1) return labels.join('');
	return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1) ?? ''}`;
}
