/** The room's keyboard: Enter drafts our call, the arrows move through the pool, Q queues, U undoes,
 * / searches (the Search primitive owns /). The keys panel lists exactly these. */
import type { KeyBinding } from '#lib/types/room.ts';

export const SOLO_KEYS: readonly KeyBinding[] = [
	{ keys: 'Enter', does: 'draft our call' },
	{ keys: '↑ ↓', does: 'move through the pool' },
	{ keys: 'Q', does: 'queue the player' },
	{ keys: 'U', does: 'undo your last pick' },
	{ keys: '/', does: 'search the pool' }
];

/** A lobby is other people's draft too, so there is no undo. */
export const LOBBY_KEYS: readonly KeyBinding[] = SOLO_KEYS.filter((k) => k.keys !== 'U');

export interface RoomKeyActions {
	/** Enter: draft the marked row, our call until the arrows move. */
	draft: () => void;
	/** The arrows: -1 up, 1 down. */
	move: (step: -1 | 1) => void;
	queue: () => void;
	undo?: () => void;
}

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
		switch (event.key) {
			case 'Enter':
				actions.draft();
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
