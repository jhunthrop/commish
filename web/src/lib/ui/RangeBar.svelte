<script lang="ts">
	import type { RangeScale } from '#lib/types/player.ts';
	import Label from './Label.svelte';

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

	function percent(points: number): number {
		const span = scale.hi - scale.lo;
		if (span <= 0)
			throw new RangeError(`A range scale needs hi above lo, got ${scale.lo} to ${scale.hi}.`);
		return Math.min(100, Math.max(0, ((points - scale.lo) / span) * 100));
	}

	const left = $derived(percent(floor));
	const width = $derived(percent(ceiling) - left);
	const mid = $derived(percent(median));
</script>

{#snippet bar()}
	<span class="bar">
		<span class="span" style:left="{left.toFixed(1)}%" style:width="{width.toFixed(1)}%"></span>
		<span class="med" style:left="{mid.toFixed(1)}%"></span>
	</span>
{/snippet}

{#if form === 'inline'}
	<span class="inline">
		<span class="end lo">{floor.toFixed(0)}</span>{@render bar()}<span class="end"
			>{ceiling.toFixed(0)}</span
		>
	</span>
{:else}
	<span class="range">
		{@render bar()}
		<Label size="cell">{floor.toFixed(0)} to {ceiling.toFixed(0)}</Label>
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
		width: 3ch;
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
