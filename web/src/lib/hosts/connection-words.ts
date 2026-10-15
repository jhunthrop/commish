/** A connected host account as the account page says it: its state in words, and what an ESPN
 * session is kept for. */
import type { components } from '#lib/api/types.ts';

type HostConnection = components['schemas']['HostConnection'];
type ConnectedHost = components['schemas']['ConnectedHost'];

/** The words that keep an ESPN session, said beside the verb that connects and on the account page:
 * consent version 2 (api/internal/hosts consentVersions). Change the words, raise the version. */
export const ESPN_CONSENT =
	'We keep an encrypted copy of your ESPN session so your league stays in sync. Disconnect deletes it at once.';

const STATUS: Readonly<Record<ConnectedHost, Record<HostConnection['status'], string>>> = {
	ffpc: { connected: 'Signed in', signed_out: 'Signed out by FFPC' },
	yahoo: { connected: 'Connected', signed_out: 'Yahoo asks you to connect again' },
	espn: { connected: 'Connected', signed_out: 'ESPN no longer accepts your saved sign-in' }
};

/** An ESPN session kept while every league ESPN listed was public, before a private league read
 * with it proved it. */
const NOT_YET_CHECKED = 'Connected, not yet checked against a private league';

/** A connection's state: "Signed in", "Connected", "Connected, not yet checked against a private
 * league", "Signed out by FFPC". */
export function statusWords(c: HostConnection): string {
	if (c.status === 'connected' && !c.proven) return NOT_YET_CHECKED;
	return STATUS[c.host][c.status];
}
