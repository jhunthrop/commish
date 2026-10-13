/**
 * The rail's League item answers from /me: the account's newest attached league, read once per page
 * load and again after an attach, a detach or an undo. A browser with no signed-in session cookie
 * asks nothing, so a signed-out reader of the public pages makes no API call. Nothing is kept in the
 * browser, so another account on the same browser never sees it.
 */
import { PUBLIC_API_URL } from '$app/env/public';
import { apiClient, hasSessionCookie } from '#lib/api/client.ts';
import type { components } from '#lib/api/types.ts';

type Account = components['schemas']['Account'];

const client = apiClient(PUBLIC_API_URL);

class RailLeague {
	/** The newest attached league's id, null signed out or with none. */
	id = $state<string | null>(null);
	#asked: Promise<void> | null = null;

	/** Reads /me the first time any page asks in this page load. */
	load(): Promise<void> {
		this.#asked ??= this.refresh();
		return this.#asked;
	}

	/** Reads /me again: after the account's leagues change. */
	async refresh(): Promise<void> {
		if (!hasSessionCookie()) {
			this.id = null;
			return;
		}
		try {
			this.id = (await client.call<Account>('/me')).league_id;
		} catch {
			this.id = null;
		}
	}
}

export const railLeague = new RailLeague();
