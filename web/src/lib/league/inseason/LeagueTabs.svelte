<script lang="ts">
	import { FLAGS } from '#lib/site/flags.ts';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import { LEAGUE_TABS, tabHref, type LeagueTab } from './tabs.ts';
	import { LINES } from './words.ts';

	/** A followed league's pages under its title: the league itself, then start and sit, waivers and
	 * trades. Each a link, the page you are on pressed. With the in-season tools off there is one
	 * page, so no tabs. */
	interface Props {
		id: string;
		current: LeagueTab;
	}

	let { id, current }: Props = $props();
</script>

{#if FLAGS.in_season_tools}
	<nav class="tabs" aria-label={LINES.leaguePages}>
		<ChipGroup label={LINES.leaguePages}>
			{#each LEAGUE_TABS as tab (tab.tab)}
				<Chip href={tabHref(tab.tab, id)} pressed={tab.tab === current}>{tab.label}</Chip>
			{/each}
		</ChipGroup>
	</nav>
{/if}

<style>
	/* The four fit a phone's width on one line; a narrower screen scrolls the strip, never the page. */
	.tabs {
		display: flex;
		max-width: 100%;
		overflow-x: auto;
		scrollbar-width: none;
	}
</style>
