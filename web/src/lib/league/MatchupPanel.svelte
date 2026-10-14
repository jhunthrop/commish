<script lang="ts">
	import { fixed } from '#lib/format/number.ts';
	import type { LeagueBoard } from './board.ts';
	import Label from '#lib/ui/Label.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import type { LeagueSync, MatchupSide } from './api.ts';
	import LeagueRow from './LeagueRow.svelte';
	import {
		hostWords,
		matchupAside,
		matchupGap,
		rowOf,
		scoreGap,
		statusOn,
		teamName
	} from './model.ts';

	/** This week's game: both lineups as the host has them set, each starter's points so far, and
	 * each side's total. Side by side on a desk, one above the other in a hand. */
	interface Props {
		sync: LeagueSync;
		board: LeagueBoard;
		tagsOf: (boardId: string | null) => readonly string[];
		/** The clock the page's read line uses, for a week we could not read. */
		now: Date;
	}

	let { sync, board, tagsOf, now }: Props = $props();

	const matchup = $derived(sync.matchup);

	/** Whether any starter on a side has a point. A host that gives each team's total but no player's
	 * (FFPC, until its scoreboard is read) keeps every starter's points blank. */
	function playersScored(s: MatchupSide): boolean {
		return s.starters.some((p) => p.points !== 0);
	}

	/** A side has started once its total is not 0 or a starter has a point: before that its zeros
	 * would read as duds, so its points stay blank. */
	function hasStarted(s: MatchupSide): boolean {
		return s.points !== 0 || playersScored(s);
	}

	const started = $derived(
		matchup !== null &&
			[matchup.mine, ...(matchup.opponent ? [matchup.opponent] : [])].some(hasStarted)
	);

	/** In an all-play week a read score is shown even at 0: the host's own total, read, is the fact. */
	function showsTotal(s: MatchupSide): boolean {
		return s.points_read && (hasStarted(s) || sync.week_all_play);
	}
</script>

{#snippet side(s: MatchupSide, mine: boolean)}
	{@const live = showsTotal(s)}
	{@const scored = playersScored(s)}
	<section class="side" class:mine aria-label={teamName(sync, s.roster_id)}>
		<header>
			<span class="team">{teamName(sync, s.roster_id)}</span>
			{#if live}<span class="total">{fixed(s.points)}</span>{/if}
		</header>
		{#if s.starters.length === 0 && sync.host === 'ffpc' && !mine}
			<!-- FFPC is read as one member, so the API keeps only the viewer's own starters. -->
			<p class="none">{hostWords(sync.host)} shows us your lineup only.</p>
		{/if}
		{#each s.starters as starter (starter.player.host_id)}
			<LeagueRow
				player={rowOf(board, starter.player)}
				host={starter.player}
				tags={mine ? tagsOf(starter.player.board_id) : []}
				status={mine ? statusOn(sync.roster, starter.player.host_id) : null}
			>
				{#snippet trailing()}
					{#if scored}<span class="pts">{fixed(starter.points)}</span>{/if}
				{/snippet}
			</LeagueRow>
		{/each}
	</section>
{/snippet}

<Panel as="section" label="This week's matchup" padding="none">
	{#if matchup}
		<div class="head">
			<PanelHead
				title={`Week ${String(matchup.week)}`}
				aside={matchupAside(matchup, sync.week_all_play, started)}
				level={2}
			/>
			{#if sync.week_all_play}
				<p class="none">
					An all-play week on {hostWords(sync.host)}: your score is set against every other team's.
				</p>
			{/if}
			{#if !matchup.mine.points_read}
				<p class="none">{scoreGap(sync, now)}</p>
			{/if}
		</div>
		<div class="sides">
			{@render side(matchup.mine, true)}
			{#if matchup.opponent}
				{@render side(matchup.opponent, false)}
			{:else if !sync.week_all_play}
				<p class="none"><Label>No opponent this week</Label></p>
			{/if}
		</div>
	{:else}
		<div class="head">
			<PanelHead title="This week" level={2} />
			<p class="none">{matchupGap(sync, now)}</p>
		</div>
	{/if}
</Panel>

<style>
	.head {
		padding: var(--s-3) var(--s-3) 0;
	}

	.sides {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--s-4);
		padding: var(--s-2) 0 var(--s-3);
	}

	.side header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--s-2);
		padding: var(--s-2) var(--s-3);
		border-bottom: 2px solid var(--line-strong);
	}

	.mine header {
		border-bottom-color: var(--accent);
	}

	.team {
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		unicode-bidi: isolate;
	}

	.total {
		font-family: var(--font-num);
		font-size: var(--t-xl);
		font-weight: 700;
	}

	.pts {
		font-family: var(--font-num);
		font-weight: 600;
	}

	.none {
		margin: 0;
		padding: var(--s-3);
		color: var(--ink-2);
	}

	@media (max-width: 760px) {
		.sides {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
