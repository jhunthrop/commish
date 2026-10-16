<script lang="ts">
	import './fonts/read.css';
	import type { ReadFigure } from '#lib/run/read-figures.ts';
	import Label from './Label.svelte';

	interface Props {
		/** The capsule as the grounded writer wrote it, paragraphs split by a blank line. */
		body: string;
		/** Numbers set beside the prose after the first paragraph, each naming its basis where it has
		 * one (run/read-figures.ts): the prose's own, which the run checks appear in it word for word,
		 * and in season the rest of it from the run. */
		pulls: readonly ReadFigure[];
	}

	let { body, pulls }: Props = $props();

	const paragraphs = $derived(
		body
			.split(/\n\s*\n/)
			.map((paragraph) => paragraph.trim())
			.filter((paragraph) => paragraph !== '')
	);
	const [lead, ...rest] = $derived(paragraphs);
</script>

<!-- Borrowed from Scout, player page only: the capsule is writing, so it is set in a reading serif. -->
<div class="prose">
	{#if lead}<p class="lead">{lead}</p>{/if}
	{#if pulls.length > 0}
		<figure class="pulls">
			{#each pulls as pull, i (i)}
				<div>
					{#if pull.label}<Label>{pull.label}</Label>{/if}<b>{pull.figure}</b><span
						>{pull.caption}</span
					>
				</div>
			{/each}
		</figure>
	{/if}
	{#each rest as paragraph, i (i)}
		<p>{paragraph}</p>
	{/each}
</div>

<style>
	.prose {
		font-family: var(--font-read);
		font-optical-sizing: auto;
		max-width: 68ch;
	}

	p {
		margin: 0 0 1em;
		font-size: var(--t-read);
		line-height: 1.62;
		color: var(--ink);
	}

	.lead {
		font-size: 1.375rem;
		line-height: 1.5;
	}

	.pulls {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--s-4);
		margin: var(--s-2) 0 var(--s-5);
		padding-block: var(--s-4);
		border-block: 1px solid var(--line);
	}

	.pulls div {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.pulls b {
		font-weight: 500;
		font-size: var(--t-pull);
		line-height: 1;
		letter-spacing: -0.01em;
		font-variant-numeric: lining-nums tabular-nums;
	}

	.pulls span {
		font-style: italic;
		font-size: var(--t-md);
		line-height: 1.35;
		color: var(--ink-2);
	}

	@media (max-width: 760px) {
		p,
		.lead {
			font-size: 1.0625rem;
		}

		.pulls {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--s-3);
		}

		.pulls div {
			flex-direction: row;
			flex-wrap: wrap;
			align-items: baseline;
			column-gap: var(--s-3);
			row-gap: 2px;
		}

		/* A figure's basis takes its own line above it. */
		.pulls div > :global(.label) {
			flex-basis: 100%;
		}

		.pulls b {
			font-size: 34px;
			min-width: 3.2ch;
		}
	}
</style>
