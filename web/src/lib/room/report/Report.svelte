<script lang="ts">
	import type { Snippet } from 'svelte';
	import { lastName } from '#lib/format/draft.ts';
	import type { MockReport } from '../api.ts';
	import { boardOf } from '../model.ts';
	import RoomLayout from '../RoomLayout.svelte';
	import { ordinal, scoringWords, slotLabel } from '../words.ts';
	import Exposure from './Exposure.svelte';
	import FieldBars from './FieldBars.svelte';
	import PickReview from './PickReview.svelte';
	import RunsSection from './RunsSection.svelte';

	interface Props {
		report: MockReport;
		/** Each seat's name, seat 1 first: "You", "Bot 3", a handle. */
		names: readonly string[];
		/** How the other seats drafted, for the basis sentence: "bots drafting from where drafters take players". */
		field: string;
		/** The verbs under the headline. */
		verbs: Snippet;
	}

	let { report, names, field, verbs }: Props = $props();

	const board = $derived(boardOf(report.board, report.teams));
	const mine = $derived(report.standings.find((t) => t.seat === report.slot));
	const others = $derived(report.standings.filter((t) => t.seat !== report.slot));
	const nextTeam = $derived(Math.max(...others.map((t) => t.points)));
	const starters = $derived(
		report.starters
			.flatMap((s) => {
				const p = s.player_id === null ? undefined : board.byId.get(s.player_id);
				return p ? [`${slotLabel(s.slot)} ${lastName(p.name)}`] : [];
			})
			.join(', ')
	);
	const round = (x: number) => Math.round(x).toLocaleString('en-US');
</script>

<RoomLayout variant="report">
	<div class="hero">
		{#if mine}
			<div class="big">
				<b>{round(mine.points)}</b>
				<span
					>projected points from your starters, {ordinal(mine.rank)} of {report.teams}, the next
					team at {round(nextTeam)}</span
				>
			</div>
		{/if}
		<div>
			<h2>Your draft from slot {report.slot}</h2>
			<p>
				{report.teams} teams, {scoringWords(report.settings)}, {report.rounds} rounds, {field}.
				Starters: {starters}. Points are our projections, the same numbers the board ranks by, so a
				team drafted off the board should lead this table. The useful read is how far ahead, and
				where it came from.
			</p>
			<div class="acts">{@render verbs()}</div>
		</div>
	</div>
	<section>
		<h3>The field <span>projected starting points, {report.teams} teams</span></h3>
		<FieldBars standings={report.standings} {names} you={report.slot} />
		<p class="basis">{board.basis}</p>
	</section>
	<section>
		<h3>
			Pick by pick <span>what you took, what drafters do, and whether he would have lasted</span>
		</h3>
		<PickReview
			picks={report.picks}
			{board}
			teams={report.teams}
			couldWaitFrom={report.could_wait_from}
		/>
	</section>
	<section>
		<h3>
			The same draft, {report.runs.runs} more times
			<span>your picks on autopick from the board, the bots reshuffled each run</span>
		</h3>
		<RunsSection runs={report.runs} teams={report.teams} rank={mine?.rank ?? 0} />
		<p class="basis">
			Each run drafts the room again from pick one with a new seed, seeds {report.seed} to {report.seed +
				report.runs.runs -
				1}, the bots drafting the way this room's bots do and your seat taking the best player the
			board has for your roster. Our projections lead the board, so a seat drafting off it finishes
			high in most runs. The spread is the useful read.
		</p>
	</section>
	{#snippet dock()}
		<Exposure runs={report.runs} {board} seat={report.slot} />
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

	h2 {
		margin: 0 0 6px;
		font-family: var(--font-num);
		font-weight: 800;
		font-size: 38px;
		line-height: 0.95;
		text-transform: uppercase;
	}

	.hero p {
		margin: 0;
		color: var(--ink-2);
		max-width: 62ch;
	}

	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-2);
		margin-top: var(--s-3);
	}

	h3 {
		margin: var(--s-5) 0 var(--s-3);
		font-family: var(--font-num);
		font-weight: 800;
		font-size: 26px;
		line-height: 1;
		text-transform: uppercase;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--s-3);
	}

	h3 span {
		font-family: var(--font-ui);
		font-weight: 500;
		font-size: var(--t-xs);
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
	}

	.basis {
		font-size: var(--t-xs);
		color: var(--ink-3);
		margin-top: var(--s-3);
		max-width: 70ch;
	}

	@media (max-width: 760px) {
		.hero {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--s-3);
		}

		.big b {
			font-size: 64px;
		}

		h2 {
			font-size: 28px;
		}
	}
</style>
