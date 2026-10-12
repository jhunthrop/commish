<script lang="ts">
	import type { Snippet } from 'svelte';

	/** The system page's column: the display title, then its sections. */
	interface Props {
		title: string;
		children: Snippet;
	}

	let { title, children }: Props = $props();
</script>

<main class="doc">
	<h2>{title}</h2>
	{@render children()}
</main>

<style>
	.doc {
		padding: var(--s-6) var(--s-6) var(--s-7);
		display: flex;
		flex-direction: column;
		gap: var(--s-7);
		max-width: 1240px;
		min-width: 0;
	}

	h2 {
		margin: 0;
		font-family: var(--font-num);
		font-weight: 800;
		font-size: clamp(3.5rem, 8vw, 6.5rem);
		line-height: 0.82;
		text-transform: uppercase;
	}

	@media (max-width: 760px) {
		.doc {
			padding: var(--s-5) var(--s-4) var(--s-6);
			gap: var(--s-6);
		}
	}
</style>
