/** The words the site never prints (the copy rules): the betting and trading registers, whole words,
 * any case. One list for every guard that reads the site's copy (Lane 66n re-review N5): the strength
 * words' test and the board row shots read it; a guard that needs a word the site legitimately prints
 * elsewhere (an order table's "Total" head) narrows what it scans, never this list. */
export const BANNED_WORDS =
	/\b(favou?red|favou?rites?|underdogs?|odds|lines?|spreads?|over\/under|bets?|betting|wagers?|parlays?|totals?|markets?|prices?|buy|sell|vegas|sportsbooks?)\b/iu;

/** The punctuation the site's copy never uses: the em dash and the semicolon. */
export const BANNED_MARKS = /[—;]/u;
