<script lang="ts">
	import type { Move } from './lineup.ts';

	/** A Lineup row the advice moves (Lane 66e): an arrow up on the accent for a player it starts,
	 * an arrow down on grey for a starter it sits. The slot word beside it carries the meaning. Its own
	 * paths, so the shell's icon set does not grow. */
	interface Props {
		move: Move;
		size?: number;
	}

	let { move, size = 18 }: Props = $props();

	const PATH: Readonly<Record<Move, string>> = {
		in: 'M12 19V5M5 12l7-7 7 7',
		out: 'M12 5v14M5 12l7 7 7-7'
	};
</script>

<span class="mark {move}" style:width="{size}px" style:height="{size}px">
	<svg
		width={size - 6}
		height={size - 6}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2.6"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"><path d={PATH[move]} /></svg
	>
</span>

<style>
	.mark {
		display: inline-grid;
		flex: none;
		place-items: center;
		border-radius: 50%;
		vertical-align: -3px;
	}

	.in {
		background: var(--accent);
		color: var(--accent-ink);
	}

	.out {
		background: var(--surface-2);
		color: var(--ink-2);
		box-shadow: inset 0 0 0 1px var(--line-strong);
	}
</style>
