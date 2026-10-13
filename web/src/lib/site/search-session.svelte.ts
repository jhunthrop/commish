/** The top bar search once someone uses it: the run's index, the matches for the query, the option
 * the arrow keys are on. Loaded on the field's first focus with the menu it drives, so a page that
 * is only read never downloads either. */
import { resolve } from '$app/paths';
import type { IndexEntry } from '#lib/run/schema.ts';
import type { SearchHit } from '#lib/ui/search-hit.ts';
import { SEARCH_INDEX_URL, searchPlayers, searchable, type SearchablePlayer } from './search.ts';

export class SearchSession {
	query = $state('');
	open = $state(false);
	active = $state(-1);
	private index = $state<SearchablePlayer[] | null>(null);
	private failed = $state(false);

	hits = $derived<SearchHit[]>(
		this.index === null
			? []
			: searchPlayers(this.index, this.query).map((player) => ({
					id: player.id,
					name: player.name,
					position: player.position,
					team: player.team,
					href: resolve('/(run)/players/[slug]', { slug: player.slug })
				}))
	);

	empty = $derived.by(() => {
		if (this.failed) return 'Search is not loading. Try again in a moment.';
		if (this.index === null) return undefined;
		const query = this.query.trim();
		return query === '' ? undefined : `Nobody named ${query} on this board`;
	});

	showing = $derived(
		this.open && this.query.trim() !== '' && (this.hits.length > 0 || this.empty !== undefined)
	);

	async load(): Promise<void> {
		try {
			const response = await fetch(SEARCH_INDEX_URL);
			if (!response.ok) throw new Error(`The search index answered ${String(response.status)}.`);
			this.index = searchable(await response.json<IndexEntry[]>());
			this.failed = false;
		} catch {
			this.failed = true;
		}
	}

	typed(query: string): void {
		this.query = query;
		this.open = true;
		this.active = this.hits.length > 0 ? 0 : -1;
		if (this.failed) void this.load();
	}

	/** Arrows move through the hits, Enter returns the one to open, Escape closes. */
	key(event: KeyboardEvent): SearchHit | null {
		if (event.key === 'Escape') {
			this.open = false;
			return null;
		}
		if (!this.showing || this.hits.length === 0) return null;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			this.active = (this.active + step + this.hits.length) % this.hits.length;
			return null;
		}
		if (event.key !== 'Enter') return null;
		const hit = this.hits[Math.max(this.active, 0)] ?? null;
		if (hit) {
			event.preventDefault();
			this.open = false;
		}
		return hit;
	}
}
