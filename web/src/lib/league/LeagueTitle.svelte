<script lang="ts">
	import { links } from '#lib/site/links.ts';
	import DisplayTitle from '#lib/ui/DisplayTitle.svelte';
	import Menu from '#lib/ui/Menu.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import type { AttachedLeague } from './api.ts';
	import { hostWords } from './model.ts';

	/** The league page's title. With more than one league followed it is the switch: the league's
	 * name opens the others, one tap each, and the whole list. One league, it is only the name. */
	interface Props {
		/** The league on the page. */
		id: string;
		name: string;
		/** Every league the account follows, this one among them. */
		leagues: readonly AttachedLeague[];
	}

	let { id, name, leagues }: Props = $props();

	const others = $derived(leagues.filter((l) => l.id !== id));

	function leagueName(league: AttachedLeague): string {
		return league.name || `Your ${hostWords(league.host)} league`;
	}
</script>

<DisplayTitle size="page">
	{#if others.length > 0}
		<Menu label={name} id="league-switch" face="title">
			{#each others as league (league.id)}
				<Quiet size="sm" href={links.league(league.id)}>{leagueName(league)}</Quiet>
			{/each}
			<Quiet size="sm" href={links.accountLeagues()}>All your leagues</Quiet>
		</Menu>
	{:else}
		{name}
	{/if}
</DisplayTitle>
