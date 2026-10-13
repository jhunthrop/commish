<script lang="ts">
	import DisplayTitle from '#lib/ui/DisplayTitle.svelte';
	import type { Snippet } from 'svelte';
	import { lastName } from '#lib/format/draft.ts';
	import type { MockReport } from '../api.ts';
	import { boardOf } from '../model.ts';
	import RoomLayout from '../RoomLayout.svelte';
	import { scoringWords, slotLabel } from '../words.ts';
	import Exposure from './Exposure.svelte';
	import FieldBars from './FieldBars.svelte';
	import { headline, points } from './headline.ts';
	import PickReview from './PickReview.svelte';
	import RunsSection from './RunsSection.svelte';

	interface Props {
		report: MockReport;
		/** Each seat's name, seat 1 first: "You", "Bot 3", a handle. */
		names: readonly string[];
		/** How the other seats drafted, for the basis sentence: "bots drafting from where drafters take players". */
		field: string;
		/** Set when someone else's draft is read through its link: the report speaks of them, by handle
		 * when the link carries one. */
		shared?: { by: string | null };
		/** The verbs under the headline. */
		verbs: Snippet;
	}

	let { report, names, field, shared, verbs }: Props = $props();

	const board = $derived(boardOf(report.board, report.teams));
	const head = $derived(headline(report.standings, report.slot, report.teams));
	const their = $derived(shared ? 'their' : 'your');
	const title = $derived(
		shared ? `${shared.by ? `${shared.by}'s` : 'A shared'} draft` : 'Your draft'
	);
	const starters = $derived(
		report.starters
			.flatMap((s) => {
				const p = s.player_id === null ? undefined : board.byId.get(s.player_id);
				return p ? [`${slotLabel(s.slot)} ${lastName(p.name)}`] : [];
			})
			.join(', ')
	);
</script>

<RoomLayout variant="report">
	<div class="hero">
		{#if head}
			<div class="big">
				<b>{points(head.points)}</b>
				<span>projected points from {their} starters, {head.standing}</span>
			</div>
		{/if}
		<div>
			<DisplayTitle size="page">{title} from slot {report.slot}</DisplayTitle>
			<p>
				{report.teams} teams, {scoringWords(report.settings)}, {report.rounds} rounds, {field}.
				Starters: {starters}. Points are our projections, the same numbers the board ranks by, {head?.read ??
					''}
			</p>
			<div class="acts">{@render verbs()}</div>
		</div>
	</div>
	<section>
		<DisplayTitle note="projected starting points, {report.teams} teams">The field</DisplayTitle>
		<FieldBars standings={report.standings} {names} you={report.slot} />
		<p class="basis">{board.basis}</p>
	</section>
	<section>
		<DisplayTitle note="what was taken, what drafters do, and whether he would have lasted">
			Pick by pick
		</DisplayTitle>
		<PickReview
			picks={report.picks}
			{board}
			teams={report.teams}
			couldWaitFrom={report.could_wait_from}
			whose={their}
		/>
	</section>
	<section>
		<DisplayTitle note="{their} picks on autopick from the board, the bots reshuffled each run">
			The same draft, {report.runs.runs} more times
		</DisplayTitle>
		<RunsSection runs={report.runs} teams={report.teams} rank={head?.rank ?? 0} />
		<p class="basis">
			Each run drafts the room again from pick one with a new seed, seeds {report.seed} to {report.seed +
				report.runs.runs -
				1}, the bots drafting the way this room's bots do and {their} seat taking the best player the
			board has for the roster. Our projections lead the board, so a seat drafting off it finishes high
			in most runs. The spread is the useful read.
		</p>
	</section>
	{#snippet dock()}
		<Exposure runs={report.runs} {board} seat={report.slot} whose={their} />
	{/snippet}
</RoomLayout>

<style>
	.hero {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: var(--s-5);
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
		margin-top: 8px;
		font-size: var(--t-sm);
		color: var(--ink-2);
		max-width: 30ch;
	}

	.hero p {
		margin: var(--s-2) 0 0;
		color: var(--ink-2);
		max-width: 62ch;
	}

	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-2);
		margin-top: var(--s-3);
	}

	section {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
		padding-top: var(--s-5);
	}

	.basis {
		font-size: var(--t-xs);
		color: var(--ink-3);
		margin: 0;
		max-width: 70ch;
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
