/** "PPR", "PPR and Half PPR", "PPR, Half PPR and Standard": a list as a sentence says it, joined by
 * "and" or, for a choice, "or" ("Sleeper, Yahoo or ESPN"). */
export function listWords(items: readonly string[], conjunction: 'and' | 'or' = 'and'): string {
	if (items.length <= 1) return items.join('');
	return `${items.slice(0, -1).join(', ')} ${conjunction} ${items.at(-1) ?? ''}`;
}
