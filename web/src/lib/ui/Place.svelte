<script lang="ts">
	/**
	 * A player's place on your sheet: quiet, in the number face, after the person. It is never
	 * printed inside a position pill, which carries our board's rank on every page.
	 */
	interface Props {
		place: number;
	}

	let { place }: Props = $props();
</script>

<span class="place">{place}<span class="hidden"> on your sheet</span></span>

<style>
	.place {
		font-family: var(--font-num);
		font-weight: 700;
		font-size: var(--t-md);
		color: var(--ink-3);
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
