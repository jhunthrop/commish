/** The room's keyboard. Enter always drafts our call, as the keycap on the call's verb says. The
 * arrows mark a player, D drafts the marked player, Q queues him, U undoes, / searches (the Search
 * primitive owns /). The keys panel lists exactly the keys that act right now. */
import type { KeyBinding } from '#lib/types/room.ts';

const CALL: KeyBinding = { keys: 'Enter', does: 'draft our call' };
const MARK: KeyBinding = { keys: '↑ ↓', does: 'mark a player' };
const DRAFT_MARKED: KeyBinding = { keys: 'D', does: 'draft the marked player' };
const QUEUE: KeyBinding = { keys: 'Q', does: 'queue the marked player' };
const UNDO: KeyBinding = { keys: 'U', does: 'undo your last pick' };
const SEARCH: KeyBinding = { keys: '/', does: 'search the pool' };

/** The solo room's keys: no clock, so the drafting keys always act. */
export const SOLO_KEYS: readonly KeyBinding[] = [CALL, MARK, DRAFT_MARKED, QUEUE, UNDO, SEARCH];

/** A lobby's keys. It is other people's draft too, so there is no undo, and off your clock there is
 * no pick to make, so the drafting keys leave the panel (and do nothing). */
export function lobbyKeys(yourTurn: boolean): readonly KeyBinding[] {
	return yourTurn ? [CALL, MARK, DRAFT_MARKED, QUEUE, SEARCH] : [MARK, QUEUE, SEARCH];
}

export interface RoomKeyActions {
	/** Enter: our call, never anyone else. */
	draftCall: () => void;
	/** D: the marked player, our call until the arrows move. */
	draftMarked: () => void;
	/** The arrows: -1 up, 1 down. */
	move: (step: -1 | 1) => void;
	queue: () => void;
	undo?: () => void;
}

const DRAFTING_KEYS: ReadonlySet<string> = new Set(['Enter', 'd', 'D']);

function isTyping(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable ||
			['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName))
	);
}

/** The window's keydown handler for a room. */
export function roomKeys(actions: RoomKeyActions): (event: KeyboardEvent) => void {
	return (event) => {
		if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
		// A held drafting key is one pick, never a run of them.
		if (event.repeat && DRAFTING_KEYS.has(event.key)) {
			event.preventDefault();
			return;
		}
		switch (event.key) {
			case 'Enter':
				actions.draftCall();
				break;
			case 'd':
			case 'D':
				actions.draftMarked();
				break;
			case 'ArrowDown':
				actions.move(1);
				break;
			case 'ArrowUp':
				actions.move(-1);
				break;
			case 'q':
			case 'Q':
				actions.queue();
				break;
			case 'u':
			case 'U':
				if (!actions.undo) return;
				actions.undo();
				break;
			default:
				return;
		}
		event.preventDefault();
	};
}
