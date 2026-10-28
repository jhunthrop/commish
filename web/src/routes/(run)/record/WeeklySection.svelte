<script lang="ts">
	import BasisBlock from '#lib/ui/BasisBlock.svelte';
	import Figure from '#lib/ui/Figure.svelte';
	import PairTile from '#lib/ui/PairTile.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import {
		RECORD_AFTER,
		RECORD_BEFORE,
		RECORD_BOX,
		RECORD_FIGURES,
		allLine,
		besideOf,
		chartSeries,
		chartWeeks,
		figureWords,
		gapWords,
		gradedOrders,
		recordBasis,
		recordHeadline,
		recordSources,
		recordStatusSpans,
		scoreOf,
		standingWords,
		weekLines,
		weekOrderWords,
		type RecordFigure,
		type RecordSource
	} from '#lib/run/record.ts';
	import type { LeagueView } from '#lib/run/record-league.ts';
	import {
		RECORDS_WORDS,
		beforeChips,
		beforeLine,
		weeklyBasis,
		weeklyLines,
		oursLeadsAll,
		weeklyOrderWords,
		weeklyPairs,
		weeklyPending,
		weeklySources,
		weeklySpan,
		weekNote,
		type NextGrade
	} from '#lib/run/records.ts';
	import type { RecordLine, RecordWeek, RunRecord } from '#lib/run/schema.ts';
	import { hostWords } from '#lib/league/names.ts';
	import { fixed } from '#lib/format/number.ts';
	import RecordChart from './RecordChart.svelte';

	interface Props {
		/** The weekly record in the record's shape, or a run's own record before Lane 114. */
		record: RunRecord;
		/** The weekly record's first week, null for a run's own record (no line before it). */
		fromWeek: number | null;
		unplayed: readonly number[];
		underway: readonly number[];
		/** A selected league's record in its lineup, null at rest: the run's own record as written. */
		league: LeagueView | null;
		/** The section's head and what it grades; null for a run's own record, drawn as before. */
		head: { title: string; what: string } | null;
		/** The weekly record's next week to grade, which its bug names before a week is graded. */
		next: NextGrade | null;
	}

	let { record: runRecord, fromWeek, unplayed, underway, league, head, next }: Props = $props();

	/** Every starters figure and sentence here reads the league's one lineup once it is selected
	 * (Lane 93 fix round 1), the run's own record and honest sentence at rest. */
	const record = $derived(league?.record ?? runRecord);
	const honest = $derived(league === null ? runRecord.honest : league.honest);
	/** The weekly record before a week is graded says the week and when it grades, no figure (C04). */
	const pending = $derived(head === null ? null : weeklyPending(record, next));
	const headline = $derived(recordHeadline(record, unplayed));
	const standing = $derived(standingWords(record));
	const gaps = $derived(gapWords(record, unplayed));
	const before = $derived(fromWeek === null ? null : beforeLine(fromWeek));
	/** The same weeks on a phone: a chip a week, never the set rule's paragraph (Lane 209). */
	const chips = $derived(fromWeek === null ? [] : beforeChips(fromWeek));

	const FIGURE_HEADS = $derived<Record<RecordFigure, string>>({
		agreement: record.statistic.agreement,
		placesOff: record.statistic.placesOff,
		starters: record.statistic.starters
	});
	const SOURCE_HEADS: Readonly<Record<RecordSource, string>> = {
		ours: RECORD_BOX.ours,
		adp: RECORD_BOX.adp,
		espn: RECORD_BOX.espn,
		published: RECORD_BOX.published
	};

	const positions = $derived(record.toDate.map((line) => line.position));
	let position = $state<RecordLine['position']>('All');
	let figure = $state<RecordFigure>('agreement');

	const toDate = $derived(record.toDate.find((line) => line.position === position));
	const toDateAll = $derived(allLine(record.toDate));
	/** The weekly record says its weeks and its order in its own words (fix round 1, M2 and M4); a
	 * run's own record before Lane 114 as it always did. */
	const rows = $derived(
		head === null
			? weekLines(record.weeks, unplayed, underway)
			: weeklyLines(record.weeks, unplayed, underway)
	);
	const orderOf = (week: RecordWeek): string | null =>
		head === null ? weekOrderWords(week) : weeklyOrderWords(week);
	const bugHead = $derived(head === null ? gradedOrders(record) : weeklySpan(record));
	const series = $derived(chartSeries(record, position));
	const graded = $derived(record.weeks.filter((week) => week.status === 'graded'));
	const sources = $derived(head === null ? recordSources(record) : weeklySources(record));
	const beside = $derived(sources.filter((source) => source !== 'ours'));
	const spans = $derived(recordStatusSpans(sources.length));

	/** The weekly record's basis with its desk-only parts (Lane 131); a run's own record before Lane
	 * 114 says each of its sentences at both widths. */
	const basis = $derived.by(() => {
		const said = league?.basis ?? null;
		return head === null
			? recordBasis(record, said).map((text) => ({ text, phone: true }))
			: weeklyBasis(record, said);
	});

	const capitalized = (words: string): string =>
		`${words.charAt(0).toUpperCase()}${words.slice(1)}`;
</script>

{#snippet cells(line: RecordLine | undefined)}
	{#each RECORD_FIGURES as f (f)}
		{#each sources as source (source)}
			{#if source === 'ours'}
				<!-- The weekly record accents ours only where it leads every yardstick (fix round 1). -->
				<td
					class="n m {f} {source}"
					class:trails={head !== null && !oursLeadsAll(weeklyPairs(line, f, sources))}
					>{figureWords(scoreOf(line, source), f)}</td
				>
			{:else}
				{@const shown = besideOf(line, source, f)}
				<td class="n m {f} {source}"
					>{shown.value}{#if shown.ours}<span class="same">{shown.ours}</span>{/if}</td
				>
			{/if}
		{/each}
	{/each}
{/snippet}

<section class="rec" id="weekly" aria-label={head?.title ?? RECORD_BOX.toDate}>
	{#if head}
		<div class="rec-head">
			<h2>{head.title}</h2>
			<span class="what">{head.what}</span>
		</div>
	{/if}

	{#if toDateAll}
		<div class="bug" aria-label={standing ?? RECORD_BOX.toDate}>
			<div class="head">
				<span class="span">{standing}</span>
				<span class="order">{bugHead}</span>
			</div>
			<div class="tiles">
				{#each RECORD_FIGURES as f (f)}
					<div class="tile">
						{#if head !== null}
							<!-- Ours and each yardstick at one size, each pair naming its leader (fix round 1). -->
							{#each weeklyPairs(toDateAll, f, sources) as pair, i (pair.name)}
								<PairTile label={i === 0 ? FIGURE_HEADS[f] : null} {pair} />
							{/each}
						{:else}
							<span class="label">{FIGURE_HEADS[f]}</span>
							<span class="vals"
								><b>{figureWords(scoreOf(toDateAll, 'ours'), f)}</b
								>{#each beside as source (source)}
									{@const shown = besideOf(toDateAll, source, f)}
									<span
										>{SOURCE_HEADS[source]}
										{shown.value}{#if shown.ours}, {shown.ours.toLowerCase()}{/if}</span
									>
								{/each}</span
							>
						{/if}
					</div>
				{/each}
			</div>
			{#if gaps}<p class="scale">{gaps}</p>{/if}
			{#if honest}<p class="honest">{honest}</p>{/if}
		</div>
	{:else if pending}
		<div class="bug pending" aria-label={pending.title}>
			<div class="head">
				<span class="order">{pending.title}</span>
				<span class="when">{pending.when}</span>
			</div>
			{#if gaps}<p class="scale">{gaps}</p>{/if}
		</div>
	{:else}
		<Panel padding="md">
			<Figure value={headline.value} size="xl" caption={headline.caption} />
			{#if gaps}<p class="scale">{gaps}</p>{/if}
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

	<table class="weeks show-{figure}" aria-label="{head?.title ?? 'Our record'} week by week">
		<thead>
			<tr class="grp">
				<th colspan={1 + RECORD_BEFORE.length}></th>
				{#each RECORD_FIGURES as f (f)}
					<th class="g {f}" colspan={sources.length} scope="colgroup">{FIGURE_HEADS[f]}</th>
				{/each}
				{#if RECORD_AFTER.length > 0}<th colspan={RECORD_AFTER.length}></th>{/if}
			</tr>
			<tr class="cols">
				<th scope="col">{RECORD_BOX.week}</th>
				{#each RECORD_BEFORE as column (column.head)}
					<th class={column.cls} scope="col">{column.head}</th>
				{/each}
				{#each RECORD_FIGURES as f (f)}
					{#each sources as source (source)}
						<th class="n m {f} {source}" scope="col">{SOURCE_HEADS[source]}</th>
					{/each}
				{/each}
				{#each RECORD_AFTER as column (column.head)}
					<th class={column.cls} scope="col">{column.head}</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#if before}
				<tr class="quiet before">
					<td class="wk">{before.lead}</td>
					<td class="st wide desk" colspan={spans.desk}>{before.text}</td>
					<td class="st wide narrow" colspan={spans.narrow}
						><ul class="wk-chips">
							{#each chips as chip (chip)}<li>{chip}</li>{/each}
						</ul>
						<a class="graded-under" href="#draft">{RECORDS_WORDS.beforePhone}</a>
						<span class="set-rule">{RECORDS_WORDS.setRulePhone}</span></td
					>
				</tr>
			{/if}
			{#each rows as row (row.lead)}
				{@const line = row.week?.lines.find((l) => l.position === position)}
				{@const note = head === null ? undefined : weekNote(row.week)}
				{#if row.week !== null && row.week.status === 'graded'}
					<tr class:noted={note !== undefined}>
						<td class="wk"
							>{row.lead}{#if row.week.order}<span class="ord">{orderOf(row.week)}</span>{/if}</td
						>
						<td class="n plc">{line?.ours.graded ?? RECORD_BOX.none}</td>
						{@render cells(line)}
						<td class="st">{capitalized(row.text)}</td>
					</tr>
				{:else}
					<tr class="quiet" class:live={row.week !== null} class:noted={note !== undefined}>
						<td class="wk"
							>{row.lead}{#if row.week?.order}<span class="ord">{orderOf(row.week)}</span>{/if}</td
						>
						<!-- One status cell per width, each spanning the columns that width draws; the
						     other is display: none, so the status is read once. -->
						<td class="st wide desk" colspan={spans.desk}>{capitalized(row.text)}</td>
						<td class="st wide narrow" colspan={spans.narrow}>{capitalized(row.text)}</td>
					</tr>
				{/if}
				{#if note !== undefined}
					<!-- The week's ESPN sentence as the run wrote it (Lane 147), its basis said once under
					     its row: one cell per width, as the status rows draw it. -->
					<tr class="note">
						<td class="desk" colspan={1 + spans.desk}>{note}</td>
						<td class="narrow" colspan={1 + spans.narrow}>{note}</td>
					</tr>
				{/if}
			{/each}
			{#if toDate}
				<tr class="totals">
					<td class="wk">{RECORD_BOX.toDate}</td>
					<td class="n plc">{RECORD_BOX.distinct(toDate.ours.graded)}</td>
					{@render cells(toDate)}
					<td class="st"></td>
				</tr>
			{/if}
		</tbody>
	</table>

	{#if graded.length > 0}
		<RecordChart {series} weeks={chartWeeks(record)} />
	{/if}

	{#if league !== null && (league.rows.length > 0 || league.sentences.length > 0)}
		<section class="league" aria-label={RECORDS_WORDS.league(hostWords(league.host))}>
			<h3 class="league-head">{RECORDS_WORDS.league(hostWords(league.host))}</h3>
			{#if league.rows.length > 0}
				<table class="league-weeks">
					<thead>
						<tr class="cols">
							<th scope="col">{RECORD_BOX.week}</th>
							<th class="n plc" scope="col">{RECORDS_WORDS.rostered}</th>
							<th class="n" scope="col">{FIGURE_HEADS.agreement}</th>
							<th class="n" scope="col">{RECORD_BOX.espn}</th>
							<th class="n plc" scope="col">{FIGURE_HEADS.placesOff}</th>
							<th class="n plc" scope="col">{RECORD_BOX.espn}</th>
							<th class="n plc" scope="col">{FIGURE_HEADS.starters}</th>
							<th class="n plc" scope="col">{RECORD_BOX.espn}</th>
							<th class="n" scope="col">{RECORDS_WORDS.lineupOurs}</th>
							<th class="n" scope="col">{RECORDS_WORDS.lineupEspn}</th>
						</tr>
					</thead>
					<tbody>
						{#each league.rows as row (row.week)}
							<tr>
								<td class="wk">{RECORD_BOX.week} {row.week}</td>
								<td class="n plc">{row.players}</td>
								<td class="n m ours">{figureWords(row.ours, 'agreement')}</td>
								<td class="n m">{figureWords(row.espn, 'agreement')}</td>
								<td class="n m ours plc">{figureWords(row.ours, 'placesOff')}</td>
								<td class="n m plc">{figureWords(row.espn, 'placesOff')}</td>
								<td class="n m ours plc">{figureWords(row.ours, 'starters')}</td>
								<td class="n m plc">{figureWords(row.espn, 'starters')}</td>
								<td class="n m ours">{fixed(row.lineup.ours)}</td>
								<td class="n m">{fixed(row.lineup.espn)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
			<ul>
				{#if league.said}<li>{league.said}</li>{/if}
				{#each league.sentences as week (week.week)}<li>{week.text}</li>{/each}
			</ul>
		</section>
	{/if}

	<BasisBlock parts={basis} />
</section>
