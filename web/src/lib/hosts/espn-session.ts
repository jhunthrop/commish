/** The two ESPN values in what Disney's sign-in widget hands back, found the same way by the sign-in
 * window (espn-window.ts, which serves findSession's own source to decide whether an existing
 * Disney session handed them over) and by the account page (espn-oneid.ts, which sends them to the
 * API). findSession is served as its own source, so it must use nothing outside itself. */

/** The two ESPN values a session carries, as the API takes them. */
export interface ESPNSession {
	readonly swid: string;
	readonly s2: string;
}

/** The SWID and s2 anywhere in what the widget hands back (its login event, its guest), by their
 * names: `swid` and `s2`, the SWID braced as the cookie carries it. Null when either is missing. */
export function findSession(data: unknown): ESPNSession | null {
	const SWID =
		/^\{?[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}?$/;
	const MAX_DEPTH = 6;
	const MIN_S2_LENGTH = 40;
	const found: { swid: string | null; s2: string | null } = { swid: null, s2: null };
	const walk = (value: unknown, depth: number): void => {
		if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return;
		for (const [key, inner] of Object.entries(value)) {
			if (typeof inner !== 'string') {
				walk(inner, depth + 1);
				continue;
			}
			const name = key.toLowerCase();
			if (name === 'swid' && SWID.test(inner)) found.swid ??= `{${inner.replace(/^\{|\}$/g, '')}}`;
			if (name === 's2' && inner.length >= MIN_S2_LENGTH) found.s2 ??= inner;
		}
	};
	walk(data, 0);
	const { swid, s2 } = found;
	return swid !== null && s2 !== null ? { swid, s2 } : null;
}
