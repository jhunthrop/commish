<script lang="ts">
	import Face from '#lib/ui/Face.svelte';

	/** A fantasy team's avatar: its initials in the face's circle (the host gives no image we read),
	 * the drafter's own in the accent. On the lit board it takes the board's colours. */
	interface Props {
		name: string;
		size: number;
		me?: boolean;
		/** Drawn on the score bug's black board. */
		board?: boolean;
	}

	let { name, size, me = false, board = false }: Props = $props();
</script>

<span class="avatar" class:me class:board aria-hidden="true"><Face src={null} {name} {size} /></span
>

<style>
	.avatar {
		display: inline-grid;
		flex: none;
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
