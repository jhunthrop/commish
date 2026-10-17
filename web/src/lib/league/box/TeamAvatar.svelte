<script lang="ts">
	import Face from '#lib/ui/Face.svelte';
	import { avatarSrc } from '#lib/ui/avatar.ts';

	/** A fantasy team's avatar: the platform's image where it gives one we show (Sleeper's, from our
	 * own origin), else its initials in the face's circle, the drafter's own in the accent. On the lit
	 * board it takes the board's colours. An image that fails to load falls back to the initials. */
	interface Props {
		name: string;
		size: number;
		me?: boolean;
		/** Drawn on the score bug's black board. */
		board?: boolean;
		/** The platform's image for the team, null for none. */
		src?: string | null;
	}

	let { name, size, me = false, board = false, src = null }: Props = $props();

	const image = $derived(avatarSrc(src));
	/** The image that failed, so a new one gets its own try. */
	let failed = $state<string | null>(null);
</script>

<span class="avatar" class:me class:board aria-hidden="true">
	{#if image !== null && failed !== image}
		<img
			class="img"
			src={image}
			alt=""
			width={size}
			height={size}
			style:width="{size}px"
			style:height="{size}px"
			loading="lazy"
			decoding="async"
			onerror={() => (failed = image)}
		/>
	{:else}
		<Face src={null} {name} {size} />
	{/if}
</span>

<style>
	.avatar {
		display: inline-grid;
		flex: none;
	}

	.img {
		border-radius: 50%;
		object-fit: cover;
		border: 2px solid var(--line-strong);
		background: var(--surface-2);
	}

	.me .img {
		border-color: var(--accent);
	}

	.board .img {
		border-color: var(--scoreboard-line);
	}

	.me.board .img {
		border-color: var(--scoreboard-num);
	}

	.avatar :global(.face) {
		border: 2px solid var(--line-strong);
		color: var(--ink);
		font-weight: 800;
	}

	.board :global(.face) {
		background: var(--scoreboard-2);
		border-color: var(--scoreboard-line);
		color: var(--scoreboard-ink);
	}

	.me :global(.face) {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-ink);
	}

	.me.board :global(.face) {
		background: var(--scoreboard-num);
		border-color: var(--scoreboard-num);
		color: var(--scoreboard-num-ink);
	}
</style>
