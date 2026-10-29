<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { resolve } from '$app/paths';
	import { plural } from '#lib/format/number.ts';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { POSITIONS } from '#lib/types/player.ts';
	import { FORMAT_LABELS } from './format.ts';
	import { PRINT_WORDS } from './print-words.ts';
	import { ranksOf } from './model.ts';
	import { sheetStore as store } from './store.svelte.ts';
	import { tagLabel } from './tags.ts';
	import HeadTags from '#lib/site/HeadTags.svelte';
	import type { HeadMarkup } from '#lib/site/head.ts';

	/** The page's head, built at prerender (Lane 169); its title names your sheet once it loads. */
	let { head }: { head: HeadMarkup } = $props();

	/** Your sheet on paper: one page per position, your order, your tiers as rules across the
	 * column, tags and the first line of each note. */

	onMount(() => store.load());

	/** The list runs in up to three columns, and each column with players says what its numbers
	 * are. A column the list does not reach gets no heading. */
	const COLUMNS = 3;

	const sheet = $derived(store.sheet);
	const ranks = $derived(ranksOf(sheet.rows));
	const pages = $derived(
		POSITIONS.map((position) => {
			const rows = sheet.rows.filter((row) => row.position === position);
			return { position, count: rows.length, rows };
		}).filter((page) => page.count > 0)
	);

	let paper: HTMLElement | undefined = $state();
	/** How many columns each position's list fills, read from the drawn page. */
	let filled = $state.raw<ReadonlyMap<string, number>>(new Map());

	/** The columns a list reaches: one per distinct left edge among its players. */
	function columnsReached(list: HTMLElement): number {
		const lefts = new Set(
			Array.from(list.querySelectorAll<HTMLElement>('.row'), (row) =>
				Math.round(row.getBoundingClientRect().left)
			)
		);
		return Math.min(COLUMNS, Math.max(1, lefts.size));
	}

	function measure(): void {
		if (!paper) return;
		filled = new Map(
			Array.from(paper.querySelectorAll<HTMLElement>('[data-position]'), (list) => [
				list.dataset.position ?? '',
				columnsReached(list)
			])
		);
	}

	// Measured whenever the pages change, once they are drawn, and again in the printed layout:
	// paper can fill a different number of columns than the screen's preview did.
	$effect(() => {
		if (pages.length > 0) void tick().then(measure);
	});

	onMount(() => {
		const print = window.matchMedia('print');
		const onMedia = (): void => {
			measure();
		};
		print.addEventListener('change', onMedia);
		window.addEventListener('beforeprint', onMedia);
		return () => {
			print.removeEventListener('change', onMedia);
			window.removeEventListener('beforeprint', onMedia);
		};
	});
</script>

<HeadTags title="{sheet.name} · Print" markup={head} />

<div class="bar">
	<Quiet href={resolve('/sheet')}>{PRINT_WORDS.back}</Quiet>
	{#if pages.length > 0}<Verb onclick={() => window.print()}>{PRINT_WORDS.print}</Verb>{/if}
</div>

<main class="paper" bind:this={paper}>
	<!-- An empty sheet says so in one sentence, the bar's link the way back, and no Print verb. -->
	{#if store.loaded && pages.length === 0}
		<div class="empty">
			<EmptyState title={PRINT_WORDS.emptyTitle} line={PRINT_WORDS.emptyLine} />
		</div>
	{/if}
	{#each pages as page (page.position)}
		{@const heads = filled.get(page.position) ?? 0}
		<section class="page">
			<header>
				<h1>{page.position}</h1>
				<p>
					{sheet.name} · {FORMAT_LABELS[sheet.format]} · {plural(page.count, 'player')}
				</p>
			</header>
			<div class="heads" aria-hidden="true">
				{#each Array.from({ length: heads }, (_, column) => column) as column (column)}
					<span class="head"
						><span>{page.position}</span><span>{PRINT_WORDS.player}</span><span
							>{PRINT_WORDS.overall}</span
						></span
					>
				{/each}
			</div>
			<!-- A tier's heading is drawn inside its first player's line, which never breaks, so the
				 heading can never sit at a column's foot apart from him. -->
			<ol class="list" data-position={page.position}>
				{#each page.rows as row, index (row.id)}
					{@const previous = page.rows[index - 1]}
					<li class="row">
						{#if row.tier !== null && previous?.tier !== row.tier}
							<p class="tier">Tier {row.tier}</p>
						{/if}
						<span class="line">
							<span class="rk">{ranks.get(row.id)?.position}</span>
							<span class="who">
								<b>{row.name}</b>
								<span class="team">{row.team ?? ''}</span>
								<span class="all">{ranks.get(row.id)?.overall}</span>
							</span>
							{#if row.tags.length > 0}
								<span class="tags">{row.tags.map(tagLabel).join(', ')}</span>
							{/if}
							{#if row.note}<span class="note">{row.note}</span>{/if}
						</span>
					</li>
				{/each}
			</ol>
		</section>
	{/each}
</main>

<style>
	.bar {
		position: sticky;
		top: 0;
		display: flex;
		justify-content: space-between;
		gap: var(--s-3);
		padding: var(--s-3) var(--s-5);
		background: var(--shell);
		border-bottom: 1px solid var(--shell-line);
	}

	.empty {
		width: min(100%, 8.5in);
		background: var(--surface);
		border-radius: var(--r-md);
	}

	.paper {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--s-5);
		padding: var(--s-5);
		background: var(--surface-2);
	}

	/* Paper is paper in either theme. */
	.page {
		width: 8.5in;
		min-height: 11in;
		padding: 0.4in 0.45in;
		background: var(--paper);
		color: var(--paper-ink);
		box-shadow: var(--shadow-pop);
		font-size: 8pt;
		line-height: 1.2;
	}

	header {
		display: flex;
		align-items: baseline;
		gap: 12pt;
		border-bottom: 1.5pt solid var(--paper-ink);
		padding-bottom: 4pt;
		margin-bottom: 6pt;
	}

	h1 {
		margin: 0;
		font-family: var(--font-num);
		font-weight: 800;
		font-size: 26pt;
		line-height: 1;
	}

	header p {
		margin: 0;
		font-size: 9pt;
	}

	ol {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.list {
		columns: 3;
		column-gap: 0.25in;
	}

	.tier {
		margin: 5pt 0 1pt;
		padding-top: 2pt;
		border-top: 1pt solid var(--paper-ink);
		font-weight: 700;
		font-size: 7.5pt;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.row {
		break-inside: avoid;
	}

	.line {
		display: grid;
		grid-template-columns: 18pt minmax(0, 1fr);
		column-gap: 4pt;
		padding: 1pt 0;
		border-bottom: 0.5pt solid var(--paper-line);
	}

	.rk {
		font-weight: 700;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.who {
		display: flex;
		gap: 4pt;
		align-items: baseline;
		min-width: 0;
	}

	.who b {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.team,
	.all {
		font-size: 7.5pt;
		color: var(--paper-muted);
	}

	.all {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
	}

	.tags,
	.note {
		grid-column: 2;
		font-size: 7.5pt;
		color: var(--paper-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tags {
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.heads {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		column-gap: 0.25in;
		margin-bottom: 2pt;
	}

	.head {
		display: grid;
		grid-template-columns: 18pt minmax(0, 1fr) auto;
		column-gap: 4pt;
		font-size: 6.5pt;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--paper-muted);
	}

	.head span:first-child {
		text-align: right;
		white-space: nowrap;
	}

	@page {
		size: letter;
		margin: 0;
	}

	@media print {
		.bar {
			display: none;
		}

		.paper {
			padding: 0;
			gap: 0;
			background: none;
		}

		.page {
			box-shadow: none;
			min-height: 0;
			break-after: page;
		}

		.page:last-child {
			break-after: auto;
		}
	}
</style>
