<script lang="ts">
	import { fixed } from '#lib/format/number.ts';
	import type { Board } from '#lib/room/model.ts';
	import Label from '#lib/ui/Label.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import type { LeagueSync, MatchupSide } from './api.ts';
	import LeagueRow from './LeagueRow.svelte';
	import { rowOf, teamName } from './model.ts';

	/** This week's game: both lineups as the host has them set, each starter's points so far, and
	 * each side's total. Side by side on a desk, one above the other in a hand. */
	interface Props {
		sync: LeagueSync;
		board: Board;
		tagsOf: (boardId: string | null) => readonly string[];
	}

	let { sync, board, tagsOf }: Props = $props();

	const matchup = $derived(sync.matchup);
	const started = $derived(
		matchup !== null &&
			[matchup.mine, ...(matchup.opponent ? [matchup.opponent] : [])].some((s) =>
				s.starters.some((p) => p.points !== 0)
			)
	);
</script>

{#snippet side(s: MatchupSide, mine: boolean)}
	<section class="side" class:mine aria-label={teamName(sync, s.roster_id)}>
		<header>
			<span class="team">{teamName(sync, s.roster_id)}</span>
			<span class="total">{fixed(s.points)}</span>
		</header>
		{#each s.starters as starter (starter.player.host_id)}
			<LeagueRow
				player={rowOf(board, starter.player)}
				host={starter.player}
				tags={mine ? tagsOf(starter.player.board_id) : []}
			>
				{#snippet trailing()}
					<span class="pts">{fixed(starter.points)}</span>
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
				aside={started ? 'Points so far' : 'No games played yet'}
				level={2}
			/>
		</div>
		<div class="sides">
			{@render side(matchup.mine, true)}
			{#if matchup.opponent}
				{@render side(matchup.opponent, false)}
			{:else}
				<p class="none"><Label>No opponent this week</Label></p>
			{/if}
		</div>
	{:else}
		<div class="head">
			<PanelHead title="This week" level={2} />
			<p class="none">
				{sync.week === 0
					? 'Your league has no games this week.'
					: `Your team has no game in week ${String(sync.week)}.`}
			</p>
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
