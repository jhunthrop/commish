<script lang="ts">
	import { FACE_OVERFILL, headshotSources } from './headshot.ts';
	import { INITIALS_SCALE, initialsOf } from './initials.ts';
	import { FACE_STATUS, type FaceStatus } from './face-status.ts';

	interface Props {
		/** The headshot URL; null or empty for a player with none. */
		src: string | null;
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
		/** Whose face: with no headshot, or one that fails to load, his initials hold the circle. */
		name?: string;
		/** His roster status, marked at the photo's top left: ir is injured reserve. */
		status?: FaceStatus | null;
	}

	let {
		src,
		size,
		alt = '',
		loading = 'lazy',
		ringed = false,
		marked = false,
		phoneSize,
		name,
		status = null
	}: Props = $props();

	/** The URL that failed to load, so a new src gets its own try. */
	let failed = $state<string | null>(null);

	const sources = $derived(
		src === null || src === '' ? null : headshotSources(src, size, phoneSize)
	);
	const showImage = $derived(sources !== null && failed !== src);
	const initials = $derived(name === undefined ? '' : initialsOf(name));
</script>

<!-- The wrapper that holds a status mark over the circle's edge is drawn only with a mark. -->
{#snippet circle()}
	<span
		class="face"
		class:ringed
		class:marked
		class:initials={!showImage && initials !== ''}
		style:--face-size="{size}px"
		style:--face-phone-size={phoneSize === undefined ? undefined : `${String(phoneSize)}px`}
		style:--face-overfill="{FACE_OVERFILL * 100}%"
		style:--face-initials-scale={INITIALS_SCALE}
	>
		{#if showImage && sources}
			<img
				src={sources.src}
				srcset={sources.srcset}
				sizes={sources.sizes}
				{alt}
				{loading}
				width={size}
				height={size}
				decoding="async"
				onerror={() => (failed = src)}
			/>
		{:else if initials !== ''}
			<span aria-hidden="true">{initials}</span>
		{/if}
	</span>
{/snippet}

{#if status}
	<span class="hold">
		{@render circle()}
		<span
			class="status"
			class:lg={(phoneSize ?? size) >= FACE_STATUS.largeFrom}
			role="img"
			aria-label={FACE_STATUS.words[status]}>{FACE_STATUS.marks[status]}</span
		>
	</span>
{:else}
	{@render circle()}
{/if}

<style>
	.hold {
		position: relative;
		display: inline-grid;
		flex: none;
	}

	/* A solid tag over the circle's top left edge, clear of the eyes, ringed in the surface so it
	   parts from the photo. */
	.status {
		position: absolute;
		top: -3px;
		left: -6px;
		padding: 1px 3px;
		border-radius: var(--r-sm);
		background: var(--status-ir-bg);
		color: var(--status-ir-ink);
		box-shadow: 0 0 0 1.5px var(--surface);
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 9px;
		line-height: 1;
		letter-spacing: 0.04em;
	}

	.status.lg {
		top: 4px;
		left: 2px;
		padding: 2px 5px;
		font-size: 13px;
	}

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

	/* No headshot: the initials in the number face, centred, in the secondary ink. */
	.initials {
		place-items: center;
		border: 1px solid var(--line-strong);
		color: var(--ink-2);
		font-family: var(--font-num);
		font-weight: 700;
		font-size: calc(var(--face-size) * var(--face-initials-scale));
		line-height: 1;
		letter-spacing: 0.02em;
	}

	@media (max-width: 760px) {
		.initials {
			font-size: calc(var(--face-phone-size, var(--face-size)) * var(--face-initials-scale));
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
