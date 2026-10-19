<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** The room itself: the bar, the strips, the call, the pool, the wall. */
		children: Snippet;
		/** The dock beside it: your team, the keys. Below the room on a phone. */
		dock: Snippet;
		/** The report's wider column and gutter. */
		variant?: 'room' | 'report';
	}

	let { children, dock, variant = 'room' }: Props = $props();
</script>

<main class={variant}>
	<div class="content">{@render children()}</div>
	<aside class="dock">{@render dock()}</aside>
</main>

<style>
	main {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 352px;
		gap: var(--s-5);
		padding: var(--s-4) var(--s-5) var(--s-6);
	}

	.report {
		padding-bottom: var(--s-7);
	}

	/* Where the pool carries a Gap, the call card's grid takes the pool's Gap track too, so every figure
	   sits over the pool's column for it (review 81 finding 2). */
	.content:has(:global([data-pool-gap])) {
		--gap-track: 76px;
		--gap-display: block;
	}

	.content {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
	}

	.dock {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		align-self: start;
		position: sticky;
		top: 84px;
		min-width: 0;
	}

	@media (max-width: 1180px) {
		main {
			grid-template-columns: minmax(0, 1fr) 300px;
		}
	}

	@media (max-width: 760px) {
		main {
			grid-template-columns: minmax(0, 1fr);
			padding: var(--s-3) var(--s-4) var(--s-5);
			gap: var(--s-3);
		}

		.dock {
			position: static;
		}
	}
</style>
