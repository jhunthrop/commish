/**
 * The rail's League item answers from /me: signed in, the account's newest attached league or none,
 * read once per page load and again after an attach, a detach or an undo. A browser with no signed-in session cookie
 * asks nothing, so a signed-out reader of the public pages makes no API call. Nothing is kept in the
 * browser, so another account on the same browser never sees it.
 */
import { PUBLIC_API_URL } from '$app/env/public';
import { apiClient, hasSessionCookie } from '#lib/api/client.ts';
import type { components } from '#lib/api/types.ts';
import type { RailAccount } from '#lib/ui/nav.ts';

type Account = components['schemas']['Account'];

const client = apiClient(PUBLIC_API_URL);

class RailLeague {
	/** The signed-in account's league, null signed out or before /me answers. */
	account = $state<RailAccount | null>(null);
	/** /me has answered, or there was nothing to ask. Until then a signed-in phone bar holds the slot
	 * League may take. */
	answered = $state(false);
	#asked: Promise<void> | null = null;

	/** Reads /me the first time any page asks in this page load. */
	load(): Promise<void> {
		this.#asked ??= this.refresh();
		return this.#asked;
	}

	/** Reads /me again: after the account's leagues change. */
	async refresh(): Promise<void> {
		if (!hasSessionCookie()) {
			this.account = null;
			this.answered = true;
			return;
		}
		try {
			this.account = { leagueId: (await client.call<Account>('/me')).league_id };
		} catch {
			this.account = null;
		} finally {
			this.answered = true;
		}
	}
}

export const railLeague = new RailLeague();
