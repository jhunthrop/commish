/** The season log's words for a week with no stat line drawn (Lanes 120, 135, 138), in one table: the
 * log row's note under a named opponent, or the words in its place when the run names none. */
export const SEASON_LOG_WORDS = {
	/** No stat line and no offensive snap: inactive, or a mover's week the run cannot name. */
	didNotPlay: 'Did not play',
	/** Offensive snaps in a game the run cannot name (a free agent's week with no club edge, Lane 138):
	 * he played, and the log has no line to show for it. */
	playedNoLine: 'Played, no line'
} as const;
