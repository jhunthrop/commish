/** The words a player page says when its club is not the one his game lines were for (Lane 120). */
import { FREE_AGENT_WORDS } from '#lib/format/free-agent.ts';

/** A club as the run's clubs.json names it. */
interface Named {
	nickname: string;
}

/** What his newest game line's week was: a game he played, or one he was on the field for special
 * teams alone (no stat line, no offensive snap, Lane 144, B117). */
export type LastGameKind = 'game' | 'specialTeams';

function weekWords(week: number, kind: LastGameKind, lineClub: Named): string {
	const club = `the ${lineClub.nickname}`;
	return kind === 'specialTeams'
		? `His week ${String(week)} snaps were on special teams for ${club}.`
		: `His week ${String(week)} game was for ${club}.`;
}

/** The page's line when his newest game line was for another club than his own: "Now with the
 * Dolphins. His week 5 game was for the Chargers.", with no club (null, Lane 123) "Now a free
 * agent. His week 5 game was for the Chargers.", and for a special-teams week "Now with the Seahawks.
 * His week 4 snaps were on special teams for the Eagles." */
export function lastGameClubWords(
	club: Named | null,
	week: number,
	lineClub: Named,
	kind: LastGameKind
): string {
	const now = club === null ? `Now ${FREE_AGENT_WORDS}.` : `Now with the ${club.nickname}.`;
	return `${now} ${weekWords(week, kind, lineClub)}`;
}
