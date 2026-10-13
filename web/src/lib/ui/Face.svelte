<script lang="ts">
	import { FACE_OVERFILL, headshotSources } from './headshot.ts';

	interface Props {
		/** The headshot URL. */
		src: string;
		/** Diameter in pixels: 22 on the wall, 32 in a list, 36 on a strip, 40 on a row, 72 on a call. */
		size: number;
		/** Empty when the name sits beside the face, which is everywhere a face appears today. */
		alt?: string;
		/** Faces above the fold on a prerendered page load eagerly so they count toward first paint. */
		loading?: 'lazy' | 'eager';
		/** A ring in the accent: a player from your queue. */
		ringed?: boolean;
		/** A ring in ink: the newest pick. */
		marked?: boolean;
		/** A smaller diameter on the phone, for a hero face: 168 on a desk, 96 in a hand. */
		phoneSize?: number;
	}

	let {
		src,
		size,
		alt = '',
		loading = 'lazy',
		ringed = false,
		marked = false,
		phoneSize
	}: Props = $props();

	const sources = $derived(headshotSources(src, size));
</script>

<span
	class="face"
	class:ringed
	class:marked
	style:--face-size="{size}px"
	style:--face-phone-size={phoneSize === undefined ? undefined : `${String(phoneSize)}px`}
	style:--face-overfill="{FACE_OVERFILL * 100}%"
>
	<img
		src={sources.src}
		srcset={sources.srcset}
		{alt}
		{loading}
		width={size}
		height={size}
		decoding="async"
	/>
</span>

<style>
	.face {
		flex: none;
		width: var(--face-size);
		height: var(--face-size);
		border-radius: 50%;
		background: var(--surface-2);
		overflow: hidden;
		display: grid;
		place-items: end center;
	}

	@media (max-width: 760px) {
		.face {
			width: var(--face-phone-size, var(--face-size));
			height: var(--face-phone-size, var(--face-size));
		}
	}

	.ringed {
		box-shadow: 0 0 0 2px var(--accent);
	}

	.marked {
		box-shadow: 0 0 0 2px var(--ink);
	}

	/* Headshots are cut wide with the face high, so the image overfills the circle and sits low. */
	img {
		width: var(--face-overfill);
		max-width: none;
		height: auto;
		display: block;
		transform: translateY(6%);
	}
</style>
