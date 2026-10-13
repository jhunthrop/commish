<script lang="ts">
	import { dayLabel } from '#lib/format/date.ts';
	import { fixed } from '#lib/format/number.ts';
	import type { RecordLine, Score } from '#lib/run/schema.ts';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import BasisList from '#lib/ui/BasisList.svelte';
	import Figure from '#lib/ui/Figure.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Table from '#lib/ui/Table.svelte';
	import type { Column } from '#lib/ui/table.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const record = $derived(data.page.record);
	const scoring = $derived(data.page.format.label);
	const stat = $derived(record.statistic);
	const graded = $derived(record.weeks.filter((week) => week.gradedAt !== null));
	const overall = $derived(record.toDate.find((line) => line.position === 'All'));
	const lastGraded = $derived(graded.at(-1)?.week);

	/** A score as a cell prints it. A sample too small for the statistic says so in words. */
	function score(value: number | null, digits: number): string {
		return value === null ? 'Too few' : fixed(value, digits);
	}

	function weekLine(lines: readonly RecordLine[]): RecordLine | undefined {
		return lines.find((line) => line.position === 'All');
	}

	const big = $derived.by(() => {
		if (overall?.ours.agreement == null || lastGraded === undefined) return null;
		const adpPart =
			overall.adp.agreement === null ? '' : ` ADP ${fixed(overall.adp.agreement, 2)}.`;
		return {
			value: fixed(overall.ours.agreement, 2),
			caption: `our ${stat.agreement} with the finish, weeks 1 to ${String(lastGraded)}, every position, n ${String(overall.ours.graded)}.${adpPart}`
		};
	});

	const frozenColumns: Column[] = [
		{ label: 'Week' },
		{ label: 'Frozen' },
		{ label: 'From the run' }
	];
	const gradedColumns = $derived<Column[]>([
		{ label: 'Week' },
		{ label: 'n', align: 'end' },
		{ label: `Our ${stat.agreement}`, align: 'end' },
		{ label: `ADP ${stat.agreement}`, align: 'end' },
		{ label: `Our ${stat.placesOff.toLowerCase()}`, align: 'end', wideOnly: true },
		{ label: `ADP ${stat.placesOff.toLowerCase()}`, align: 'end', wideOnly: true }
	]);

	function scoreCells(ours: Score, adp: Score): string[] {
		return [
			score(ours.agreement, 2),
			score(adp.agreement, 2),
			score(ours.placesOff, 1),
			score(adp.placesOff, 1)
		];
	}
</script>

<SiteShell title="Our record" active="record" run={data.run}>
	<main class="record">
		<div class="content">
			<PageHead
				title="Our record"
				lead="Our {scoring} board against {record.season}'s games, week by week, beside ADP"
			/>

			<Panel padding="md">
				{#if big}
					<Figure value={big.value} size="xl" caption={big.caption} />
				{:else}
					<PanelHead title="No week graded yet" level={2} />
					<BasisList
						terms={[{ term: 'So far', means: record.pending ?? 'Nothing is frozen yet.' }]}
					/>
				{/if}
			</Panel>

			<Table caption="Frozen boards" showCaption columns={frozenColumns}>
				{#each record.weeks as week (week.week)}
					<tr>
						<td>Week {week.week}</td>
						<td>{dayLabel(week.frozenAt)}</td>
						<td class="small">{week.frozenBy}</td>
					</tr>
				{/each}
			</Table>

			{#if graded.length > 0}
				<Table caption="Week by week" showCaption minWidth={340} columns={gradedColumns}>
					{#each graded as week (week.week)}
						{@const line = weekLine(week.lines)}
						{#if line}
							<tr>
								<td>Week {week.week}</td>
								<td class="num">{line.ours.graded}</td>
								{#each scoreCells(line.ours, line.adp) as cell, i (i)}
									<td class="num" class:wide={i > 1}>{cell}</td>
								{/each}
							</tr>
						{/if}
					{/each}
				</Table>
			{/if}

			{#if record.toDate.length > 0}
				<Table
					caption="By position, every graded week"
					showCaption
					columns={[{ label: 'Position' }, ...gradedColumns.slice(1)]}
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
			{/if}
		</div>

		<aside class="side" aria-label="The method">
			<Panel>
				<PanelHead title="The method" />
				<BasisList terms={record.method} />
			</Panel>
		</aside>
	</main>
</SiteShell>

<style>
	.record {
		display: grid;
		grid-template-columns: minmax(0, 1fr) var(--side-w);
		gap: var(--s-5);
		padding: var(--s-5);
	}

	.content {
		min-width: 0;
		max-width: 900px;
		display: flex;
		flex-direction: column;
		gap: var(--s-5);
	}

	.side {
		align-self: start;
		position: sticky;
		top: 84px;
	}

	@media (max-width: 1180px) {
		.record {
			grid-template-columns: minmax(0, 1fr);
		}

		.side {
			position: static;
		}
	}

	@media (max-width: 760px) {
		.record {
			padding: var(--s-4);
		}
	}
</style>
