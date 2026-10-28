/** The player shelf on SvelteKit's navigation (Lane 113): a shallow navigation for the card's
 * address, the page's state for the card open, the history for back. shelf-state.ts holds the rules. */
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { provideShelfOpener } from './shelf-context.ts';
import { ShelfHost, type ShelfNav, type ShelfOptions } from './shelf-state.ts';

let loading: Promise<typeof import('./PlayerShelf.svelte')> | null = null;

/** The shelf's script, loaded once: at the first finger or focus on a name, at the screen's first
 * idle moment, or at the tap, whichever comes first, so the tap draws the row's cells at once. */
export function loadShelf(): Promise<typeof import('./PlayerShelf.svelte')> {
	loading ??= import('./PlayerShelf.svelte');
	return loading;
}

const KIT: ShelfNav = {
	href: () => window.location.href,
	card: () => page.state.card,
	cardIn: () => page.state.cardIn,
	go: (href, { state, replace = false }) => {
		const shallow = state !== undefined;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- the current page's own address, or a verb's link built with resolve() (links.ts, tabs.ts).
		void goto(href, { replace, ...(shallow ? { shallow, state, reset: false } : {}) });
	},
	back: () => history.back(),
	focus: (id) => {
		const target = document.getElementById(id);
		if (target === null) return false;
		target.scrollIntoView({ block: 'start' });
		target
			.querySelector<HTMLElement>('button, [href], input, select')
			?.focus({ preventScroll: true });
		return true;
	},
	warm: () => void loadShelf()
};

/** Called by the screen in its own setup: its rows' names open the shelf from here on. */
export function providePlayerShelf(options: ShelfOptions): ShelfHost {
	const host = new ShelfHost(options, KIT);
	provideShelfOpener(host);
	return host;
}
