/** The first sentence of the advisor's why: the reason. The sentences after it restate the odds,
 * which the figure beside it already prints, so a view shows the reason alone. */
export function firstSentence(text: string): string {
	const end = /[.!?](\s|$)/.exec(text);
	return end ? text.slice(0, end.index + 1) : text;
}
