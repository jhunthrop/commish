/** What Yahoo's return to the account page says: the API's callback redirects here with
 * `?yahoo=connected`, or `?yahoo=refused&why=...` (api/internal/hosts/yahoo service.go), and the page
 * says it in one sentence. */

/** The search parameters the callback writes. */
export const YAHOO_PARAM = 'yahoo';
export const YAHOO_WHY_PARAM = 'why';

const NOT_CONNECTED = 'Yahoo is not connected.';

const FAILED = `${NOT_CONNECTED} Yahoo did not finish the sign-in. Try again in a moment.`;

const REFUSED: Readonly<Partial<Record<string, string>>> = {
	denied: `${NOT_CONNECTED} You chose not to allow it on Yahoo's page.`,
	expired: `${NOT_CONNECTED} The sign-in took over ten minutes. Start it again.`,
	signed_out: `${NOT_CONNECTED} Sign in here as the account that started it, then start again.`,
	failed: FAILED,
	off: 'Yahoo leagues are not open here right now.'
};

/** How Yahoo's return went, as one sentence, and whether it connected; null when the address carries
 * no outcome. */
export function yahooOutcome(
	params: Pick<URLSearchParams, 'get'>
): { readonly words: string; readonly connected: boolean } | null {
	const outcome = params.get(YAHOO_PARAM);
	if (outcome === 'connected') {
		return { words: 'Yahoo is connected.', connected: true };
	}
	if (outcome !== 'refused') return null;
	const why = params.get(YAHOO_WHY_PARAM) ?? '';
	return { words: REFUSED[why] ?? FAILED, connected: false };
}
