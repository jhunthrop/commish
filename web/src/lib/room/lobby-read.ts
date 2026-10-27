/** The lobby room's read over HTTP, before its socket (B252): the room, or why it could not be read.
 * A refusal for good (signed out, no seat, no such room) is final and keeps only the way out; a read
 * that did not go (no signal, a timeout, the API's own fault) can be read again in place. Pure of the
 * page, so the web's Try again is tested here; the apps' LobbyViewModel holds the same rule. */
import { isFinalRefusal } from '#lib/api/status.ts';

export type LobbyRead<Room> =
	| { readonly kind: 'room'; readonly room: Room }
	| { readonly kind: 'failed'; readonly error: unknown; readonly final: boolean }
	/** The page went while the read was out: nothing is shown and no socket opens. */
	| { readonly kind: 'left' };

/** `alive` says whether the page is still there when the read answers. */
export async function readLobby<Room>(
	read: () => Promise<Room>,
	alive: () => boolean = () => true
): Promise<LobbyRead<Room>> {
	let answer: LobbyRead<Room>;
	try {
		answer = { kind: 'room', room: await read() };
	} catch (error) {
		answer = { kind: 'failed', error, final: isFinalRefusal(error) };
	}
	return alive() ? answer : { kind: 'left' };
}

/** Whether a read's failure offers Try again: only one that was not final. */
export function canTryAgain(read: LobbyRead<unknown>): boolean {
	return read.kind === 'failed' && !read.final;
}
