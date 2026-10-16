/** Where each of a season page's verbs goes (season-words.ts): following a league to the follow
 * page, the followed league to its page, the draft prep to its own. */
import { sectionHref } from '#lib/ui/nav.ts';
import { links } from './links.ts';
import type { PageVerb } from './season-words.ts';

/** `leagueId` is the league selected in the shell, null with none. */
export function verbHref(verb: PageVerb, leagueId: string | null): string {
	switch (verb) {
		case 'follow':
			return links.leagueNew();
		case 'open_league':
			return leagueId === null ? links.leagueNew() : links.league(leagueId);
		case 'mock':
			return sectionHref('mock');
		case 'sheet':
			return sectionHref('sheet');
	}
}
