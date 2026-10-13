/**
 * Whether this browser's account has a league attached, so the rail shows League only once there is
 * one. The rail is drawn on prerendered pages that never ask the API, so the league pages and the
 * account page note the account's newest league here whenever they read the list, and the rail reads
 * the note. Nothing secret: an id the account's own pages already put in the address bar.
 */
import { browserStorage, type StorageGetter } from './theme.ts';

const KEY = 'commish-league';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

class RailLeague {
	/** The newest attached league's id, or null when the account has none (or this browser has not
	 * seen the list yet). */
	id = $state<string | null>(null);

	read(getStorage: StorageGetter = browserStorage): void {
		try {
			const saved = getStorage().getItem(KEY);
			this.id = saved !== null && UUID.test(saved) ? saved : null;
		} catch {
			this.id = null;
		}
	}

	/** Notes the account's newest league, or that it has none. */
	note(id: string | null, getStorage: StorageGetter = browserStorage): void {
		this.id = id;
		try {
			if (id === null) getStorage().removeItem(KEY);
			else getStorage().setItem(KEY, id);
		} catch {
			// Storage blocked or full: the rail shows League for this visit only.
		}
	}
}

export const railLeague = new RailLeague();
