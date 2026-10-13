/**
 * Your sheet on a nightly page, loaded on the reader's first intent rather than with the page.
 * The sheet lane's store carries the account sync, the merge and the API client, about 8 KB that a
 * page someone only reads never needs. The first pointer, key, touch, wheel or focus loads the store,
 * the rail and the Add to my sheet button together; until then the page draws the same button,
 * which adds the player as soon as the store is in.
 */
import type { Component } from 'svelte';
import type { SheetPlayer } from '#lib/sheet/model.ts';

interface AddToSheetProps {
	player: SheetPlayer;
	variant?: 'verb' | 'row';
	fill?: boolean;
}

interface SheetParts {
	store: typeof import('#lib/sheet/store.svelte.ts').sheetStore;
	Rail: Component<{ shown?: number }>;
	Add: Component<AddToSheetProps>;
}

const INTENT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel', 'focusin'];

class LazySheet {
	parts = $state<SheetParts | null>(null);
	#loading: Promise<SheetParts> | null = null;

	/** Loads the sheet once, however many callers ask. */
	load(): Promise<SheetParts> {
		this.#loading ??= Promise.all([
			import('#lib/sheet/store.svelte.ts'),
			import('#lib/sheet/SheetRail.svelte'),
			import('#lib/sheet/AddToSheet.svelte')
		]).then(([store, rail, add]) => {
			store.sheetStore.load();
			const parts: SheetParts = { store: store.sheetStore, Rail: rail.default, Add: add.default };
			this.parts = parts;
			return parts;
		});
		return this.#loading;
	}

	/** Adds him now if the sheet is in, or as soon as it is. */
	add(player: SheetPlayer): void {
		void this.load().then((parts) => {
			parts.store.add(player);
		});
	}

	has(playerId: string): boolean {
		return this.parts?.store.has(playerId) ?? false;
	}

	/** His place on your sheet, 1-based, or null while he is not on it or the sheet is not in. */
	place(playerId: string): number | null {
		const store = this.parts?.store;
		if (!store?.has(playerId)) return null;
		return store.sheet.rows.findIndex((row) => row.id === playerId) + 1;
	}

	/** Starts the load on the first sign the reader is doing more than reading. Returns the disarm. */
	armOnFirstIntent(target: Window): () => void {
		const start = (): void => {
			disarm();
			void this.load();
		};
		const disarm = (): void => {
			for (const name of INTENT_EVENTS) target.removeEventListener(name, start);
		};
		for (const name of INTENT_EVENTS) target.addEventListener(name, start, { passive: true });
		return disarm;
	}
}

export const lazySheet = new LazySheet();
