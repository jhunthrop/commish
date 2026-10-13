/** The lobby a drafter left, remembered for the tab's session so setup can offer the way back to it,
 * and its report once the draft ends, until he reads it or the seat is gone. */

const KEY = 'commish:left-lobby';

export function rememberLeft(id: string): void {
	sessionStorage.setItem(KEY, id);
}

export function leftLobby(): string | null {
	return sessionStorage.getItem(KEY);
}

export function forgetLeft(): void {
	sessionStorage.removeItem(KEY);
}
