<script lang="ts">
	import type { RangeScale } from '#lib/types/player.ts';
	import Label from './Label.svelte';

	interface Props {
		floor: number;
		median: number;
		ceiling: number;
		/** The scale every bar in the view shares, so spans compare across rows. */
		scale: RangeScale;
	}

	let { floor, median, ceiling, scale }: Props = $props();

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

<span class="range">
	<span class="bar">
		<span class="span" style:left="{left.toFixed(1)}%" style:width="{width.toFixed(1)}%"></span>
		<span class="med" style:left="{mid.toFixed(1)}%"></span>
	</span>
	<Label size="cell">{floor.toFixed(0)} to {ceiling.toFixed(0)}</Label>
</span>

<style>
	.range {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		height: calc(var(--row-h) - 8px);
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
