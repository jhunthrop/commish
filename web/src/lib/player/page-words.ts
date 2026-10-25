/** The player page's own words (Lane 192): its facts' labels and the outcome bar's caption, in one
 * place for the copy guard and for the apps' word tables (shared/scripts/gen-words.ts), so the app's
 * player page prints the page's words. */
export const PLAYER_PAGE = {
	/** His points over a free pickup's, the fact beside where drafters take him. */
	overReplacement: 'Over replacement',
	/** The outcome bar's fact. */
	outcomes: 'Floor, median, ceiling',
	/** Under the outcome bar: "2026 PPR points, from his low case to his high case". */
	outcomesCaption: (season: number, scoring: string): string =>
		`${String(season)} ${scoring} points, from his low case to his high case`
} as const;
