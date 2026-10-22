<script lang="ts">
	import { PAIR_WORDS, oursAccented, type FigurePair } from '#lib/run/record-pair.ts';

	/** One figure for ours and a yardstick at the same size, the leader named under them (Lane 140,
	 * C05): the record's draft tiles and the front door's record card draw it alike. Ours is accented
	 * only where it leads. */
	interface Props {
		label: string;
		/** What the figure is, under its head ("lower is better"); null for none. */
		key?: string | null;
		pair: FigurePair;
		/** The figures' size: the record's bug draws them large, the front card's side panel smaller. */
		size?: 'md' | 'lg';
	}

	let { label, key = null, pair, size = 'lg' }: Props = $props();
</script>

<div class="pair {size}">
	<span class="label">{label}</span>
	{#if key}<span class="key">{key}</span>{/if}
	<span class="figs">
		<span class="fig" class:lead={oursAccented(pair)}
			><small>{PAIR_WORDS.ours}</small><b>{pair.ours}</b></span
		>
		<span class="fig"><small>{pair.name}</small><b>{pair.theirs}</b></span>
	</span>
	{#if pair.lead}<span class="leader">{pair.lead}</span>{/if}
</div>

<style>
	.pair {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.label {
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
	}

	.key,
	.leader {
		font-size: var(--t-xs);
		color: var(--ink-2);
	}

	.leader {
		font-weight: 600;
	}

	.figs {
		display: flex;
		align-items: baseline;
		gap: var(--s-4);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.fig {
		display: flex;
		flex-direction: column;
	}

	small {
		font-size: var(--t-xs);
		font-weight: 600;
		color: var(--ink-3);
	}

	b {
		font-family: var(--font-num);
		font-weight: 800;
		line-height: 1;
		color: var(--ink);
	}

	.lg b {
		font-size: var(--t-2xl);
	}

	.md b {
		font-size: var(--t-xl);
	}

	.fig.lead b {
		color: var(--accent-text);
	}
</style>
