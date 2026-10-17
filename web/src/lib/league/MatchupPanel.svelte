<script lang="ts">
	import BoxTable from './box/BoxTable.svelte';
	import MatchupBug from './box/MatchupBug.svelte';
	import BoxBasis from './box/BoxBasis.svelte';
	import { sheetTags } from './sheet-tags.ts';
	import { BOX } from './box/box.ts';
	import { nextKickoff, sideBox, type SideBox } from './box/matchup.ts';
	import type { LeagueSync, MatchupSide } from './api.ts';
	import type { MatchupBox } from './inseason/api.ts';
	import { hostWords, matchupGap, scoreGap, scoreUnread, teamName } from './model.ts';

	/** This week's game as a box score (Lane 66d): the score bug with both teams, their points so far
	 * and their projections, then each team's box (its starters in their slots, its totals, its
	 * bench), side by side on a desk, the drafter's above in a hand. The rows come from the API's box
	 * answer (box); without one they are the league read's starters with their points. The screen's
	 * basis says once what Proj and Pts are and when the game facts were read. The Matchup screen (spec
	 * 2026-10-16 §3). */
	interface Props {
		sync: LeagueSync;
		/** The API's box score for the week, null when it has none for this league. */
		box: MatchupBox | null;
		/** The clock the page's read line uses. */
		now: Date;
	}

	let { sync, box, now }: Props = $props();

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

	/** In an all-play week a read score is shown even at 0: the host's own total, read, is the fact. */
	function showsTotal(s: MatchupSide): boolean {
		return !scoreUnread(s) && (hasStarted(s) || sync.week_all_play);
	}

	function boxOf(s: MatchupSide): SideBox {
		const answered = box?.sides.find((b) => b.roster_id === s.roster_id) ?? null;
		return sideBox(s, answered, {
			scored: playersScored(s),
			hostTotal: showsTotal(s) ? s.points : null,
			landed: box?.projection_read_at != null,
			week: matchup?.week ?? sync.week
		});
	}

	const mine = $derived(matchup ? boxOf(matchup.mine) : null);
	const theirs = $derived(matchup?.opponent ? boxOf(matchup.opponent) : null);
	const lines = $derived([...(mine?.lines ?? []), ...(theirs?.lines ?? [])]);
	const kickoff = $derived(nextKickoff(lines, now.getTime()));
	/** FFPC is read as one member, so the API keeps only the viewer's own starters. */
	const hidden = $derived(`${hostWords(sync.host)} shows us your lineup only.`);
</script>

{#if matchup && mine}
	<div class="matchup">
		<h2 class="title">
			<span class="wk">Week {matchup.week}</span>
			{teamName(sync, matchup.mine.roster_id)}{#if matchup.opponent}
				<i>vs</i>{teamName(sync, matchup.opponent.roster_id)}{/if}
		</h2>
		<MatchupBug
			week={matchup.week}
			mine={{
				name: teamName(sync, matchup.mine.roster_id),
				pts: mine.totals.pts,
				proj: mine.totals.proj
			}}
			opponent={matchup.opponent && theirs
				? {
						name: teamName(sync, matchup.opponent.roster_id),
						pts: theirs.totals.pts,
						proj: theirs.totals.proj
					}
				: null}
			{kickoff}
		/>
		{#if sync.week_all_play}
			<p class="note">
				An all-play week on {hostWords(sync.host)}: your score is set against every other team's.
			</p>
		{/if}
		{#if scoreUnread(matchup.mine)}<p class="note">{scoreGap(sync, now)}</p>{/if}
		<div class="boxes">
			<BoxTable
				team={teamName(sync, matchup.mine.roster_id)}
				mine
				tagsOf={sheetTags}
				starters={mine.starters}
				bench={mine.bench}
				totals={mine.totals}
			/>
			{#if matchup.opponent && theirs}
				<BoxTable
					team={teamName(sync, matchup.opponent.roster_id)}
					starters={theirs.starters}
					bench={theirs.bench}
					totals={theirs.totals}
					empty={sync.host === 'ffpc' ? hidden : null}
				/>
			{:else if !sync.week_all_play}
				<p class="note">{BOX.noOpponent}</p>
			{/if}
		</div>
		<BoxBasis
			byPlayer={mine.byPlayer}
			projection={box ? { readAt: box.projection_read_at, scoring: box.projection_scoring } : null}
			{lines}
		/>
	</div>
{:else}
	<p class="note">{matchupGap(sync, now)}</p>
{/if}

<style>
	.matchup {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
	}

	.title {
		margin: 0;
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-head);
		line-height: 1.05;
		text-transform: uppercase;
		letter-spacing: 0.01em;
		overflow-wrap: anywhere;
	}

	.title i {
		margin-inline: 0.25em;
		font-style: normal;
		color: var(--ink-3);
	}

	.wk {
		display: block;
		font-size: var(--t-md);
		color: var(--accent-text);
		letter-spacing: 0.04em;
	}

	.boxes {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--s-4);
		align-items: start;
	}

	.note {
		margin: 0;
		color: var(--ink-2);
	}

	@media (max-width: 1100px) {
		.boxes {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (max-width: 760px) {
		.matchup {
			gap: var(--s-3);
		}
	}
</style>
