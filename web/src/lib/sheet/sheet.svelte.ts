/** The browser sheet as shared reactive state: read once on mount, written through local.ts. */
import { browserStorage } from '#lib/ui/theme.ts';
import { EMPTY_SHEET, readSheet, saveSheet, withPlayer, type LocalSheet } from './local.ts';

class BrowserSheet {
	current = $state<LocalSheet>(EMPTY_SHEET);
	/** False until the browser copy is read, so a page never shows an empty sheet that is not. */
	loaded = $state(false);

	ids = $derived(new Set(this.current.rows.map((row) => row.playerId)));

	load(): void {
		this.current = readSheet(browserStorage);
		this.loaded = true;
	}

	has(playerId: string): boolean {
		return this.ids.has(playerId);
	}

	add(playerId: string): void {
		this.current = withPlayer(this.current, playerId, new Date());
		saveSheet(browserStorage, this.current);
	}
}

export const sheet = new BrowserSheet();
