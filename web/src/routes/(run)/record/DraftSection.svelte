<script lang="ts">
	import BasisBlock from '#lib/ui/BasisBlock.svelte';
	import { RECORD_BOX, RECORD_WORDS, type RecordFigure } from '#lib/run/record.ts';
	import {
		DRAFT_FIGURES,
		DRAFT_SOURCES,
		RECORDS_WORDS,
		draftBasis,
		draftCell,
		draftHeads,
		draftRows,
		draftSeries
	} from '#lib/run/records.ts';
	import type { DraftLine, DraftRecord, RunRecord } from '#lib/run/schema.ts';
	import RecordChart from './RecordChart.svelte';

	interface Props {
		/** The draft record, absent on a run before Lane 114. */
		draft: DraftRecord | undefined;
		/** The run's record, for the words its measures print in. */
		run: RunRecord;
	}

	let { draft, run }: Props = $props();

	const HEADS = $derived(draftHeads(run));
	const SOURCE_HEADS = { ours: RECORD_BOX.ours, adp: RECORD_BOX.adp } as const;
	let figure = $state<RecordFigure>('agreement');
	const rows = $derived(draft === undefined ? null : draftRows(draft));
	const series = $derived(draft === undefined ? {} : draftSeries(draft));
	const weeks = $derived(draft?.progress.map((point) => point.week) ?? []);
	const basis = $derived(
		draft === undefined
			? []
			: draftBasis(draft, RECORD_WORDS.placesOff).map((text) => ({ text, phone: true }))
	);

	const capitalized = (words: string): string =>
		`${words.charAt(0).toUpperCase()}${words.slice(1)}`;
</script>

{#snippet cells(line: DraftLine)}
	{#each DRAFT_FIGURES as f (f)}
		{#each DRAFT_SOURCES as source (source)}
			<td class="n m {f} {source}">{draftCell(line, source, f)}</td>
		{/each}
	{/each}
{/snippet}

<section class="rec" id="draft" aria-label={RECORDS_WORDS.draft}>
	<div class="rec-head">
		<h2>{RECORDS_WORDS.draft}</h2>
		<span class="what">{RECORDS_WORDS.draftWhat}</span>
	</div>

	{#if draft === undefined || rows === null}
		<p class="scale">{RECORDS_WORDS.waiting}</p>
	{:else}
		{#if rows.all}
			<div class="bug" aria-label={RECORDS_WORDS.draftSpan(draft.throughWeek)}>
				<div class="head">
					<span class="span">{RECORDS_WORDS.draftSpan(draft.throughWeek)}</span>
					<span class="order">{RECORDS_WORDS.draftPlayers(rows.all.ours.graded)}</span>
				</div>
				<div class="tiles">
					{#each DRAFT_FIGURES as f (f)}
						<div class="tile">
							<span class="label">{HEADS[f]}</span>
							<span class="vals"
								><b>{draftCell(rows.all, 'ours', f)}</b><span
									>{RECORD_BOX.adp} {draftCell(rows.all, 'adp', f)}</span
								></span
							>
						</div>
					{/each}
				</div>
				{#if draft.honest}<p class="honest">{draft.honest}</p>{/if}
			</div>
		{/if}

		<div class="filters">
			<div class="chips figure-pick" role="group" aria-label="Figure">
				{#each DRAFT_FIGURES as f (f)}
					<button type="button" aria-pressed={figure === f} onclick={() => (figure = f)}
						>{capitalized(HEADS[f])}</button
					>
				{/each}
			</div>
		</div>

		<table class="weeks show-{figure}" aria-label="{RECORDS_WORDS.draft} by position">
			<thead>
				<tr class="grp">
					<th colspan="2"></th>
					{#each DRAFT_FIGURES as f (f)}
						<th class="g {f}" colspan={DRAFT_SOURCES.length} scope="colgroup">{HEADS[f]}</th>
					{/each}
				</tr>
				<tr class="cols">
					<th scope="col">{RECORDS_WORDS.position}</th>
					<th class="n plc" scope="col">{RECORDS_WORDS.players}</th>
					{#each DRAFT_FIGURES as f (f)}
						{#each DRAFT_SOURCES as source (source)}
							<th class="n m {f} {source}" scope="col">{SOURCE_HEADS[source]}</th>
						{/each}
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each rows.positions as line (line.position)}
					<tr>
						<td class="wk">{line.position}</td>
						<td class="n plc">{line.ours.graded}</td>
						{@render cells(line)}
					</tr>
				{/each}
				{#if rows.all}
					<tr class="totals">
						<td class="wk">{RECORDS_WORDS.all}</td>
						<td class="n plc">{rows.all.ours.graded}</td>
						{@render cells(rows.all)}
					</tr>
				{/if}
			</tbody>
		</table>

		{#if weeks.length > 0}
			<RecordChart {series} {weeks} caption={RECORDS_WORDS.draftChart} />
		{/if}

		<BasisBlock parts={basis} />
	{/if}
</section>
