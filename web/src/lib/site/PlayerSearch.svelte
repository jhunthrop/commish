<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Search from '#lib/ui/Search.svelte';
	import SearchMenu from '#lib/ui/SearchMenu.svelte';
	import type { SearchHit } from '#lib/ui/search-hit.ts';
	import type { IndexEntry } from '#lib/run/schema.ts';
	import { SEARCH_INDEX_URL, searchPlayers, searchable, type SearchablePlayer } from './search.ts';

	interface Props {
		/** How many players the run has pages for, for the placeholder. */
		players: number;
	}

	let { players: count }: Props = $props();

	const MENU_ID = 'player-search-menu';
	let query = $state('');
	let index = $state<SearchablePlayer[] | null>(null);
	let failed = $state(false);
	let active = $state(-1);
	let open = $state(false);

	const hits = $derived<SearchHit[]>(
		index === null
			? []
			: searchPlayers(index, query).map((player) => ({
					id: player.id,
					name: player.name,
					position: player.position,
					team: player.team,
					href: resolve('/(run)/players/[slug]', { slug: player.slug })
				}))
	);
	const empty = $derived.by(() => {
		if (failed) return 'Search is not loading. Try again in a moment.';
		if (index === null) return undefined;
		return query.trim() === '' ? undefined : `Nobody named ${query.trim()} on this board`;
	});
	const showing = $derived(open && query.trim() !== '' && (hits.length > 0 || empty !== undefined));

	async function loadIndex(): Promise<void> {
		try {
			const response = await fetch(SEARCH_INDEX_URL);
			if (!response.ok) throw new Error(`The search index answered ${String(response.status)}.`);
			index = searchable(await response.json<IndexEntry[]>());
			failed = false;
		} catch {
			failed = true;
		}
	}

	function onInput(): void {
		open = true;
		active = hits.length > 0 ? 0 : -1;
		if (failed) void loadIndex();
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			open = false;
			return;
		}
		if (!showing || hits.length === 0) return;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			active = (active + step + hits.length) % hits.length;
		} else if (event.key === 'Enter') {
			const hit = hits[Math.max(active, 0)];
			if (hit) {
				event.preventDefault();
				open = false;
				void goto(hit.href);
			}
		}
	}

	function onFocusOut(event: FocusEvent): void {
		const next = event.relatedTarget;
		if (!(next instanceof Node) || !(event.currentTarget as HTMLElement).contains(next))
			open = false;
	}
</script>

<div class="find" onfocusout={onFocusOut} onfocusin={() => (open = true)}>
	<Search
		bind:value={query}
		placeholder="Search {count} players"
		label="Search players"
		onfirstfocus={() => void loadIndex()}
		oninput={onInput}
		controls={MENU_ID}
		expanded={showing}
		activeOption={showing && active >= 0 ? `${MENU_ID}-${String(active)}` : undefined}
		onkeydown={onKeydown}
	/>
	{#if showing}
		<SearchMenu id={MENU_ID} {hits} {active} {empty} />
	{/if}
</div>

<style>
	.find {
		position: relative;
		flex: 1;
		display: flex;
		min-width: 0;
	}
</style>
