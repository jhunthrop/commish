<script lang="ts">
	import { fixed } from '#lib/format/number.ts';
	import type { RangeScale } from '#lib/types/player.ts';

	interface Props {
		floor: number;
		median: number;
		ceiling: number;
		/** The scale to draw on. Omitted, the bar spans his own floor to ceiling. Two players side by
		 * side share one scale so their spans compare. */
		scale?: RangeScale;
	}

	let { floor, median, ceiling, scale }: Props = $props();

	const lo = $derived(scale?.lo ?? floor);
	const hi = $derived(scale?.hi ?? ceiling);

	function at(points: number): number {
		if (hi <= lo)
			throw new RangeError(`An outcome bar needs a ceiling above its floor, got ${lo} to ${hi}.`);
		return Math.min(100, Math.max(0, ((points - lo) / (hi - lo)) * 100));
	}

	const left = $derived(at(floor));
	const right = $derived(at(ceiling));
	const mid = $derived(at(median));
</script>

<span class="outcome">
	<span class="bar">
		<span class="span" style:left="{left.toFixed(1)}%" style:width="{(right - left).toFixed(1)}%"
		></span>
		<span class="med" style:left="{mid.toFixed(1)}%"></span>
	</span>
	<span class="ticks">
		<span class="tick start" style:left="{left.toFixed(1)}%">{fixed(floor, 0)}</span>
		<span class="tick" style:left="{mid.toFixed(1)}%">{fixed(median, 0)}</span>
		<span class="tick stop" style:left="{right.toFixed(1)}%">{fixed(ceiling, 0)}</span>
	</span>
</span>

<style>
	.outcome {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-top: 6px;
	}

	.bar {
		position: relative;
		height: 10px;
		border-radius: 5px;
		background: var(--surface-2);
	}

	.span {
		position: absolute;
		top: 0;
		bottom: 0;
		border-radius: 5px;
		background: var(--line-strong);
	}

	.med {
		position: absolute;
		top: -5px;
		width: 4px;
		height: 20px;
		margin-left: -2px;
		border-radius: 2px;
		/* Ink, not the accent: orange marks the brand, the verb and you, and a median is none of those. */
		background: var(--ink);
	}

	.ticks {
		position: relative;
		height: 22px;
	}

	.tick {
		position: absolute;
		top: 0;
		transform: translateX(-50%);
		font-family: var(--font-num);
		font-weight: 700;
		font-size: var(--t-lg);
		font-variant-numeric: tabular-nums;
	}

	.start {
		transform: none;
	}

	.stop {
		transform: translateX(-100%);
	}
</style>
