/** The one-time mark that this browser just deleted its account (Lane 233 review L6): set after the
 * API's 204, read once by the page after, cleared on that read. /account/delete?deleted opened cold
 * (a shared link, a typed address, a second reload) finds no mark and shows the signed-out page's
 * words, never "Your account is deleted". Kept in the tab's session storage, nothing about the
 * account in it. */
export const DELETED_KEY = 'commish-account-deleted';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Sets the mark; false when the browser keeps nothing (then the page says so in place). */
export function markDeleted(store: Store): boolean {
	try {
		store.setItem(DELETED_KEY, '1');
		return true;
	} catch {
		return false;
	}
}

/** Whether the mark was set, clearing it: true once per delete. */
export function takeDeleted(store: Store): boolean {
	try {
		const marked = store.getItem(DELETED_KEY) !== null;
		store.removeItem(DELETED_KEY);
		return marked;
	} catch {
		return false;
	}
}
