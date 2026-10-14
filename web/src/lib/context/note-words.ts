/** The one basis line a page prints about the selected league: what its figures are against the
 * league's scoring. Its own module, so only the pages that print it carry it. */
import { SCORING_WORDS } from '#lib/league/names.ts';
import { FORMAT_LABELS } from '#lib/sheet/format.ts';
import type { BoardFormat, ContextLeague } from './words.ts';

/** The scoring the figures are in, as a sentence names it: "PPR", "half PPR". */
function figuresWords(format: BoardFormat): string {
	const label = FORMAT_LABELS[format];
	return /^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}

/** What a page's figures are, as its basis line opens: "This board is", "These figures are". */
export type FiguresSubject = 'This board is' | 'These figures are';

/** The league's scoring as a basis line opens, in plain words: TE premium is jargon a first-timer
 * cannot act on, so it says what it does. */
export function leagueScores(league: ContextLeague): string {
	return league.scoring === 'te_premium'
		? 'Your league gives tight ends extra points per catch.'
		: `Your league scores ${SCORING_WORDS[league.scoring]}.`;
}

/** Where a TE premium league's exact rules rank it, after "This board is plain PPR.": the Draft
 * Pass without custom_scoring, the league's own mock draft with it (its exact board), or nothing
 * when a mock room cannot draft the league. */
function exactWords(league: ContextLeague, exactRules: boolean): string {
	if (!exactRules) return " The Draft Pass ranks it by your league's exact rules.";
	return league.settings_league_id === null
		? ''
		: " Your league's exact board is in its mock draft.";
}

/** The page's one line about the league, null with no league selected. The figures' scoring names
 * its basis against the league's: the same, plain PPR beside a TE premium league with where its
 * exact rules rank it, a format this run does not carry, or (a link that named another board the
 * run carries) simply what this board is. exactRules is the account's custom_scoring. */
export function contextNote(
	league: ContextLeague | null,
	figures: BoardFormat,
	exactRules: boolean,
	subject: FiguresSubject = 'This board is',
	leagueBoardOnRun = false
): string | null {
	if (!league) return null;
	const scores = leagueScores(league);
	const figuresAre = `${subject} ${figuresWords(figures)}`;
	if (league.format !== figures) {
		if (leagueBoardOnRun) return `${scores} ${figuresAre}.`;
		const lower = figuresAre.charAt(0).toLowerCase() + figuresAre.slice(1);
		return `${scores} This run has no ${figuresWords(league.format)} board, so ${lower}.`;
	}
	if (league.scoring === 'te_premium') {
		return `${scores} ${subject} plain ${figuresWords(figures)}.${exactWords(league, exactRules)}`;
	}
	return league.format === 'superflex'
		? `Your league scores ${SCORING_WORDS[league.scoring]} and starts a superflex.`
		: scores;
}
