<script lang="ts">
	import './fonts/read.css';
	import type { ReadFigure } from '#lib/run/read-figures.ts';
	import Label from './Label.svelte';

	interface Props {
		/** The capsule as the grounded writer wrote it, paragraphs split by a blank line; null for a
		 * read withheld, its byline alone. */
		body: string | null;
		/** The read's stamp: its day and what it was written from or for, null with none. */
		byline?: string | null;
		/** The week's read in season (Lane 126): a box-score paragraph in the UI face, its byline a
		 * plain caption. Else the season read, in the reading serif. */
		week?: boolean;
		/** Numbers set beside the prose after the first paragraph, each naming its basis where it has
		 * one (run/read-figures.ts): the prose's own, which the run checks appear in it word for word,
		 * and in season the rest of it from the run. */
		pulls: readonly ReadFigure[];
	}

	let { body, byline = null, week = false, pulls }: Props = $props();

	const paragraphs = $derived(
		(body ?? '')
			.split(/\n\s*\n/)
			.map((paragraph) => paragraph.trim())
			.filter((paragraph) => paragraph !== '')
	);
	const [lead, ...rest] = $derived(paragraphs);
	/** When any figure names its basis, every figure keeps the label's line, so the numbers share
	 * one baseline. */
	const labelled = $derived(pulls.some((pull) => pull.label !== undefined));
</script>

<!-- Borrowed from Scout, the season read only: the capsule is writing, so it is set in a reading
     serif. In season the week's read sits among the box score's tiles, so it takes the UI face. -->
<div class="prose" class:week>
	{#if byline}<p class="byline">{byline}</p>{/if}
	{#if lead}<p class="lead">{lead}</p>{/if}
	{#if pulls.length > 0}
		<figure class="pulls">
			{#each pulls as pull, i (i)}
				<div>
					{#if labelled}<span class="slot" class:empty={pull.label === undefined}
							><Label>{pull.label ?? '\u00a0'}</Label></span
						>{/if}<b>{pull.figure}</b><span class="caption">{pull.caption}</span>
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

	/* The read's stamp in the reading face's caption. */
	.prose p.byline {
		margin: 0 0 var(--s-3);
		font-style: italic;
		font-size: var(--t-sm);
		line-height: 1.4;
		color: var(--ink-3);
	}

	/* The week's read in season: the UI face at the box score's body size, its byline a caption like
	   the tiles'. Its selectors outrank the phone's sizes below, so it holds at every width. */
	.prose.week {
		font-family: var(--font-ui);
		max-width: var(--measure-week-read);
	}

	.prose.week p {
		font-size: var(--t-week-read);
		line-height: var(--lh-week-read);
	}

	.prose.week p.byline {
		margin-bottom: var(--s-2);
		font-style: normal;
		font-size: var(--t-byline);
		line-height: var(--lh-byline);
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

	.pulls .caption {
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

		/* A figure's basis takes its own line above it; one with none takes no line here, where each
		   figure is its own row. */
		.slot {
			flex-basis: 100%;
		}

		.slot.empty {
			display: none;
		}

		.pulls b {
			font-size: 34px;
			min-width: 3.2ch;
		}
	}
</style>
