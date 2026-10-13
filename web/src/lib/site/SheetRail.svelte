<script lang="ts">
	import { onMount } from 'svelte';
	import { sheet } from '#lib/sheet/sheet.svelte.ts';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import PlayerLine from '#lib/ui/PlayerLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import { sectionHref } from '#lib/ui/nav.ts';
	import { plural } from '#lib/format/number.ts';
	import { links } from './links.ts';
	import { fetchPlayer, type PlayerData } from './player-data.ts';

	interface Props {
		/** The format whose position ranks the lines print. */
		format: string;
	}

	let { format }: Props = $props();

	/** The rail shows the top of the sheet. The sheet page shows the rest. */
	const SHOWN = 4;

	let top = $state<PlayerData[]>([]);

	const count = $derived(sheet.current.rows.length);
	const aside = $derived(sheet.loaded ? plural(count, 'player') : undefined);

	onMount(() => {
		if (!sheet.loaded) sheet.load();
	});

	$effect(() => {
		const ids = sheet.current.rows.slice(0, SHOWN).map((row) => row.playerId);
		void Promise.all(ids.map((id) => fetchPlayer(id).catch(() => null))).then((found) => {
			top = found.filter((player): player is PlayerData => player !== null);
		});
	});
</script>

<Panel>
	<PanelHead title="Your sheet" {aside} />
	{#if top.length > 0}
		<ul>
			{#each top as player (player.id)}
				<li>
					<PlayerLine
						name={player.name}
						position={player.position}
						positionRank={player.formats[format]?.positionRank}
						team={player.team}
						headshot={player.headshot}
						href={links.player(player.slug)}
					/>
				</li>
			{/each}
		</ul>
	{/if}
	{#if count > SHOWN}
		<div class="more">
			<Quiet href={sectionHref('sheet')} size="sm">All {count} on your sheet</Quiet>
		</div>
	{/if}
</Panel>

<style>
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.more {
		margin-top: var(--s-3);
	}
</style>
