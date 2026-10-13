<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Who or what the page is about: "Chris Olave", "New Orleans Saints". */
		title: string;
		/** A face before the name, when the page is a person's. */
		media?: Snippet;
		/** The line under the name: pills, chips, labels. */
		meta?: Snippet;
		/** The page's one big number and its verb, at the right end. Full width on the phone. */
		aside?: Snippet;
	}

	let { title, media, meta, aside }: Props = $props();
</script>

<section class="hero" class:with-media={media !== undefined}>
	{#if media}<div class="media">{@render media()}</div>{/if}
	<div class="ident">
		<h2>{title}</h2>
		{#if meta}<div class="meta">{@render meta()}</div>{/if}
	</div>
	{#if aside}<div class="aside">{@render aside()}</div>{/if}
</section>

<style>
	.hero {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: var(--s-6);
		align-items: center;
		padding: var(--s-6);
		border-radius: var(--r-md);
		background: var(--surface);
		border: 1px solid var(--line);
	}

	.with-media {
		grid-template-columns: auto minmax(0, 1fr) auto;
	}

	.media {
		display: flex;
	}

	.ident {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
		min-width: 0;
	}

	h2 {
		margin: 0;
		font-size: clamp(2rem, 4vw, 3.25rem);
		font-weight: 700;
		line-height: 1;
		letter-spacing: -0.01em;
		text-wrap: balance;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-2);
		align-items: center;
		font-size: var(--t-md);
		color: var(--ink-2);
	}

	.meta :global(a) {
		text-decoration: none;
	}

	.meta :global(a:hover) {
		text-decoration: underline;
	}

	.aside {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--s-4);
	}

	@media (max-width: 760px) {
		.hero,
		.with-media {
			grid-template-columns: auto minmax(0, 1fr);
			gap: var(--s-4);
			padding: var(--s-4);
		}

		.hero:not(.with-media) {
			grid-template-columns: minmax(0, 1fr);
		}

		.aside {
			grid-column: 1 / -1;
			align-items: stretch;
		}
	}
</style>
