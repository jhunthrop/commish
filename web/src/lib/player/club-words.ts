/** The words a player page says when its club is not the one his game lines were for (Lane 120). */

/** A club as the run's clubs.json names it. */
interface Named {
	nickname: string;
}

/** A week of a player who changed clubs, with no line, before his newest one: the run holds no fact of
 * whose game it was, so the log names no opponent, only that he did not play. */
export const UNKNOWN_CLUB_WEEK = 'Did not play';

/** The page's line when his newest game line was for another club than his own: "Now with the
 * Dolphins. His week 5 game was for the Chargers." */
export function lastGameClubWords(club: Named, week: number, lineClub: Named): string {
	return `Now with the ${club.nickname}. His week ${String(week)} game was for the ${lineClub.nickname}.`;
}
