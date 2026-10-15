<script lang="ts">
	import Label from '#lib/ui/Label.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import type { LeagueHost } from '../api.ts';
	import type { LeagueBoard } from '../board.ts';
	import LineRow from './LineRow.svelte';
	import Screen from './Screen.svelte';
	import type { LineupAdvice } from './types.ts';
	import {
		lineupDecision,
		moveWords,
		satIds,
		slotChanges,
		slotLabels,
		verbWords
	} from './words.ts';

	/** Start and sit (spec §4): this week's lineup slot by slot, ours, and where it differs from the
	 * lineup the host holds, the player it sits with the fact that tipped it; then the bench, the
	 * players a change sits marked. */
	interface Props {
		advice: LineupAdvice;
		board: LeagueBoard;
		host: LeagueHost;
	}

	let { advice, board, host }: Props = $props();

	const labels = $derived(slotLabels(advice.slots.map((s) => s.slot)));
	const changes = $derived(slotChanges(advice.slots));
	/** The host's starters our lineup sits, marked on the bench. */
	const sat = $derived(satIds(advice.slots));
	const starts = $derived(changes.filter((c) => c?.kind === 'start').length);
</script>

<Screen
	decision={lineupDecision(advice)}
	verb={verbWords('start', host)}
	href={advice.host_lineup_url}
	basis={advice.basis}
>
	<div class="grid">
		<Panel as="section" label="Your lineup" padding="none">
			<div class="head">
				<PanelHead
					title={`Your lineup for week ${String(advice.week)}`}
					aside={starts > 0 ? `${String(starts)} to change` : 'Set'}
					level={2}
				/>
			</div>
			{#each advice.slots as slot, i (`${slot.slot}-${String(i)}`)}
				{@const change = changes[i]}
				{#if change?.kind === 'start'}
					<div class="change">
						<LineRow line={change.start} {board} slot={labels[i]} />
						{#if change.sit}<LineRow line={change.sit} {board} slot="Sit" />{/if}
						{#if slot.sentence}<p class="why">{slot.sentence}</p>{/if}
					</div>
				{:else if change?.kind === 'move'}
					<LineRow
						line={slot.ours}
						{board}
						slot={labels[i]}
						note={moveWords(labels[change.from] ?? '')}
					/>
				{:else}
					<LineRow line={slot.ours} {board} slot={labels[i]} />
				{/if}
			{/each}
		</Panel>
		<Panel as="section" label="Your bench" padding="none">
			<div class="head">
				<PanelHead title="Bench" aside="Over repl, rest of season" level={2} />
			</div>
			{#each advice.bench as line (line.player.host_id)}
				<LineRow {line} {board} slot={sat.has(line.player.host_id) ? 'Sit' : 'Bench'} />
			{:else}
				<p class="none"><Label>Nobody on your bench</Label></p>
			{/each}
		</Panel>
	</div>
</Screen>

<style>
	.head {
		padding: var(--s-3) var(--s-3) var(--s-2);
	}

	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
		gap: var(--s-4);
		align-items: start;
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

	@media (max-width: 1100px) {
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
