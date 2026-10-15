<script lang="ts">
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import { LEAGUE_TABS, type LeagueTab } from './tabs.ts';

	/** A followed league's pages under its title: the league itself, then start and sit, waivers and
	 * trades. Each a link, the page you are on pressed. */
	interface Props {
		id: string;
		current: LeagueTab;
	}

	let { id, current }: Props = $props();
</script>

<nav class="tabs" aria-label="Your league's pages">
	<ChipGroup label="Your league's pages">
		{#each LEAGUE_TABS as tab (tab.tab)}
			<Chip href={tab.href(id)} pressed={tab.tab === current}>{tab.label}</Chip>
		{/each}
	</ChipGroup>
</nav>

<style>
	/* The four fit a phone's width on one line; a narrower screen scrolls the strip, never the page. */
	.tabs {
		display: flex;
		max-width: 100%;
		overflow-x: auto;
		scrollbar-width: none;
	}
</style>
