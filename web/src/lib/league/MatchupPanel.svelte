<script lang="ts">
	import BoxTable from './box/BoxTable.svelte';
	import MatchupBug from './box/MatchupBug.svelte';
	import BoxBasis from './box/BoxBasis.svelte';
	import { sheetTags } from './sheet-tags.ts';
	import { BOX } from './box/box.ts';
	import { NONE_UNLISTED } from './box/basis.ts';
	import { KICKOFF } from './box/kickoff.ts';
	import {
		decidedHead,
		matchupFinal,
		matchupNoFinal,
		matchupStarted,
		matchupUnlisted,
		nextKickoff,
		sideBox,
		standingLine,
		unlistedStates,
		type SideBox
	} from './box/matchup.ts';
	import { readCell } from './home/home.ts';
	import type { LeagueHost, LeagueSync, MatchupSide } from './api.ts';
	import type { MatchupBox } from './inseason/api.ts';
	import { hostWords, matchupGap, scoreGap, scoreUnread, teamName } from './model.ts';
	import { page } from '$app/state';
	import { askedHref } from './box/asked.ts';
	import type { BoxRow } from './box/box.ts';
	import { tabHref } from './inseason/tabs.ts';
	import { lineupOffer, rowBySlug, type ScreenOffer } from '#lib/player/shelf-state.ts';
	import { providePlayerShelf } from '#lib/player/shelf-host.ts';
	import PlayerShelfLayer from '#lib/player/PlayerShelfLayer.svelte';

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
		/** The platform the page's head names and the page's own clock in ms, ticking: the read beside
		 * the live score names the one and is aged by the other. */
		live?: { host: LeagueHost; clock: number };
	}

	let { sync, box, now, live }: Props = $props();

	const matchup = $derived(sync.matchup);

	/** A side has started once its total is not 0 or a starter has a point: before that its zeros
	 * would read as duds, so its points stay blank. */
	function hasStarted(s: MatchupSide): boolean {
		return s.points !== 0 || s.starters.some((p) => (p.points ?? 0) !== 0);
	}

	/** In an all-play week a read score is shown even at 0: the host's own total, read, is the fact. */
	function showsTotal(s: MatchupSide): boolean {
		return !scoreUnread(s) && (hasStarted(s) || sync.week_all_play);
	}

	/** Both sides' starters' lines, the game's by the one rule: a side listing none (an FFPC opponent)
	 * reads by the schedule (unlisted), never by his bench's games (Lane 137, B107). */
	const starterLines = $derived((box?.sides ?? []).flatMap((s) => s.starters.map((st) => st.line)));

	/** The game has kicked off by both sides' starters (Lane 92): the Pts are the big figures. */
	const started = $derived(matchupStarted(starterLines, now.getTime()));

	/** The states by the schedule of the sides the platform lists no starters for (Lane 124, B102). */
	const unlisted = $derived(unlistedStates(box));

	/** Every starter the screen holds a line for is final and every side listing none is by the
	 * schedule (Lane 124, B102): a side with no box follows it. */
	const headFinal = $derived(matchupFinal(starterLines, now.getTime(), unlisted));

	function boxOf(s: MatchupSide): SideBox {
		const answered = box?.sides.find((b) => b.roster_id === s.roster_id) ?? null;
		return sideBox(s, answered, {
			hostTotal: showsTotal(s) ? s.points : null,
			landed: box?.projection_read_at != null,
			week: matchup?.week ?? sync.week,
			now: now.getTime(),
			started,
			headFinal
		});
	}

	/** A side's count while the game is under way, the API's (MatchupBoxSide.to_play, fix round 1). */
	function countOf(rosterId: number): string {
		return started ? (box?.sides.find((b) => b.roster_id === rosterId)?.to_play ?? '') : '';
	}

	const mine = $derived(matchup ? boxOf(matchup.mine) : null);
	const theirs = $derived(matchup?.opponent ? boxOf(matchup.opponent) : null);
	const lines = $derived([...(mine?.lines ?? []), ...(theirs?.lines ?? [])]);
	/** What the opponent's Team row draws where the platform lists him no starters (an FFPC opponent):
	 * his best lineup's figure, or "--" with no roster read, said once in the key. */
	const theirsUnlisted = $derived(
		theirs === null
			? NONE_UNLISTED
			: matchupUnlisted(
					box?.sides.find((b) => b.roster_id === matchup?.opponent?.roster_id) ?? null,
					theirs.totals
				)
	);
	/** The bug's middle, "Decided" while the side behind has nobody left (the API's, Lane 99 B31). */
	const kickoff = $derived(
		decidedHead(
			nextKickoff(starterLines, now.getTime(), undefined, unlisted),
			box?.decided === true,
			started
		)
	);
	/** The read beside the live score (Lane 92, B06), while the game is under way. */
	const read = $derived(
		started && kickoff?.head !== KICKOFF.final
			? readCell(
					{ host: live?.host ?? sync.host, readAt: sync.read_at },
					live?.clock ?? now.getTime()
				)
			: null
	);
	/** Each side's rows, the member's first. */
	const rowsOf = (side: SideBox | null): BoxRow[] =>
		side === null ? [] : [...side.starters.map((s) => s.row), ...side.bench];

	/** The player shelf's verb (Lane 113): the way to his row on the member's Lineup, for the member's
	 * players; none for the opponent's. */
	function shelfOffer({ key, boardId, position }: BoxRow): ScreenOffer | null {
		const id = page.params.id ?? '';
		if (boardId === null || !rowsOf(mine).some((r) => r.key === key)) return null;
		return lineupOffer({
			href: askedHref(tabHref('start', id), 'start', { id: boardId, position })
		});
	}

	const shelf = providePlayerShelf({
		screen: 'matchup',
		now: () => now.getTime(),
		league: () => ({ id: page.params.id ?? '', host: sync.host }),
		offer: shelfOffer,
		rowOf: (slug) => rowBySlug([...rowsOf(mine), ...rowsOf(theirs)], slug)
	});

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
				proj: mine.totals.proj,
				final: mine.totals.final,
				allFinal: mine.totals.allFinal,
				toPlay: countOf(matchup.mine.roster_id)
			}}
			opponent={matchup.opponent && theirs
				? {
						name: teamName(sync, matchup.opponent.roster_id),
						pts: theirs.totals.pts,
						proj: theirs.totals.proj,
						final: theirs.totals.final,
						allFinal: theirs.totals.allFinal,
						toPlay: countOf(matchup.opponent.roster_id)
					}
				: null}
			{kickoff}
			{started}
			{read}
			standing={standingLine(box, started)}
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
				ranked
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
					ranked
					empty={sync.host === 'ffpc' ? hidden : null}
				/>
			{:else if !sync.week_all_play}
				<p class="note">{BOX.noOpponent}</p>
			{/if}
		</div>
		<BoxBasis
			byPlayer={mine.byPlayer}
			teamTotal={mine.teamTotal}
			host={sync.host}
			projection={box ? { readAt: box.projection_read_at, scoring: box.projection_scoring } : null}
			{lines}
			kicked={started}
			noFinal={matchupNoFinal(mine.totals, theirs?.totals ?? null, theirsUnlisted)}
			allFinal={[mine, theirs].every((s) => s === null || s.totals.allFinal)}
			finalNone={[mine, theirs].some(
				(s) => s !== null && s.totals.live && s.totals.allFinal && s.totals.pts === null
			)}
			unlisted={theirsUnlisted}
			lineup={null}
			now={now.getTime()}
		/>
		<PlayerShelfLayer host={shelf} />
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
