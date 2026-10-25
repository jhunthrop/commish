/** The Board screen's parity (Lane 182): what the web's board (BoardPageView and BoardView at 390)
 * says that the apps build with functions, as JSON their ports are held to: the board's words for
 * every rail, view and league state (season-words.ts boardWords: the bar's word, the heading and the
 * one verb), and a row's figures as the phone prints them (format/number.ts signed and fixed for Over
 * repl. and Projected, format/gap.ts gapText for the Gap). Written by export-parity.ts beside the
 * other screens' parity. */
import { gapText } from '../../web/src/lib/format/gap.ts';
import { fixed, signed } from '../../web/src/lib/format/number.ts';
import { boardWords } from '../../web/src/lib/site/season-words.ts';
import { RAIL_KEYS } from '../../web/src/lib/ui/nav.ts';

export const BOARD_OUTPUT = 'shared/fixtures/parity/board.json';

/** The views a board's words are said for: the All view, a ranked position and a draft-order one. */
const POSITIONS = [null, 'WR', 'K'] as const;
/** A board of the full season, and one that ranks the rest of it from week 7. */
const COVERS = [{}, { rosFromWeek: 7 }] as const;
const SEASON = 2026;
const LABEL = 'PPR';
/** Figures as the API sends them, a tenth, with the edges the formats turn on. */
const FIGURES = [164, 153.2, 0, 0.04, -0.04, -12.5, 7.25, -3.6, 1.8] as const;

export interface BoardWordsCase {
	rail: string;
	position: string | null;
	following: boolean;
	rosFromWeek: number | null;
	words: ReturnType<typeof boardWords>;
}

export function boardWordCases(): BoardWordsCase[] {
	return RAIL_KEYS.flatMap((rail) =>
		POSITIONS.flatMap((position) =>
			[false, true].flatMap((following) =>
				COVERS.map((cover) => ({
					rail,
					position,
					following,
					rosFromWeek: 'rosFromWeek' in cover ? cover.rosFromWeek : null,
					words: boardWords(rail, { season: SEASON, label: LABEL, position, ...cover }, following)
				}))
			)
		)
	);
}

export function renderBoard(about: string): string {
	const parity = {
		about,
		season: SEASON,
		label: LABEL,
		words: boardWordCases(),
		figures: FIGURES.map((value) => ({
			value,
			projected: fixed(value),
			overReplacement: signed(value, 1),
			gap: gapText(value)
		})),
		noGap: gapText(null)
	};
	return `${JSON.stringify(parity, null, '\t')}\n`;
}
