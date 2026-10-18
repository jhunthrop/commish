/** The words the site never prints (the copy rules): the betting and trading registers, and "host"
 * (member-facing copy names the platform, never "host"), whole words, any case. One list for every
 * guard that reads the site's copy (Lane 66n re-review N5, re-review 2 F1): the board basis's and the
 * strength words' tests and the board row shots read it, the whole page scanned, the in-season order
 * screen included. A guard with words of its own composes this list with them, never a second list. */
export const BANNED_WORDS =
	/\b(favou?red|favou?rites?|underdogs?|odds|lines?|spreads?|over\/under|bets?|betting|wagers?|parlays?|totals?|markets?|prices?|buy|sell|vegas|sportsbooks?|hosts?)\b/iu;

/** The punctuation the site's copy never uses: the em dash and the semicolon. */
export const BANNED_MARKS = /[—;]/u;
