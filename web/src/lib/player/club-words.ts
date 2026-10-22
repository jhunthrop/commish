/** The words a player page says when its club is not the one his game lines were for (Lane 120). */
import { FREE_AGENT_WORDS } from '#lib/format/free-agent.ts';

/** A club as the run's clubs.json names it. */
interface Named {
	nickname: string;
}

/** The page's line when his newest game line was for another club than his own: "Now with the
 * Dolphins. His week 5 game was for the Chargers.", or with no club (null, Lane 123) "Now a free
 * agent. His week 5 game was for the Chargers." */
export function lastGameClubWords(club: Named | null, week: number, lineClub: Named): string {
	const now = club === null ? `Now ${FREE_AGENT_WORDS}.` : `Now with the ${club.nickname}.`;
	return `${now} His week ${String(week)} game was for the ${lineClub.nickname}.`;
}
