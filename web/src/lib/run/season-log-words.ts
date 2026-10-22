/** The season log's words for a week with no stat line drawn (Lanes 120, 135, 138), in one table: the
 * log row's note under a named opponent, or the words in its place when the run names none. */
export const SEASON_LOG_WORDS = {
	/** No stat line and no offensive snap: inactive, or a mover's week the run cannot name. */
	didNotPlay: 'Did not play',
	/** Offensive snaps in a game the run cannot name (a free agent's week with no club edge, Lane 138):
	 * he played, and the log has no stats to show for it. The ruling's "Played, no line" says the
	 * betting word the copy guard refuses (banned-words.json `line`), so the table says stats (Lane 138).
	 * The week counts as a game: the season head's "through week N" reaches it, past the records too
	 * (reach.ts countedWeek, Lane 141, B120). */
	playedNoStats: 'Played, no stats',
	/** His newest game line's week under that club's game with no stat line and no offensive snap: the
	 * club edge comes from the snap release, which lists special teams too, so he was on the field for
	 * special teams alone (Lane 135's Deguara, Lane 144, B117). Only that week is known to be one; the
	 * page's club line says it in words (player/club-words.ts). */
	specialTeams: 'Special teams only'
} as const;
