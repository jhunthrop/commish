<script lang="ts">
	import { siteContext } from '#lib/context/context.svelte.ts';
	import { FLAGS } from '#lib/site/flags.ts';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import { leagueTabs, tabHref, type LeagueTab, type TabPhase } from './tabs.ts';
	import { LINES } from './words.ts';

	/** A followed league's pages under its title: the league itself, then the screens its phase has
	 * (tab-list.ts), each a link, the page you are on pressed. Before the draft, after the season, or
	 * with the in-season tools off there is one page, so no tabs. */
	interface Props {
		id: string;
		current: LeagueTab;
	}

	let { id, current }: Props = $props();

	/** The league's phase from the switch's list; a league it lacks yet, or an API from before the
	 * phase, reads as in season, the tabs this page always had. */
	const IN_SEASON: TabPhase = { phase: 'in_season', waivers_open: true };
	const league = $derived(siteContext.leagues.find((l) => l.id === id));
	const tabs = $derived(
		FLAGS.in_season_tools
			? leagueTabs(league && (league as Partial<TabPhase>).phase !== undefined ? league : IN_SEASON)
			: []
	);
</script>

{#if tabs.length > 0}
	<nav class="tabs" aria-label={LINES.leaguePages}>
		<ChipGroup label={LINES.leaguePages}>
			{#each tabs as tab (tab.tab)}
				<Chip href={tabHref(tab.tab, id)} pressed={tab.tab === current}>{tab.label}</Chip>
			{/each}
		</ChipGroup>
	</nav>
{/if}

<style>
	/* The five fit a phone's width on one line; a narrower screen scrolls the strip, never the page. */
	.tabs {
		display: flex;
		max-width: 100%;
		overflow-x: auto;
		scrollbar-width: none;
	}
</style>
