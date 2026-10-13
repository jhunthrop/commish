<script lang="ts">
	import type { Position } from '#lib/types/player.ts';

	interface Props {
		position: Position;
		/** Rank at the position on this board. Omitted where only the position is known. */
		rank?: number;
	}

	let { position, rank }: Props = $props();
</script>

<span class="pos">{position}{rank === undefined ? '' : ` ${rank}`}</span>

<style>
	/* Monochrome on purpose: color is spent on numbers. */
	.pos {
		display: inline-flex;
		align-items: center;
		height: 20px;
		padding: 0 7px;
		border-radius: var(--r-sm);
		background: var(--surface-2);
		color: var(--ink);
		font-size: var(--t-xs);
		font-weight: 700;
		letter-spacing: 0.04em;
		white-space: nowrap;
	}
</style>
