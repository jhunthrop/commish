<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { plural } from '#lib/format/number.ts';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { POSITIONS } from '#lib/types/player.ts';
	import { FORMAT_LABELS } from './format.ts';
	import { ranksOf } from './model.ts';
	import { sheetStore as store } from './store.svelte.ts';
	import { tagLabel } from './tags.ts';

	/** Your sheet on paper: one page per position, your order, your tiers as rules across the
	 * column, tags and the first line of each note. */

	onMount(() => store.load());

	/** The list runs in three columns, and each column says what its numbers are. */
	const COLUMN_HEADS = [1, 2, 3] as const;

	const sheet = $derived(store.sheet);
	const ranks = $derived(ranksOf(sheet.rows));
	const pages = $derived(
		POSITIONS.map((position) => ({
			position,
			rows: sheet.rows.filter((row) => row.position === position)
		})).filter((page) => page.rows.length > 0)
	);
</script>

<svelte:head>
	<title>{sheet.name} · Print · Commish</title>
</svelte:head>

<div class="bar">
	<Quiet href={resolve('/sheet')}>Back to your sheet</Quiet>
	<Verb onclick={() => window.print()} disabled={pages.length === 0}>Print</Verb>
</div>

<main class="paper">
	{#each pages as page (page.position)}
		<section class="page">
			<header>
				<h1>{page.position}</h1>
				<p>
					{sheet.name} · {FORMAT_LABELS[sheet.format]} · {plural(page.rows.length, 'player')}
				</p>
			</header>
			<div class="heads" aria-hidden="true">
				{#each COLUMN_HEADS as column (column)}
					<span class="head"
						><span>{page.position}</span><span>Player</span><span>Overall</span></span
					>
				{/each}
			</div>
			<ol>
				{#each page.rows as row, index (row.id)}
					{@const previous = page.rows[index - 1]}
					{#if row.tier !== null && previous?.tier !== row.tier}
						<li class="tier">Tier {row.tier}</li>
					{/if}
					<li class="row">
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
		columns: 3;
		column-gap: 0.25in;
	}

	li {
		break-inside: avoid;
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
