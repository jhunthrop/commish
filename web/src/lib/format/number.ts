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

const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** A count as a reader reads it: "1,467". */
export function count(value: number): string {
	return WHOLE.format(value);
}

/** "1 pick", "9 picks". */
export function plural(count: number, one: string, many = `${one}s`): string {
	return `${count} ${count === 1 ? one : many}`;
}

const ORDINAL = new Intl.PluralRules('en-US', { type: 'ordinal' });
const ORDINAL_SUFFIX: Readonly<Record<Intl.LDMLPluralRule, string>> = {
	zero: 'th',
	one: 'st',
	two: 'nd',
	few: 'rd',
	many: 'th',
	other: 'th'
};

/** "1st", "22nd", "13th". */
export function ordinal(count: number): string {
	return `${String(count)}${ORDINAL_SUFFIX[ORDINAL.select(count)]}`;
}

/** "the hardest of 32", "3rd hardest of 32": a schedule rank where 1 is the hardest. */
export function hardestWords(rank: number, of: number): string {
	return `${rank === 1 ? 'the hardest' : `${ordinal(rank)} hardest`} of ${String(of)}`;
}
