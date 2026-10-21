/** A free agent's club cell (Lane 123, B101): the provider's list names him with no club, and the API
 * and the run carry the site's one word for it, "FA", where a club's code goes. No mark, no club page,
 * no bye and no game; a sentence says FREE_AGENT_WORDS. Its own module, beside the words table alone,
 * so a page that asks it carries no club table with it. */
import { FIGURE } from './figure-words.ts';

export const FREE_AGENT_CLUB = FIGURE.freeAgentClub;
export const FREE_AGENT_WORDS = FIGURE.freeAgent;

/** He has no club: the club cell is the free agent's. */
export function isFreeAgent(club: string): boolean {
	return club === FREE_AGENT_CLUB;
}
