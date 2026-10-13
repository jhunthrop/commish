<script lang="ts">
	import Search from '#lib/ui/Search.svelte';
	import SearchMenu from '#lib/ui/SearchMenu.svelte';
	import type { SearchHit } from '#lib/ui/search-hit.ts';
	import { searchHit, searchPlayers, type SearchablePlayer } from './search.ts';

	interface Props {
		/** Names the field: "First player". */
		label: string;
		players: readonly SearchablePlayer[];
		onpick: (player: SearchablePlayer) => void;
	}

	let { label, players, onpick }: Props = $props();

	const id = $props.id();
	const menuId = `${id}-menu`;
	let query = $state('');
	let active = $state(0);
	let open = $state(false);

	const found = $derived(searchPlayers(players, query));
	const hits = $derived<SearchHit[]>(found.map(searchHit));
	const showing = $derived(open && query.trim() !== '' && hits.length > 0);

	function pick(index: number): void {
		const player = found[index];
		if (!player) return;
		onpick(player);
		query = '';
		open = false;
	}

	function onKeydown(event: KeyboardEvent): void {
		if (!showing) return;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			active = (active + step + hits.length) % hits.length;
		} else if (event.key === 'Enter') {
			event.preventDefault();
			pick(active);
		} else if (event.key === 'Escape') {
			open = false;
		}
	}

	function onClick(event: MouseEvent): void {
		const option = (event.target as HTMLElement).closest('[role="option"]');
		if (!option) return;
		event.preventDefault();
		pick(Number(option.id.slice(menuId.length + 1)));
	}
</script>

<!-- A click on a hit picks him for the comparison instead of opening his page. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="picker" onclick={onClick}>
	<Search
		bind:value={query}
		placeholder="Find a player"
		{label}
		shortcut={false}
		oninput={() => {
			open = true;
			active = 0;
		}}
		controls={menuId}
		expanded={showing}
		activeOption={showing ? `${menuId}-${String(active)}` : undefined}
		onkeydown={onKeydown}
	/>
	{#if showing}<SearchMenu id={menuId} {hits} {active} />{/if}
</div>

<style>
	.picker {
		position: relative;
	}
</style>
