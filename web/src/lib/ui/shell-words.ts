/** The shell's own words: the top bar's player search, the account's way in, and the league
 * switch's list. One table, so the bar, the switch and the apps' bars (shared/scripts/gen-words.ts)
 * print one spelling. */
export const SHELL = {
	/** The search's name in the top bar, which the apps' bar field shows as its placeholder. */
	searchPlayers: 'Search players',
	/** The account's way in: the rail's foot at a desk, the bar's last cell on a phone. */
	account: 'Account',
	/** The league switch's list of every league the account follows. */
	yourLeagues: 'Your leagues'
} as const;
