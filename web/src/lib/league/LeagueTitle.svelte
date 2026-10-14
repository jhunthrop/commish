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

{#if others.length > 0}
	<!-- The switch's list cannot sit inside a heading, so the heading is named apart and the title is
	     drawn in its face around the switch. -->
	<h2 class="named">{name}</h2>
	<DisplayTitle size="page" as="face">
		<Menu label={name} id="league-switch" face="title">
			{#each others as league (league.id)}
				<Quiet size="sm" href={links.league(league.id)}>{leagueName(league)}</Quiet>
			{/each}
			<Quiet size="sm" href={links.accountLeagues()}>All your leagues</Quiet>
		</Menu>
	</DisplayTitle>
{:else}
	<DisplayTitle size="page">{name}</DisplayTitle>
{/if}

<style>
	.named {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
