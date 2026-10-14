<script lang="ts">
	import { siteContext } from '#lib/context/context.svelte.ts';
	import ContextNote from '#lib/context/ContextNote.svelte';
	import { SCORING_WORDS } from '#lib/league/names.ts';
	import { fixed, plural } from '#lib/format/number.ts';
	import { allLine, recordHeadline, weekWords } from '#lib/run/record.ts';
	import type { RecordWeek, Score } from '#lib/run/schema.ts';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import Figure from '#lib/ui/Figure.svelte';
	import Footnote from '#lib/ui/Footnote.svelte';
	import LineList from '#lib/ui/LineList.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Table from '#lib/ui/Table.svelte';
	import type { Column } from '#lib/ui/table.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const record = $derived(data.page.record);
	const scoring = $derived(data.page.format.label);
	/** The record is graded in one scoring: with a league selected, the page says the league's too. */
	const note = $derived(
		siteContext.league
			? `Your league scores ${SCORING_WORDS[siteContext.league.scoring]}. Our record is graded in ${scoring}.`
			: null
	);
	const stat = $derived(record.statistic);
	const headline = $derived(recordHeadline(record));

	/** A score as a cell prints it. A sample too small for the statistic says so in words. */
	function score(value: number | null, digits: number): string {
		return value === null ? 'Too few' : fixed(value, digits);
	}

	/** Each week as a person says it, with the week's agreement once it is graded. */
	function weekLine(week: RecordWeek): { lead: string; text: string; figure?: string } {
		const lead = `Week ${String(week.week)}`;
		const line = allLine(week.lines);
		if (week.status !== 'graded' || line?.ours.agreement == null) {
			return { lead, text: weekWords(week) };
		}
		const adp = line.adp.agreement === null ? '' : `, ADP ${fixed(line.adp.agreement, 2)}`;
		return {
			lead,
			text: `${weekWords(week)}. Our ${stat.agreement} over ${plural(line.ours.graded, 'player')}${adp}`,
			figure: fixed(line.ours.agreement, 2)
		};
	}

	const lines = $derived(record.weeks.map(weekLine));

	const positionColumns: Column[] = [
		{ label: 'Position' },
		{ label: 'Players', align: 'end' },
		{ label: 'Ours', align: 'end' },
		{ label: 'ADP', align: 'end' },
		{ label: 'Places off', align: 'end', wideOnly: true }
	];

	function scoreCells(ours: Score, adp: Score): string[] {
		return [score(ours.agreement, 2), score(adp.agreement, 2), score(ours.placesOff, 1)];
	}
</script>

<SiteShell title="Our record" run={data.run}>
	<main class="record">
		<PageHead
			title="Our record"
			lead="Our {scoring} board against {record.season}'s games, week by week, beside ADP"
		/>
		<ContextNote {note} />

		<Panel padding="md">
			<Figure value={headline.value} size="xl" caption={headline.caption} />
		</Panel>

		{#if lines.length > 0}
			<section aria-label="Week by week">
				<PanelHead title="Week by week" level={2} />
				<LineList label="Every week of the season" {lines} />
			</section>
		{/if}

		{#if record.toDate.length > 0}
			<section aria-label="By position">
				<Table
					caption="By position, every graded week: {stat.agreement}, and {stat.placesOff}"
					showCaption
					columns={positionColumns}
				>
					{#each record.toDate as line (line.position)}
						<tr>
							<td>{line.position}</td>
							<td class="num">{line.ours.graded}</td>
							{#each scoreCells(line.ours, line.adp) as cell, i (i)}
								<td class="num" class:wide={i > 1}>{cell}</td>
							{/each}
						</tr>
					{/each}
				</Table>
			</section>
		{/if}

		<Footnote>
			{record.method}
			Each week's board is the nightly run taken just before it froze.
		</Footnote>
	</main>
</SiteShell>

<style>
	.record {
		padding: var(--s-5);
		display: flex;
		flex-direction: column;
		gap: var(--s-5);
		max-width: 900px;
	}

	@media (max-width: 760px) {
		.record {
			padding: var(--s-4);
			gap: var(--s-4);
		}
	}
</style>
