/** The one basis line a page prints about the selected league: what its figures are against the
 * league's scoring. Its own module, so only the pages that print it carry it. */
import { midSentence } from '#lib/format/sentence.ts';
import { SCORING_WORDS } from '#lib/league/names.ts';
import { FORMAT_LABELS } from '#lib/sheet/format.ts';
import type { BoardFormat, ContextLeague } from './words.ts';

/** The scoring the figures are in, as a sentence names it: "PPR", "half PPR". */
function figuresWords(format: BoardFormat): string {
	return midSentence(FORMAT_LABELS[format]);
}

/** What a page's figures are, as its basis line opens: "This board is", "These figures are". */
export type FiguresSubject = 'This board is' | 'These figures are';

/** The league's scoring as a basis line opens, in plain words: TE premium is jargon a first-timer
 * cannot act on, so it says what it does. */
export function leagueScores(league: ContextLeague): string {
	return scoresSentence(league.scoring);
}

/** The same sentence for a scoring preset (the league page reads it off its sync). */
export function scoresSentence(scoring: ContextLeague['scoring']): string {
	return scoring === 'te_premium'
		? 'Your league gives tight ends extra points per catch.'
		: `Your league scores ${SCORING_WORDS[scoring]}.`;
}

/** Where the line sends a Draft Pass holder for the league's exact board: its saved league's mock
 * (the setup with the league filled in), or the mock setup to enter its rules when no saved league
 * exists yet. */
export interface NoteLink {
	words: string;
	/** The saved league the mock opens on, null for the setup itself. */
	savedLeague: string | null;
}

/** The line, and the one link it ends on for an account with exact rules. */
export interface LeagueNote {
	text: string;
	link: NoteLink | null;
}

const plain = (text: string): LeagueNote => ({ text, link: null });

/** A TE premium league on its plain PPR figures: where its exact rules rank it. Without
 * custom_scoring the Draft Pass does; with it, the league's own mock draft, as a link. */
function exactNote(league: ContextLeague, exactRules: boolean, opening: string): LeagueNote {
	if (!exactRules) return plain(`${opening} The Draft Pass ranks it by your league's exact rules.`);
	const saved = league.settings_league_id;
	return {
		text: opening,
		link:
			saved === null
				? { words: "Set up your league's exact rules to rank by them.", savedLeague: null }
				: { words: "Your league's exact board is in its mock draft.", savedLeague: saved }
	};
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
): LeagueNote | null {
	if (!league) return null;
	const scores = leagueScores(league);
	const figuresAre = `${subject} ${figuresWords(figures)}`;
	if (league.format !== figures) {
		if (leagueBoardOnRun) return plain(`${scores} ${figuresAre}.`);
		const lower = figuresAre.charAt(0).toLowerCase() + figuresAre.slice(1);
		return plain(`${scores} This run has no ${figuresWords(league.format)} board, so ${lower}.`);
	}
	if (league.scoring === 'te_premium') {
		return exactNote(league, exactRules, `${scores} ${subject} plain ${figuresWords(figures)}.`);
	}
	return plain(
		league.format === 'superflex'
			? `Your league scores ${SCORING_WORDS[league.scoring]} and starts a superflex.`
			: scores
	);
}
