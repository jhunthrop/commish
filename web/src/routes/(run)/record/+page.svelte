<script lang="ts">
	import BasisBlock from '#lib/ui/BasisBlock.svelte';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import ContextNote from '#lib/context/ContextNote.svelte';
	import {
		RECORD_BOX,
		RECORD_FIGURES,
		allLine,
		chartSeries,
		figureWords,
		gradedOrders,
		publishedBeside,
		publishedDrawn,
		ORDER_WORDS,
		recordBasis,
		recordHeadline,
		recordLead,
		recordSources,
		scaleWords,
		scoreOf,
		weekLines,
		type RecordFigure
	} from '#lib/run/record.ts';
	import type { RecordLine } from '#lib/run/schema.ts';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import Figure from '#lib/ui/Figure.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import RecordChart from './RecordChart.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const record = $derived(data.page.record);
	const scoring = $derived(data.page.format.label);
	/** The record is graded in one scoring: with a league selected, the page says the league's too. */
	const note = $derived.by(() => {
		const { league, notes } = siteContext;
		if (league === null || notes === null) return null;
		return `${notes.leagueScores(league)} Our record is graded in ${scoring}.`;
	});
	const headline = $derived(recordHeadline(record));

	/** The figure heads, from the run's own words. */
	const FIGURE_HEADS = $derived<Record<RecordFigure, string>>({
		agreement: record.statistic.agreement,
		placesOff: record.statistic.placesOff,
		starters: record.statistic.starters
	});
	const SOURCE_HEADS = {
		ours: RECORD_BOX.ours,
		adp: RECORD_BOX.adp,
		published: RECORD_BOX.published
	} as const;

	/** The positions the record grades, All first. */
	const positions = $derived(record.toDate.map((line) => line.position));
	let position = $state<RecordLine['position']>('All');
	/** On a phone the table shows one figure at a time. */
	let figure = $state<RecordFigure>('agreement');

	const toDate = $derived(record.toDate.find((line) => line.position === position));
	const toDateAll = $derived(allLine(record.toDate));
	const rows = $derived(weekLines(record.weeks, data.page.unplayed));
	const series = $derived(chartSeries(record, position));
	const graded = $derived(record.weeks.filter((week) => week.status === 'graded'));
	const span = $derived(
		graded.length === 0
			? ''
			: graded.length === 1
				? `Week ${String(graded[0]?.week)}`
				: `Weeks ${String(graded[0]?.week)} to ${String(graded.at(-1)?.week)}`
	);

	const capitalized = (words: string): string =>
		`${words.charAt(0).toUpperCase()}${words.slice(1)}`;

	/** The orders drawn: Published only once a graded week carries it (the honest empty state). */
	const sources = $derived(recordSources(record));
	const showPublished = $derived(publishedDrawn(record));
	const basis = $derived(recordBasis(record).map((text) => ({ text, phone: true })));

	const columns = $derived(2 + RECORD_FIGURES.length * sources.length + 1);
</script>

{#snippet cells(line: RecordLine | undefined)}
	{#each RECORD_FIGURES as f (f)}
		{#each sources as source (source)}
			{#if source === 'published'}
				{@const beside = publishedBeside(line, f)}
				<td class="n m {f} {source}"
					>{beside.published}{#if beside.ours}<span class="same">{beside.ours}</span>{/if}</td
				>
			{:else}
				<td class="n m {f} {source}">{figureWords(scoreOf(line, source), f)}</td>
			{/if}
		{/each}
	{/each}
{/snippet}

<SiteShell title="Our record" run={data.run}>
	<main class="record">
		<PageHead title="Our record" lead={recordLead(record, scoring)} />
		<ContextNote {note} />

		{#if toDateAll}
			<section class="bug" aria-label="{span} to date">
				<div class="head">
					<span class="span">{span}, {RECORD_BOX.toDate.toLowerCase()}</span>
					<h2>{gradedOrders(record)}</h2>
				</div>
				<div class="tiles">
					{#each RECORD_FIGURES as f (f)}
						{@const beside = publishedBeside(toDateAll, f)}
						<div class="tile">
							<span class="label">{FIGURE_HEADS[f]}</span>
							<span class="vals"
								><b>{figureWords(scoreOf(toDateAll, 'ours'), f)}</b><span
									>{RECORD_BOX.adp} {figureWords(scoreOf(toDateAll, 'adp'), f)}</span
								>{#if showPublished}<span
										>{RECORD_BOX.published}
										{beside.published}{#if beside.ours}, {beside.ours.toLowerCase()}{/if}</span
									>{/if}</span
							>
						</div>
					{/each}
				</div>
				<p class="scale">{scaleWords(record)}</p>
				{#if record.honest}<p class="honest">{record.honest}</p>{/if}
			</section>
		{:else}
			<Panel padding="md">
				<Figure value={headline.value} size="xl" caption={headline.caption} />
			</Panel>
		{/if}

		<div class="filters">
			{#if positions.length > 1}
				<div class="chips" role="group" aria-label="Position">
					{#each positions as p (p)}
						<button type="button" aria-pressed={position === p} onclick={() => (position = p)}
							>{p === 'DST' ? 'D/ST' : p}</button
						>
					{/each}
				</div>
			{/if}
			<div class="chips figure-pick" role="group" aria-label="Figure">
				{#each RECORD_FIGURES as f (f)}
					<button type="button" aria-pressed={figure === f} onclick={() => (figure = f)}
						>{capitalized(FIGURE_HEADS[f])}</button
					>
				{/each}
			</div>
		</div>

		<table class="weeks show-{figure}" aria-label="Our record week by week">
			<thead>
				<tr class="grp">
					<th colspan="2"></th>
					{#each RECORD_FIGURES as f (f)}
						<th class="g {f}" colspan={sources.length} scope="colgroup">{FIGURE_HEADS[f]}</th>
					{/each}
					<th></th>
				</tr>
				<tr class="cols">
					<th scope="col">{RECORD_BOX.week}</th>
					<th class="n plc" scope="col">{RECORD_BOX.players}</th>
					{#each RECORD_FIGURES as f (f)}
						{#each sources as source (source)}
							<th class="n m {f} {source}" scope="col">{SOURCE_HEADS[source]}</th>
						{/each}
					{/each}
					<th class="st" scope="col">{RECORD_BOX.status}</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.lead)}
					{@const line = row.week?.lines.find((l) => l.position === position)}
					{#if row.week !== null && row.week.status === 'graded'}
						<tr>
							<td class="wk"
								>{row.lead}{#if row.week.order}<span class="ord">{ORDER_WORDS[row.week.order]}</span
									>{/if}</td
							>
							<td class="n plc">{line?.ours.graded ?? RECORD_BOX.none}</td>
							{@render cells(line)}
							<td class="st">{capitalized(row.text)}</td>
						</tr>
					{:else}
						<tr class="quiet" class:live={row.week !== null}>
							<td class="wk"
								>{row.lead}{#if row.week?.order}<span class="ord"
										>{ORDER_WORDS[row.week.order]}</span
									>{/if}</td
							>
							<td class="st wide" colspan={columns - 1}>{capitalized(row.text)}</td>
						</tr>
					{/if}
				{/each}
				{#if toDate}
					<tr class="totals">
						<td class="wk">{RECORD_BOX.toDate}</td>
						<td class="n plc">{toDate.ours.graded}</td>
						{@render cells(toDate)}
						<td></td>
					</tr>
				{/if}
			</tbody>
		</table>

		{#if graded.length > 0}
			<RecordChart {series} weeks={record.weeks.length} />
		{/if}

		<!-- One paragraph; the bug says the scale and the two decimals once (Lane 66t). -->
		<BasisBlock parts={basis} />
	</main>
</SiteShell>

<style>
	.record {
		padding: var(--s-5);
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
	}

	.bug {
		display: grid;
		grid-template-columns: auto auto minmax(0, 1fr);
		align-items: center;
		gap: var(--s-3) var(--s-5);
		padding: var(--s-3) var(--s-4);
		border: 1px solid var(--line);
		border-left: 4px solid var(--accent);
		border-radius: var(--r-md);
		background: var(--surface);
	}

	.head {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.span {
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--accent-text);
	}

	h2 {
		margin: 0;
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-xl);
		line-height: 1.05;
		text-transform: uppercase;
	}

	.tiles {
		display: flex;
		gap: var(--s-5);
	}

	.tile {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding-left: var(--s-4);
		border-left: 1px solid var(--line);
	}

	.label {
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
	}

	.vals {
		display: flex;
		align-items: baseline;
		gap: var(--s-2);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.vals b {
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-2xl);
		line-height: 1;
		color: var(--accent-text);
	}

	.vals span {
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	/* The scale under the tiles, the bug's whole width. */
	.scale {
		grid-column: 1 / -1;
		margin: 0;
		font-size: var(--t-sm);
		line-height: 1.45;
		color: var(--ink-2);
	}

	.honest {
		margin: 0;
		max-width: 520px;
		font-size: var(--t-sm);
		line-height: 1.45;
		color: var(--ink);
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-2) var(--s-3);
	}

	.chips {
		display: inline-flex;
		gap: 2px;
		padding: 3px;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-pill);
		background: var(--surface);
	}

	.chips button {
		height: 30px;
		padding: 0 var(--s-3);
		border: 0;
		border-radius: var(--r-pill);
		background: transparent;
		color: var(--ink-2);
		font: inherit;
		font-size: var(--t-sm);
		font-weight: 600;
		cursor: pointer;
	}

	.chips button[aria-pressed='true'] {
		background: var(--ink);
		color: var(--bg);
	}

	.figure-pick {
		display: none;
	}

	.weeks {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		overflow: hidden;
	}

	th {
		padding: 0 var(--s-2);
		text-align: left;
		background: var(--bg);
		white-space: nowrap;
	}

	.grp th {
		height: 22px;
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-2);
		text-align: center;
	}

	.grp .g {
		border-left: 1px solid var(--line);
	}

	.cols th {
		height: 30px;
		font-size: var(--t-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
		border-bottom: 1px solid var(--line);
	}

	td {
		height: 48px;
		padding: 4px var(--s-2);
		border-bottom: 1px solid var(--line);
		vertical-align: middle;
	}

	.n {
		text-align: right;
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.cols .n {
		text-align: right;
	}

	/* Ours over the weeks that graded the published projection, under its figure to date (N1). */
	.same {
		display: block;
		font-family: var(--font-ui);
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	td.wk {
		font-family: var(--font-num);
		font-weight: 700;
		font-size: var(--t-md);
		white-space: nowrap;
		padding-left: var(--s-3);
	}

	td.wk .ord {
		display: block;
		font-family: var(--font-ui);
		font-size: var(--t-xs);
		font-weight: 500;
		color: var(--ink-3);
	}

	td.plc {
		font-weight: 600;
		color: var(--ink-2);
	}

	td.m {
		font-size: var(--t-lg);
		font-weight: 600;
		color: var(--ink-2);
	}

	td.m.ours {
		font-weight: 800;
		color: var(--accent-text);
	}

	th.m.ours,
	td.m.ours {
		border-left: 1px solid var(--line);
	}

	td.m.starters {
		font-size: var(--t-md);
	}

	td.st {
		font-size: var(--t-sm);
		color: var(--ink-3);
		padding-left: var(--s-4);
	}

	.quiet td {
		height: 40px;
		color: var(--ink-3);
	}

	.quiet.live td {
		background: color-mix(in srgb, var(--accent) 7%, var(--surface));
	}

	.quiet.live td:first-child {
		box-shadow: inset 3px 0 0 var(--accent);
	}

	.quiet td.wide {
		padding-left: var(--s-2);
	}

	.totals td {
		height: 52px;
		background: var(--scoreboard);
		color: var(--scoreboard-ink-2);
		border-bottom: 0;
	}

	.totals td.wk {
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--scoreboard-ink);
	}

	.totals td.m.ours {
		color: var(--scoreboard-num);
	}

	@media (max-width: 1180px) {
		.bug {
			grid-template-columns: auto minmax(0, 1fr);
		}

		.tiles {
			flex-wrap: wrap;
			row-gap: var(--s-2);
		}

		.honest {
			grid-column: 1 / -1;
			max-width: none;
		}
	}

	/* Below a wide screen one figure at a time: Week, Ours, ADP and Published. */
	@media (max-width: 1180px) {
		.figure-pick {
			display: inline-flex;
		}

		.grp,
		.plc,
		.st:not(.wide),
		.cols .st {
			display: none;
		}

		.weeks:not(.show-agreement) .agreement,
		.weeks:not(.show-placesOff) .placesOff,
		.weeks:not(.show-starters) .starters {
			display: none;
		}
	}

	@media (max-width: 760px) {
		.record {
			padding: var(--s-4);
			gap: var(--s-3);
		}

		.bug {
			grid-template-columns: minmax(0, 1fr);
		}

		.tiles {
			flex-direction: column;
			gap: var(--s-2);
		}

		.tile {
			flex-direction: row;
			align-items: baseline;
			justify-content: space-between;
			padding-left: 0;
			border-left: 0;
		}

		.vals b {
			font-size: var(--t-xl);
		}

		.vals span {
			font-size: var(--t-xs);
		}

		td {
			padding: 4px 6px;
		}

		td.m {
			font-size: var(--t-md);
		}

		.quiet td.wide {
			white-space: normal;
		}
	}
</style>
