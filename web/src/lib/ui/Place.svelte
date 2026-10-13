<script lang="ts">
	import { ordinal } from '#lib/format/number.ts';
	/**
	 * A player's place on your sheet: quiet, in the number face, after the person. It is never
	 * printed inside a position pill, which carries our board's rank on every page. It carries no
	 * hidden words: a clipped span in each of hundreds of rows slows a drag's auto-scroll, so the
	 * row's handle names the place ("Move Puka Nacua, 1 on your sheet") and lists are ordered.
	 */
	interface Props {
		place: number;
		/** Print it as a place, "2nd", where it stands alone beside a mark rather than in an ordered list. */
		ordinal?: boolean;
	}

	let { place, ordinal: asOrdinal = false }: Props = $props();
</script>

<span class="place">{asOrdinal ? ordinal(place) : place}</span>

<style>
	.place {
		font-family: var(--font-num);
		font-weight: 700;
		font-size: var(--t-md);
		color: var(--ink-3);
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
</style>
