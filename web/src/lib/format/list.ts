/** "PPR", "PPR and Half PPR", "PPR, Half PPR and Standard": a list as a sentence says it. */
export function listWords(items: readonly string[]): string {
	if (items.length <= 1) return items.join('');
	return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}
