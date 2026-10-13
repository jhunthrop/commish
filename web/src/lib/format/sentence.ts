/** Words a period follows without ending a sentence: "The No. 3 receiver", "Amon-Ra St. Brown". */
const ABBREVIATIONS: ReadonlySet<string> = new Set([
	'No',
	'St',
	'Jr',
	'Sr',
	'Mr',
	'vs',
	'Jan',
	'Feb'
]);

/** Whether the period at `at` ends a sentence: not after an abbreviation or a lone initial
 * ("D.J."), and followed by the end or by a space and a capital. */
function endsSentence(text: string, at: number): boolean {
	const before = /([A-Za-z]+)$/.exec(text.slice(0, at))?.[1] ?? '';
	if (ABBREVIATIONS.has(before) || /^[A-Z]$/.test(before)) return false;
	const after = text.slice(at + 1);
	return after === '' || /^\s+[A-Z0-9"“]/.test(after);
}

/** The first sentence of the advisor's why: the reason. The sentences after it restate the odds,
 * which the figure beside it already prints, so a view shows the reason alone. */
export function firstSentence(text: string): string {
	for (let i = 0; i < text.length; i++) {
		const ch = text.charAt(i);
		if ((ch === '.' || ch === '!' || ch === '?') && endsSentence(text, i))
			return text.slice(0, i + 1);
	}
	return text;
}
