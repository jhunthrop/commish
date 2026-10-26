<script lang="ts">
	import DisplayTitle from '#lib/ui/DisplayTitle.svelte';
	import FactStrip from '#lib/ui/FactStrip.svelte';
	import type { Snippet } from 'svelte';
	import type { MockReport } from '../api.ts';
	import { boardOf } from '../model.ts';
	import RoomLayout from '../RoomLayout.svelte';
	import Exposure from './Exposure.svelte';
	import FieldBars from './FieldBars.svelte';
	import {
		REPORT,
		fieldNote,
		picksNote,
		points,
		reportBasis,
		reportTitle,
		runsNote,
		runsTitle,
		settingCells,
		standingCells,
		totalCaption
	} from './headline.ts';
	import PickReview from './PickReview.svelte';
	import RunsSection from './RunsSection.svelte';

	/** The report as a box score (Lane 66o): the one big number with a one-line caption, the finish
	 * and settings as cells, the basis said once, then the field, pick by pick and the runs reading
	 * from it. The lobby's report, a shared draft and the live draft companion's are this component. */
	interface Props {
		report: MockReport;
		/** Each seat's name, seat 1 first: "You", "Bot 3", a handle. */
		names: readonly string[];
		/** Who the other seats are, in a cell: "Bots by ADP", "3 drafters, 9 bots". */
		seats: string;
		/** Set when someone else's draft is read through its link: the report speaks of them, by handle
		 * when the link carries one. */
		shared?: { by: string | null };
		/** The verbs under the headline. */
		verbs: Snippet;
		/** Who stands in for the other seats in the runs: the room's bots, or for a draft on another
		 * host our stand-ins for its league. */
		reshuffled?: string;
	}

	let { report, names, seats, shared, verbs, reshuffled = 'the bots' }: Props = $props();

	const board = $derived(boardOf(report.board, report.teams));
	const head = $derived(standingCells(report.standings, report.slot, report.teams));
	const their = $derived(shared ? 'their' : 'your');
	const title = $derived(reportTitle(report.slot, shared));
	const cells = $derived([...(head?.cells ?? []), ...settingCells(report, seats)]);
</script>

<RoomLayout variant="report">
	<div class="hero">
		{#if head}
			<div class="big">
				<b>{points(head.points)}</b>
				<span>{totalCaption(their)}</span>
			</div>
		{/if}
		<div class="side">
			<DisplayTitle size="page">{title}</DisplayTitle>
			<FactStrip label="The finish and the draft" {cells} />
			<div class="acts">{@render verbs()}</div>
		</div>
	</div>
	<p class="basis">{reportBasis(board.basis, report.could_wait_from)}</p>
	<section>
		<DisplayTitle note={fieldNote(report.teams)}>{REPORT.field}</DisplayTitle>
		<FieldBars standings={report.standings} {names} you={report.slot} />
	</section>
	<section>
		<DisplayTitle note={picksNote(report.picks.length)}>{REPORT.pickByPick}</DisplayTitle>
		<PickReview
			picks={report.picks}
			starters={report.starters}
			{board}
			teams={report.teams}
			couldWaitFrom={report.could_wait_from}
			whose={their}
		/>
	</section>
	<section>
		<DisplayTitle note={runsNote(their, reshuffled)}>{runsTitle(report.runs.runs)}</DisplayTitle>
		<RunsSection runs={report.runs} teams={report.teams} rank={head?.rank ?? 0} />
	</section>
	{#snippet dock()}
		<Exposure runs={report.runs} {board} whose={their} />
	{/snippet}
</RoomLayout>

<style>
	.hero {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: var(--s-6);
		align-items: end;
		padding: var(--s-4) 0 var(--s-5);
		border-bottom: 1px solid var(--line);
	}

	.big b {
		display: block;
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-3xl);
		line-height: 0.8;
		font-variant-numeric: tabular-nums;
	}

	.big span {
		display: block;
		margin-top: 10px;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.side {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
		min-width: 0;
	}

	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-2);
	}

	section {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
		padding-top: var(--s-4);
	}

	.basis {
		font-size: var(--t-xs);
		color: var(--ink-3);
		margin: 0;
		max-width: 110ch;
		line-height: 1.5;
	}

	@media (max-width: 760px) {
		.hero {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--s-3);
		}

		.big b {
			font-size: var(--t-2xl);
		}
	}
</style>
