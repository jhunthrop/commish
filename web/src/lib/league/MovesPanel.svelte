<script lang="ts">
	import { dayLabel } from '#lib/format/date.ts';
	import LineList from '#lib/ui/LineList.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import type { LeagueSync } from './api.ts';
	import { moveWords } from './model.ts';

	/** The league's moves this week and last, newest first, each in a sentence. */
	interface Props {
		sync: LeagueSync;
	}

	let { sync }: Props = $props();

	const SHOWN = 12;
	const lines = $derived(
		sync.moves.slice(0, SHOWN).map((move, i) => ({
			key: `${move.at}-${String(i)}`,
			lead: dayLabel(move.at),
			text: `${moveWords(sync, move)}.`
		}))
	);
</script>

<Panel as="section" label="Moves this week and last" padding="sm">
	<PanelHead title="Moves" aside="This week and last" level={2} />
	{#if lines.length > 0}
		<LineList label="Moves this week and last" {lines} />
	{:else}
		<p class="none">Nobody in your league has made a move this week or last.</p>
	{/if}
</Panel>

<style>
	.none {
		margin: 0;
		color: var(--ink-2);
	}
</style>
