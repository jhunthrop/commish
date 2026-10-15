<script lang="ts">
	import Label from '#lib/ui/Label.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import type { LeagueHost } from '../api.ts';
	import type { LeagueBoard } from '../board.ts';
	import LineRow from './LineRow.svelte';
	import Screen from './Screen.svelte';
	import type { LineupAdvice } from './api.ts';
	import { LINES, lineupDecision, lineupTitle, satIds, slotLabels, verbWords } from './words.ts';

	/** Start and sit (spec §4): this week's lineup slot by slot, ours, and where it differs from the
	 * lineup the host holds, the player it sits with the fact that tipped it; below it the bench, the
	 * players a change sits marked. One column at every width, as §4.1 lays it out. */
	interface Props {
		advice: LineupAdvice;
		board: LeagueBoard;
		host: LeagueHost;
	}

	let { advice, board, host }: Props = $props();

	const labels = $derived(slotLabels(advice.slots.map((s) => s.slot)));
	/** The host's starters our lineup sits, marked on the bench. */
	const sat = $derived(satIds(advice.slots));
</script>

<Screen
	decision={lineupDecision(advice)}
	verb={verbWords('start', host)}
	href={advice.host_lineup_url}
	basis={advice.basis}
>
	<Panel as="section" label={lineupTitle(advice.week)} padding="none">
		<div class="head">
			<PanelHead title={lineupTitle(advice.week)} aside={LINES.perWeek} level={2} />
		</div>
		{#each advice.slots as slot, i (`${slot.slot}-${String(i)}`)}
			{#if slot.changed}
				<div class="change">
					<LineRow line={slot.ours} {board} slot={labels[i]} />
					{#if slot.host}<LineRow line={slot.host} {board} slot={LINES.sit} />{/if}
					{#if slot.sentence}<p class="why">{slot.sentence}</p>{/if}
				</div>
			{:else}
				<LineRow line={slot.ours} {board} slot={labels[i]} />
			{/if}
		{/each}
	</Panel>
	<Panel as="section" label={LINES.bench} padding="none">
		<div class="head">
			<PanelHead title={LINES.bench} aside={LINES.perWeek} level={2} />
		</div>
		{#each advice.bench as line (line.player.host_id)}
			<LineRow {line} {board} slot={sat.has(line.player.host_id) ? LINES.sit : LINES.bench} />
		{:else}
			<p class="none"><Label>{LINES.noBench}</Label></p>
		{/each}
	</Panel>
</Screen>

<style>
	.head {
		padding: var(--s-3) var(--s-3) var(--s-2);
	}

	/* A change is ours over the host's, on our wash, with the fact that tipped it. */
	.change {
		background: var(--accent-wash);
		border-left: 4px solid var(--accent);
	}

	.why {
		margin: 0;
		padding: var(--s-2) var(--s-3) var(--s-3);
		font-size: var(--t-sm);
		color: var(--ink);
		border-bottom: 1px solid var(--line);
	}

	.none {
		margin: 0;
		padding: var(--s-3);
		color: var(--ink-3);
		font-size: var(--t-sm);
	}
</style>
