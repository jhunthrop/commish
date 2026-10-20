/** A connected host account as the account page says it: its state in words, and what an ESPN
 * session is kept for. */
import type { components } from '#lib/api/types.ts';
import { hostWords } from '#lib/league/names.ts';

type HostConnection = components['schemas']['HostConnection'];
type ConnectedHost = components['schemas']['ConnectedHost'];
type LeagueHost = components['schemas']['LeagueHost'];

/** The words that keep an ESPN session, said beside the verb that connects and on the account page:
 * consent version 3 (api/internal/hosts ESPNConsentVersion), which names the moves a member asks
 * for; a move needs a connection made at 3. Change the words, raise the version. */
export const ESPN_CONSENT_VERSION = 3;

/** The words of ESPN_CONSENT_VERSION. */
export const ESPN_CONSENT =
	'We keep an encrypted copy of your ESPN session so your league stays in sync and, when you ask, to make your moves. Disconnect deletes it at once.';

/** The words that connect MyFantasyLeague, beside its form and on the account page: consent version
 * 1 (api/internal/hosts MFLConsentVersion), which names the lineup moves; a move needs a connection
 * made at 1. Change the words, raise the version. */
export const MFL_CONSENT_VERSION = 1;

/** The words of MFL_CONSENT_VERSION. */
export const MFL_CONSENT =
	'We send your MyFantasyLeague password to MyFantasyLeague once to sign in, and never keep it. We keep the session MyFantasyLeague gives back, encrypted, to set your lineup there when you confirm a move. Disconnect deletes it at once.';

/** Each platform's one state word while it works (Lane 94): FFPC is signed in to, ESPN, Yahoo and
 * MyFantasyLeague are connected, a Sleeper league is followed by its id. The Account room, the league
 * pages and the front door say these and no other. */
export const WORKING_WORDS: Readonly<Record<LeagueHost, string>> = {
	ffpc: 'Signed in',
	espn: 'Connected',
	yahoo: 'Connected',
	mfl: 'Connected',
	sleeper: 'Followed'
};

/** A platform whose connecting is not open to the account yet. */
export const NOT_YET_OPEN = 'Not yet open';

/** The state once the platform dropped what we keep. */
const SIGNED_OUT_WORDS: Readonly<Record<ConnectedHost, string>> = {
	ffpc: 'Signed out by FFPC',
	yahoo: 'Yahoo asks you to connect again',
	espn: 'ESPN no longer accepts your saved sign-in',
	mfl: 'MyFantasyLeague no longer accepts your saved sign-in'
};

/** An ESPN session kept unproven that ESPN then refused: it never worked, so not "no longer". */
const NEVER_ACCEPTED = 'ESPN did not accept your saved sign-in';

/** A connection's state: "Signed in", "Connected", "Signed out by FFPC". A session kept before a
 * private league proved it reads as connected: whether a private league was read with it is ours to
 * check, never the member's to read (Lane 94, B28). */
export function statusWords(c: HostConnection): string {
	if (c.status === 'connected') return WORKING_WORDS[c.host];
	return c.proven ? SIGNED_OUT_WORDS[c.host] : NEVER_ACCEPTED;
}

/** The verb that keeps a league on the platform read: "Sign in to FFPC", "Connect Yahoo". */
export function keepReadingVerb(host: LeagueHost): string {
	return host === 'ffpc' ? 'Sign in to FFPC' : `Connect ${hostWords(host)}`;
}

/** The verb that connects again once the platform dropped the connection. */
export function againWords(host: ConnectedHost): string {
	return `${keepReadingVerb(host)} again`;
}
