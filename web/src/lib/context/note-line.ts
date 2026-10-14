/** The league line as the store loads it with the selected league: note-words.ts's words, its link
 * as an href. Apart from note-words so the words stay pure for the tests, and loaded only with a
 * league, so no first load carries either. */
import { links } from '#lib/site/links.ts';
import { sectionHref } from '#lib/ui/nav.ts';
import { runFormatId } from '#lib/run/format-ids.ts';
import { siteContext } from './context.svelte.ts';
import { contextNote, type FiguresSubject, type LeagueNote } from './note-words.ts';
import type { BoardFormat } from './words.ts';

export { leagueScores } from './note-words.ts';

/** The line and, for an account with exact rules, the link it ends on. */
export interface LeagueLine {
	text: string;
	link: { words: string; href: string } | null;
}

function withHref({ text, link }: LeagueNote): LeagueLine {
	if (link === null) return { text, link: null };
	const href = link.savedLeague === null ? sectionHref('mock') : links.mockLeague(link.savedLeague);
	return { text, link: { words: link.words, href } };
}

/** contextNote with its link resolved. */
export function contextLine(...args: Parameters<typeof contextNote>): LeagueLine | null {
	const note = contextNote(...args);
	return note === null ? null : withHref(note);
}

/** A page's league line for its figures, read from the store here (the selected league, the
 * account's exact rules), so the pages pass only what they print in. `carried` is the run's board
 * ids when a link may have named another board the run carries. */
export function lineFor(
	figures: BoardFormat | null,
	subject: FiguresSubject,
	carried: readonly string[] = []
): LeagueLine | null {
	const { league } = siteContext;
	if (figures === null || league === null) return null;
	return contextLine(
		league,
		figures,
		siteContext.features.includes('custom_scoring'),
		subject,
		carried.includes(runFormatId(league.format))
	);
}
