<script lang="ts">
	import { dayLabel } from '#lib/format/date.ts';
	import { fixed, plural } from '#lib/format/number.ts';
	import type { RecordLine, Score } from '#lib/run/schema.ts';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import BasisList from '#lib/ui/BasisList.svelte';
	import Figure from '#lib/ui/Figure.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Table from '#lib/ui/Table.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const record = $derived(data.page.record);
	const scoring = $derived(data.page.format.label);
	const graded = $derived(record.weeks.filter((week) => week.gradedAt !== null));
	const overall = $derived(record.toDate.find((line) => line.position === 'All'));
	const lastGraded = $derived(graded.at(-1)?.week);

	/** A score as the tables print it, or the reason there is none. */
	function agreement(score: Score): string {
		return score.agreement === null ? 'Too few' : fixed(score.agreement, 2);
	}

	function placesOff(score: Score): string {
		return score.placesOff === null ? 'Too few' : fixed(score.placesOff, 1);
	}

	function weekLine(lines: readonly RecordLine[]): RecordLine | undefined {
		return lines.find((line) => line.position === 'All');
	}

	const big = $derived.by(() => {
		if (overall?.ours.agreement == null || lastGraded === undefined) {
			return {
				value: String(graded.length),
				caption: `weeks graded so far in ${String(record.season)}. ${plural(record.weeks.length, 'board')} frozen, waiting to be graded.`
			};
		}
		const adpPart =
			overall.adp.agreement === null ? '' : ` ADP ${fixed(overall.adp.agreement, 2)}.`;
		return {
			value: fixed(overall.ours.agreement, 2),
			caption: `our rank agreement with the finish, weeks 1 to ${String(lastGraded)}, every position.${adpPart}`
		};
	});

	const method = $derived([
		{
			term: 'Frozen',
			means: `Our ${scoring} board is saved before each week's first kickoff and never changed after`
		},
		{
			term: 'Graded',
			means: 'Every frozen player with a stat line that week, ranked by his points'
		},
		{
			term: 'Agreement',
			means:
				'How closely an order matches that finish, from 1 for the same order to −1 for the reverse'
		},
		{ term: 'Places off', means: 'How far the typical player was from where he finished' },
		{ term: 'Against', means: 'ADP, the order drafters already trust, graded the same way' },
		{
			term: 'Code',
			means:
				record.implementation.since === null
					? `${record.implementation.current}, every week this season`
					: `${record.implementation.current}, since ${dayLabel(record.implementation.since)}`
		}
	]);
</script>

<SiteShell title="Our record" active="record" run={data.run}>
	<main class="record">
		<div class="content">
			<div class="lead">
				<h2>Our record</h2>
				<p>Our {scoring} board against {record.season}'s games, week by week, beside ADP</p>
			</div>

			<Panel padding="md">
				<Figure value={big.value} size="xl" caption={big.caption} />
			</Panel>

			<section class="block" aria-label="Week by week">
				<Table
					caption="Week by week"
					showCaption
					minWidth={340}
					columns={[
						{ label: 'Week' },
						{ label: 'Frozen', wideOnly: true },
						{ label: 'Players', align: 'end', wideOnly: true },
						{ label: 'Our agreement', align: 'end' },
						{ label: 'ADP agreement', align: 'end' },
						{ label: 'Our places off', align: 'end', wideOnly: true },
						{ label: 'ADP places off', align: 'end', wideOnly: true }
					]}
				>
					{#each record.weeks as week (week.week)}
						{@const line = weekLine(week.lines)}
						<tr>
							<td>Week {week.week}</td>
							<td class="wide">{dayLabel(week.frozenAt)}</td>
							{#if week.gradedAt === null || !line}
								<td class="end" colspan="5">Not graded yet</td>
							{:else}
								<td class="num wide">{week.population}</td>
								<td class="num">{agreement(line.ours)}</td>
								<td class="num">{agreement(line.adp)}</td>
								<td class="num wide">{placesOff(line.ours)}</td>
								<td class="num wide">{placesOff(line.adp)}</td>
							{/if}
						</tr>
					{/each}
				</Table>
			</section>

			{#if record.toDate.length > 0}
				<section class="block" aria-label="By position">
					<Table
						caption="By position, every graded week"
						showCaption
						columns={[
							{ label: 'Position' },
							{ label: 'Our agreement', align: 'end' },
							{ label: 'ADP agreement', align: 'end' },
							{ label: 'Our places off', align: 'end', wideOnly: true },
							{ label: 'ADP places off', align: 'end', wideOnly: true }
						]}
					>
						{#each record.toDate as line (line.position)}
							<tr>
								<td>{line.position}</td>
								<td class="num">{agreement(line.ours)}</td>
								<td class="num">{agreement(line.adp)}</td>
								<td class="num wide">{placesOff(line.ours)}</td>
								<td class="num wide">{placesOff(line.adp)}</td>
							</tr>
						{/each}
					</Table>
				</section>
			{/if}
		</div>

		<aside class="side" aria-label="The method">
			<Panel>
				<PanelHead title="The method" />
				<BasisList terms={method} />
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

	h2 {
		margin: 0;
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-2xl);
		line-height: 0.9;
		text-transform: uppercase;
	}

	.lead p {
		margin: 6px 0 0;
		color: var(--ink-2);
		font-size: var(--t-sm);
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

		h2 {
			font-size: 34px;
		}
	}
</style>
