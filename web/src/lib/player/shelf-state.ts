/** The screen's side of the player shelf (Lane 113): a box row's name opens his card over the screen
 * as a shallow navigation to the screen's own address with ?card=<slug>, so the back button closes
 * it and a reload reopens it. The navigation is given (shelf-host.ts gives SvelteKit's), so the
 * tests drive open, close, back and the address without a browser. */
import type { BoxRow } from '#lib/league/box/box.ts';
import type { ShelfOpener } from './shelf-context.ts';
import type { CardLeague } from './week-words.ts';

/** The screens whose rows open the shelf, each with its one verb. */
export type ShelfScreen =
	'lineup' | 'matchup' | 'league' | 'waivers' | 'trades' | 'players' | 'rest';

/** What the screen's row offers him: the verb in the screen's own words (label), or in the card's for
 * the way to his row on the Lineup and for Compare (shelf.ts words those once the shelf loads); the
 * line under it; and where it goes or what it does on the screen (the Waivers claim with its drop,
 * the trade builder, his row on the Lineup). */
export type ScreenOffer = ({ label: string } | { card: 'openLineup' | 'compare' }) & {
	line: string | null;
	href: string | null;
	run: (() => void) | null;
	/** The id of what the run opens on the screen (the claim's confirmation, the trade builder), which
	 * takes the focus once the shelf closes; null gives it back to the name tapped. */
	focus: string | null;
};

/** A lineup screen's offer: the way to his row on the Lineup. */
export function lineupOffer(to: { href: string } | { run: () => void }): ScreenOffer {
	return {
		card: 'openLineup',
		line: null,
		href: 'href' in to ? to.href : null,
		run: 'run' in to ? to.run : null,
		focus: null
	};
}

/** The Players screen's offer: Compare, the comparison page with him on one side. */
export function compareOffer(href: string): ScreenOffer {
	return { card: 'compare', line: null, href, run: null, focus: null };
}

/** His row among a screen's rows by his page's slug, for a card reopened from the address. */
export function rowBySlug(rows: Iterable<BoxRow>, slug: string): BoxRow | null {
	for (const row of rows) if (row.slug === slug) return row;
	return null;
}

/** The address field naming the player whose card is open over the screen, by his page's slug. Not
 * ?player=, which already names the player a link asks a league screen for by his board id (asked.ts). */
export const SHELF_PARAM = 'card';

/** The address with his card open (a slug) or closed (null), everything else kept. */
export function shelfHref(href: string, slug: string | null): string {
	const url = new URL(href);
	if (slug === null) url.searchParams.delete(SHELF_PARAM);
	else url.searchParams.set(SHELF_PARAM, slug);
	return url.href;
}

/** The slug whose card the address opens, null with none. */
export function shelfSlug(href: string): string | null {
	const slug = new URL(href).searchParams.get(SHELF_PARAM);
	return slug === null || slug === '' ? null : slug;
}

/** The click's parts the shelf reads. */
export type ShelfClick = Pick<
	MouseEvent,
	'defaultPrevented' | 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'preventDefault'
> & { currentTarget: unknown };

/** A plain primary click, which the shelf takes; any other (a new tab, a new window) goes to the
 * link's page as the browser would. */
export function plainClick(event: ShelfClick): boolean {
	return (
		!event.defaultPrevented &&
		event.button === 0 &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.shiftKey &&
		!event.altKey
	);
}

/** What the screen tells its shelf. */
export interface ShelfOptions {
	screen: ShelfScreen;
	/** The league his week is read in (the screen's), null with none. */
	league: () => CardLeague | null;
	/** The screen's verb for his row, null where it gives him none. */
	offer: (row: BoxRow) => ScreenOffer | null;
	/** His row on the screen by his slug, for a card reopened from the address (a reload). */
	rowOf?: (slug: string) => BoxRow | null;
}

/** A navigation's options as the shelf asks for them. */
export interface ShelfGo {
	/** The page's state for a shallow navigation; a verb's link leaves the screen without one. */
	state?: App.PageState;
	replace?: boolean;
}

/** The browser as the shelf uses it. */
export interface ShelfNav {
	/** The address now. */
	href: () => string;
	/** The card the page's state holds open, by slug. */
	card: () => string | undefined;
	/** To an address: shallow with a state (the screen stays), a full navigation without. */
	go: (href: string, options: ShelfGo) => void;
	back: () => void;
	/** Brings what an id names into view and focuses its first control; false when it is not there. */
	focus: (id: string) => boolean;
}

/** What takes the focus back. */
interface Focusable {
	focus: () => void;
	isConnected: boolean;
}

function focusable(target: unknown): Focusable | null {
	return typeof target === 'object' &&
		target !== null &&
		'focus' in target &&
		'isConnected' in target
		? (target as Focusable)
		: null;
}

export class ShelfHost implements ShelfOpener {
	readonly options: ShelfOptions;
	readonly #nav: ShelfNav;
	/** Each row tapped, by slug: the shelf opens on its cells at once. */
	readonly #rows = new Map<string, BoxRow>();
	/** The name tapped, which takes the focus back once the shelf closes. */
	#opener: Focusable | null = null;
	/** Whether the open card is the history entry this screen pushed (else it came with the address). */
	#pushed = false;
	/** What takes the focus once the shelf closes in place of the name: what its verb opened. */
	#target: string | null = null;

	constructor(options: ShelfOptions, nav: ShelfNav) {
		this.options = options;
		this.#nav = nav;
	}

	/** The slug whose card is open, null with none. */
	get slug(): string | null {
		return this.#nav.card() ?? null;
	}

	/** The row the card opened from, null when the screen holds none for him. */
	row(slug: string): BoxRow | null {
		return this.#rows.get(slug) ?? this.options.rowOf?.(slug) ?? null;
	}

	open = (event: ShelfClick, row: BoxRow): void => {
		const { slug } = row;
		if (slug === null || !plainClick(event)) return;
		event.preventDefault();
		this.#rows.set(slug, row);
		this.#opener = focusable(event.currentTarget);
		this.#pushed = true;
		this.#nav.go(shelfHref(this.#nav.href(), slug), { state: { card: slug } });
	};

	/** Back to the screen: the history entry the open pushed, or the address without the card; the
	 * focus then goes to what the verb opened (focus), else back to the name tapped. */
	close = (focus: string | null = null): void => {
		this.#target = focus;
		if (this.#pushed) {
			this.#pushed = false;
			this.#nav.back();
			return;
		}
		this.#nav.go(shelfHref(this.#nav.href(), null), { state: {}, replace: true });
	};

	/** A verb that leaves the screen: the shelf's entry gives way to the screen it opens, so back
	 * returns to the screen the member was on. */
	leave = (href: string): void => {
		this.#pushed = false;
		this.#nav.go(href, { replace: true });
	};

	/** The card the address names, opened once the screen is (a reload, a shared link). */
	restore(): void {
		const href = this.#nav.href();
		const slug = shelfSlug(href);
		if (slug !== null && this.slug === null)
			this.#nav.go(href, { state: { card: slug }, replace: true });
	}

	/** The focus on what the verb opened, else back on the name that opened the card while it is
	 * still on the screen. */
	refocus(): void {
		const target = this.#target;
		this.#target = null;
		const opener = this.#opener;
		this.#opener = null;
		if (target !== null && this.#nav.focus(target)) return;
		if (opener?.isConnected) opener.focus();
	}
}
