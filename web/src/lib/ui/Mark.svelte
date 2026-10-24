<script lang="ts">
	import { MARK_DISC, MARK_PATH, MARK_VIEWBOX, markStroke } from './mark.ts';

	/** The Commish mark, the whistle (mark.ts), in the theme's ink and accent, at the weight its size
	 * takes. Decorative: the link or heading around it names it. */
	interface Props {
		/** The side of the square it is drawn in, in px. */
		size: number;
	}

	let { size }: Props = $props();
</script>

<svg class="mark" width={size} height={size} viewBox={MARK_VIEWBOX} aria-hidden="true"
	><path d={MARK_PATH} stroke-width={markStroke(size)} /><circle
		cx={MARK_DISC.cx}
		cy={MARK_DISC.cy}
		r={MARK_DISC.r}
	/></svg
>

<style>
	.mark {
		display: block;
	}

	path {
		fill: none;
		stroke: var(--ink);
		stroke-linejoin: round;
	}

	circle {
		fill: var(--accent);
	}
</style>
