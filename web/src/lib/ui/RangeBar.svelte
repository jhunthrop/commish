<script lang="ts">
	import { fixed, spanWords } from '#lib/format/number.ts';
	import type { RangeScale } from '#lib/types/player.ts';
	import Label from './Label.svelte';
	import { rangePercent } from './range.ts';

	interface Props {
		floor: number;
		median: number;
		ceiling: number;
		/** The scale every bar in the view shares, so spans compare across rows. */
		scale: RangeScale;
		/** stacked prints "242 to 446" under the bar. inline puts the two ends either side of it in the
		 * number face, a board row's cell under its Floor to ceiling head (Lane 66n). */
		form?: 'stacked' | 'inline';
	}

	let { floor, median, ceiling, scale, form = 'stacked' }: Props = $props();

	const left = $derived(rangePercent(floor, scale));
	const width = $derived(rangePercent(ceiling, scale) - left);
	const mid = $derived(rangePercent(median, scale));
</script>

{#snippet bar()}
	<span class="bar">
		<span class="span" style:left="{left.toFixed(1)}%" style:width="{width.toFixed(1)}%"></span>
		<span class="med" style:left="{mid.toFixed(1)}%"></span>
	</span>
{/snippet}

{#if form === 'inline'}
	<span class="inline">
		<span class="end lo">{fixed(floor)}</span>{@render bar()}<span class="end"
			>{fixed(ceiling)}</span
		>
	</span>
{:else}
	<span class="range">
		{@render bar()}
		<Label size="cell">{spanWords(floor, ceiling)}</Label>
	</span>
{/if}

<style>
	.range {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		height: calc(var(--row-h) - 8px);
	}

	.inline {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.inline .bar {
		flex: 1;
	}

	.end {
		flex: none;
		width: 5ch;
		font-family: var(--font-num);
		font-size: 14px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--ink-3);
	}

	.lo {
		text-align: right;
	}

	.bar {
		position: relative;
		height: 8px;
		border-radius: 4px;
		background: var(--surface-2);
	}

	.span {
		position: absolute;
		top: 0;
		bottom: 0;
		border-radius: 4px;
		background: var(--line-strong);
	}

	.med {
		position: absolute;
		top: -4px;
		width: 3px;
		height: 16px;
		border-radius: 2px;
		background: var(--ink);
		margin-left: -1px;
	}
</style>
