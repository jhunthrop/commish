/** The typographic minus, so a negative number is the same width as a positive one in tabular figures. */
export const MINUS = '−';

/** One decimal with an explicit sign: +93.7, −0.9. */
export function signed(value: number, decimals = 1): string {
	const magnitude = Math.abs(value).toFixed(decimals);
	return value < 0 && Number(magnitude) !== 0 ? `${MINUS}${magnitude}` : `+${magnitude}`;
}

export function fixed(value: number, decimals = 1): string {
	return value.toFixed(decimals);
}

/** "1 pick", "9 picks". */
export function plural(count: number, one: string, many = `${one}s`): string {
	return `${count} ${count === 1 ? one : many}`;
}
