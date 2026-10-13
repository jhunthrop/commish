<script lang="ts">
	import Panel from '#lib/ui/Panel.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import type { League } from '../api.ts';
	import { lineupWords } from '../words.ts';

	interface Props {
		leagues: readonly League[];
		busy: boolean;
		onmock: (league: League) => void;
	}

	let { leagues, busy, onmock }: Props = $props();
</script>

{#if leagues.length > 0}
	<Panel>
		<h3>Your leagues</h3>
		<ul>
			{#each leagues as league (league.id)}
				{@const lineup = lineupWords(league.settings)}
				<li>
					<div>
						<b>{league.name}</b>
						<span
							>{league.settings.slot === null
								? 'random slot'
								: `slot ${league.settings.slot}`}{lineup ? ` · ${lineup}` : ''}</span
						>
					</div>
					<Quiet size="sm" disabled={busy} onclick={() => onmock(league)}>Mock</Quiet>
				</li>
			{/each}
		</ul>
	</Panel>
{/if}

<style>
	h3 {
		margin: 0 0 var(--s-3);
		font-size: var(--t-md);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}

	li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--s-2);
		padding: var(--s-2) var(--s-3);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		font-size: var(--t-sm);
	}

	li b {
		display: block;
	}

	li span {
		color: var(--ink-3);
		font-size: var(--t-xs);
	}
</style>
