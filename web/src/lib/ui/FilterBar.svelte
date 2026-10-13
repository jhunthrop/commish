<script lang="ts">
	import type { Snippet } from 'svelte';

	/** The chip groups over a list: they wrap on a desk, and on the phone they run in one line that
	 * scrolls sideways edge to edge, with room above and below for each chip's 44px hit area. */
	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
</script>

<div class="bar">{@render children()}</div>

<style>
	.bar {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-3);
	}

	@media (max-width: 760px) {
		.bar {
			flex-wrap: nowrap;
			overflow-x: auto;
			margin: calc(-1 * var(--s-2)) calc(-1 * var(--s-4));
			padding: var(--s-2) var(--s-4);
			scrollbar-width: none;
		}
	}
</style>
