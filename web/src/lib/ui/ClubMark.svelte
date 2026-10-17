<script lang="ts">
	/** A club's mark where a player's face sits (a defense's row): the same circle and ground as Face,
	 * the mark drawn whole inside it rather than cut wide like a headshot. Its own component, so the
	 * shell's Face carries no mark mode. */
	interface Props {
		src: string;
		/** Diameter in pixels, as Face's. */
		size: number;
		/** The mark in words: "Texans defense". */
		alt: string;
	}

	let { src, size, alt }: Props = $props();
</script>

<span class="mark" style:--mark-size="{size}px">
	<img {src} {alt} width={size} height={size} loading="lazy" decoding="async" />
</span>

<style>
	.mark {
		flex: none;
		display: grid;
		place-items: center;
		width: var(--mark-size);
		height: var(--mark-size);
		border-radius: 50%;
		background: var(--surface-2);
		overflow: hidden;
	}

	img {
		width: 76%;
		height: auto;
		display: block;
	}
</style>
