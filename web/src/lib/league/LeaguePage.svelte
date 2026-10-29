<script lang="ts">
	import { onMount } from 'svelte';
	import { HTTP_STATUS, hasStatus, isSignedOut } from '#lib/api/status.ts';
	import { takeHeld } from '#lib/context/held.ts';
	import { scoresSentence } from '#lib/context/note-words.ts';
	import { lazySheet } from '#lib/site/lazy-sheet.svelte.ts';
	import { links } from '#lib/site/links.ts';
	import DisplayTitle from '#lib/ui/DisplayTitle.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import Footnote from '#lib/ui/Footnote.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import { listWords } from '#lib/format/list.ts';
	import { plural } from '#lib/format/number.ts';
	import { droppedKinds } from './scoring-words.ts';
	import HostReconnect from '#lib/hosts/HostReconnect.svelte';
	import { ApiError, leagueApi, type LeagueSync } from './api.ts';
	import { loadBoard, type LeagueBoard } from './board.ts';
	import { boardOnce } from './board-once.ts';
	import { sheetTags } from './sheet-tags.ts';
	import { followSwitch } from './follow-switch.svelte.ts';
	import SeasonPanel from './SeasonPanel.svelte';
	import { tabHref } from './inseason/tabs.ts';
	import {
		inSeasonApi,
		type LeagueRecord,
		type LineupAdvice,
		type Scoreboard
	} from './inseason/api.ts';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import { sectionHref } from '#lib/ui/nav.ts';
	import { leagueWeekParts, weekBasisText } from './home/week-basis.ts';
	import { memberZone, weekdayTime } from '#lib/format/clock.ts';
	import { BENCH_ANCHOR } from './box/lineup.ts';
	import RosterPanel from './RosterPanel.svelte';
	import ScoreBoard from './home/ScoreBoard.svelte';
	import Standings from './home/Standings.svelte';
	import LineupSummary from './home/LineupSummary.svelte';
	import MovesFeed from './home/MovesFeed.svelte';
	import LeagueSettings from './home/LeagueSettings.svelte';
	import PowerPanel from './home/PowerPanel.svelte';
	import StartSitRow from './home/StartSitRow.svelte';
	import { gapFigure, powerPanel, startSitRow } from './home/figures.ts';
	import {
		HOME,
		bugsOf,
		projectedFinalOf,
		feedRows,
		lineupSummary,
		movesBasis,
		projections,
		standingsRows
	} from './home/home.ts';
	import {
		POLL_MS,
		leagueBasis,
		hostWords,
		myPlace,
		myTeam,
		placeWords,
		READING_NOW,
		readLine,
		readNowWords,
		recordWords
	} from './model.ts';

	/** One attached league (Lane 66i): read on open and once a minute while open (the API reads the
	 * host at most once a minute whatever the number of viewers), and again on the drafter's one tap.
	 * In season it is a standings and roster board: the week's scoreboard across the top, the
	 * standings as a box score beside the drafter's lineup, the moves as a feed, and the league's
	 * settings behind a tab. Before the draft and after the season it carries the season's word, the
	 * standings and the roster on our board. Everything is read in the browser; the shell paints
	 * first. The page is the selected league: opening it selects it in the shell's switch, and
	 * switching there opens the league switched to. */
	interface Props {
		id: string;
	}

	let { id }: Props = $props();

	interface ReadStamp {
		at: string | null;
		stale: boolean;
	}

	let sync = $state<LeagueSync | null>(null);
	let board = $state<LeagueBoard | null>(null);
	/** The week's games and the drafter's lineup, each null where the API has none for this league
	 * (no saved scoring, no current week): the page stands without it. A failed read keeps the last
	 * good one, with when it was read. */
	let scoreboard = $state<Scoreboard | null>(null);
	let advice = $state<LineupAdvice | null>(null);
	/** Our record in the league, for the member's start and sit row (Lane 292); null where the API has
	 * none (an older API, a platform whose weeks are not kept): the row is then not drawn. */
	let record = $state<LeagueRecord | null>(null);
	/** Each week read's last good time, and whether its latest read failed: each carries its own. */
	let scoreRead = $state<ReadStamp>({ at: null, stale: false });
	let lineupRead = $state<ReadStamp>({ at: null, stale: false });
	let view = $state<'week' | 'settings'>('week');
	let failure = $state<'signed-out' | 'missing' | 'unreachable' | 'host-sign-in' | null>(null);
	/** The league's saved name and host, for the way back in a league read as a member asks for when
	 * no member is connected. */
	let savedName = $state('');
	let savedHost = $state<LeagueSync['host']>('ffpc');
	let problem = $state<string | null>(null);
	/** The run's board file could not be read; cleared when one loads. */
	let boardFailed = $state(false);
	let refreshing = $state(false);
	let now = $state(new Date());

	// The page is created per league ({#key} in the route), so its id is fixed for its life.
	// svelte-ignore state_referenced_locally
	followSwitch(id, links.league);

	/** The league as the switch lists it, for its phase; a league it lacks yet, or an API from before
	 * the phase, reads as in season, the page this always was. */
	const listed = $derived(siteContext.leagues.find((l) => l.id === id));
	const phase = $derived(
		listed && (listed as Partial<typeof listed>).phase !== undefined ? listed.phase : 'in_season'
	);
	const drafted = $derived(phase !== 'pre_draft' && phase !== 'draft_day');
	const playing = $derived(phase === 'in_season' || phase === 'playoffs');

	function take(answer: LeagueSync): void {
		sync = answer;
		// The read the page made is the league's rosters for every other page's marks.
		takeHeld(id, answer);
		now = new Date();
		problem = null;
	}

	// The board is the run's own file, for the roster and the basis when no game is on: asked for on
	// each league read once the phase is known not to be in play, loaded once for the format asked
	// (board-once.ts). A failed load says so and is tried again with the next league read.
	const boards = boardOnce((format) =>
		loadBoard(format as LeagueSync['board_format'], byesNow, now.getTime())
	);
	let byesNow: Readonly<Record<string, number>> = {};
	$effect(() => {
		if (playing || !sync) return;
		byesNow = sync.byes;
		boards.read(
			sync.board_format,
			(loaded) => {
				board = loaded;
				boardFailed = false;
			},
			() => (boardFailed = true)
		);
	});

	/** The statuses with which the API says this league has no such answer (no team read, no current
	 * week, no saved scoring): the page stands without it. */
	const HAS_NONE = new Set([404, 409, 422]);

	/** One in-season read: its answer, or null where the API has none, set through keep; false when
	 * the read failed, so the last good answer stays on the page. */
	async function readOne<T>(
		call: () => Promise<T>,
		keep: (answer: T | null) => void
	): Promise<boolean> {
		if (!playing) {
			keep(null);
			return true;
		}
		try {
			keep(await call());
			return true;
		} catch (error: unknown) {
			if (error instanceof ApiError && HAS_NONE.has(error.status)) {
				keep(null);
				return true;
			}
			// eslint-disable-next-line no-console -- no user-facing text: the last good read stands, stamped
			console.warn('League page: the week read', error);
			return false;
		}
	}

	/** The page's two views, a tab each: arrow keys move between them, as tabs do. */
	const VIEWS = ['week', 'settings'] as const;

	function arrow(event: KeyboardEvent): void {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		view = view === 'week' ? 'settings' : 'week';
		document.getElementById(`league-tab-${view}`)?.focus();
	}

	async function readWeek(): Promise<void> {
		const read = await Promise.all([
			readOne(
				() => inSeasonApi.scoreboard(id),
				(answer) => (scoreboard = answer)
			),
			readOne(
				() => inSeasonApi.lineup(id),
				(answer) => (advice = answer)
			)
		]);
		now = new Date();
		const at = now.toISOString();
		const [scored, lined] = read;
		scoreRead = scored ? { at, stale: false } : { ...scoreRead, stale: true };
		lineupRead = lined ? { at, stale: false } : { ...lineupRead, stale: true };
	}

	/** "Last read Sun 3:05 pm" on a read whose latest try failed, so the page shows its last good one. */
	function stampOf(read: ReadStamp): string | null {
		return read.stale && read.at !== null ? `Last read ${weekdayTime(read.at)}` : null;
	}

	/** The record, read on open and with the drafter's refresh: it changes once a week. A failed read
	 * leaves the row out, never the page. */
	async function readRecord(): Promise<void> {
		if (!playing) return;
		try {
			record = await inSeasonApi.record(id);
		} catch {
			record = null;
		}
	}

	async function read(): Promise<void> {
		try {
			const [answer] = await Promise.all([leagueApi.sync(id), readWeek()]);
			take(answer);
		} catch (error) {
			if (isSignedOut(error)) failure = 'signed-out';
			else if (hasStatus(error, HTTP_STATUS.conflict)) {
				// A league read as a member, with no read of their own and the drafter not connected to read
				// it as: the way back in right here, under the league's saved name.
				failure = 'host-sign-in';
				// The name is a nicety: a failed list read leaves the generic title, and the form works
				// without it, so the failure is shown as that floor and not as an error.
				if (savedName === '') {
					void leagueApi
						.attached()
						.then((list) => {
							const mine = list.find((a) => a.id === id);
							savedName = mine?.name ?? '';
							savedHost = mine?.host ?? 'ffpc';
						})
						.catch(() => (savedName = ''));
				}
			} else if (hasStatus(error, HTTP_STATUS.notFound)) failure = 'missing';
			else if (sync === null) failure = 'unreachable';
			else problem = 'Your league could not be read just now. The page shows the last read.';
		}
	}

	async function refresh(): Promise<void> {
		refreshing = true;
		void readRecord();
		try {
			const [answer] = await Promise.all([leagueApi.refresh(id), readWeek()]);
			take(answer);
		} catch (error) {
			problem =
				error instanceof ApiError ? error.message : 'Your league could not be read just now.';
		} finally {
			refreshing = false;
		}
	}

	onMount(() => {
		void lazySheet.load();
		void read().then(readRecord);
		const timer = setInterval(() => void read(), POLL_MS);
		return () => clearInterval(timer);
	});

	const here = $derived(links.league(id));
	const dropped = $derived(sync ? droppedKinds(sync.scoring_dropped) : []);
	const team = $derived(sync ? myTeam(sync) : undefined);
	const platform = $derived(sync ? hostWords(sync.host) : '');
	// The live score's read sits beside it as a cell (Lane 92, B06).
	const bugs = $derived(
		sync && scoreboard
			? bugsOf(scoreboard, sync, now.getTime(), memberZone(), {
					host: sync.host,
					readAt: scoreboard.read_at
				})
			: []
	);
	const rows = $derived(sync ? standingsRows(sync, projections(scoreboard, now.getTime())) : []);
	const summary = $derived(
		advice && sync
			? lineupSummary(
					advice,
					memberZone(),
					now.getTime(),
					projectedFinalOf(scoreboard, sync.me),
					bugs.some((b) => b.mine && b.state !== 'upcoming')
				)
			: null
	);
	const moves = $derived(sync ? feedRows(sync) : []);
	const gap = $derived(
		sync
			? gapFigure(
					scoreboard,
					sync.me,
					bugs.some((b) => b.mine && b.state === 'upcoming')
				)
			: null
	);
	const power = $derived(sync ? powerPanel(scoreboard, sync) : null);
	const startSit = $derived(startSitRow(record));
	const lineupHref = $derived(tabHref('start', id));
	/** What every number on the in-season page is, said once in one paragraph, at most five lines at a
	 * desk and eight on a phone (Lane 108, B82: merged so no sentence ends a short line): the standings,
	 * a team's projection and points, the game facts. A feed the platform gives us none of is not
	 * drawn, so the basis says nothing of it (Lane 104, B54). A desk's and a phone's: the phone makes its
	 * cuts by the room left where the FFPC teams' words run long (week-basis.ts, Lane 141, B121). */
	const weekParts = $derived(
		sync
			? leagueWeekParts({
					sync,
					scoreboard,
					playerPoints: advice?.player_points ?? false,
					gameLines: advice ? advice.slots.flatMap((s) => (s.host ? [s.host] : [])) : null,
					bugs,
					now: now.getTime(),
					zone: memberZone()
				})
			: null
	);
	const weekBasis = $derived(
		weekParts
			? { desk: weekBasisText(weekParts, 'desk'), phone: weekBasisText(weekParts, 'phone') }
			: { desk: '', phone: '' }
	);
	/** Before the draft and after the season: the scoring the board's figures are in. */
	const boardBasis = $derived(
		board && sync
			? leagueBasis(board.seasonScoring, board.seasonThrough, sync.scoring_like, scoresSentence)
			: ''
	);
</script>

<svelte:head>
	<title>{sync?.name ? `${sync.name} · Commish` : 'Your league · Commish'}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#snippet footnotes(league: LeagueSync)}
	<footer class="foot">
		{#if league.settings_league_id}
			<Footnote>
				Your league's roster and scoring are saved for mock drafts, under its name in your saved
				leagues.
				{#if dropped.length > 0}
					Mock drafts use them except {listWords(dropped)}.
				{/if}
				{#if league.scoring_defaulted.length > 0}
					For {plural(league.scoring_defaulted.length, 'rule')} your league does not state, they use our
					standard points.
				{/if}
			</Footnote>
			<!-- Before the draft and after the season the season panel carries the verb. -->
		{:else if league.settings_note}
			<Footnote>{league.settings_note}</Footnote>
		{/if}
	</footer>
{/snippet}

<Shell title="League" active="league" league={id}>
	{#if failure === 'signed-out'}
		<div class="pad">
			<EmptyState
				title="Sign in to see your league"
				line="A league lives on your account. Following one is free."
			>
				{#snippet actions()}<Verb href={leagueApi.signInUrl(here)}>Sign in</Verb>{/snippet}
			</EmptyState>
		</div>
	{:else if failure === 'missing'}
		<div class="pad">
			<EmptyState
				title="This league is not on your account"
				line="Paste its link again to follow it."
			>
				{#snippet actions()}<Verb href={links.leagueNew()}>Follow a league</Verb>{/snippet}
			</EmptyState>
		</div>
	{:else if failure === 'host-sign-in'}
		<main class="league">
			<DisplayTitle size="page" wrap
				>{savedName || `Your ${hostWords(savedHost)} league`}</DisplayTitle
			>
			<p class="sub">
				Read from {hostWords(savedHost)} as a member. {savedHost === 'ffpc'
					? 'Sign in to FFPC'
					: `Connect ${hostWords(savedHost)}`} to read it now.
			</p>
			<HostReconnect
				host={savedHost}
				returnTo={here}
				onconnected={() => {
					failure = null;
					void read();
				}}
			/>
			<div class="out"><Quiet href={links.accountLeagues()} size="sm">Your leagues</Quiet></div>
		</main>
	{:else if failure === 'unreachable'}
		<div class="pad">
			<EmptyState title="Your league can't be read right now" line="Reload in a moment." />
		</div>
	{:else if sync && !playing && !board && boardFailed}
		<div class="pad">
			<ProblemLine>Our board can't be read right now. We try again in a minute.</ProblemLine>
		</div>
	{:else if sync && (playing || board)}
		<main class="league">
			<header class="lead">
				<div class="title">
					<DisplayTitle size="page" wrap>{sync.name || `Your ${platform} league`}</DisplayTitle>
					<p class="sub">
						{#if team}
							{team.name}, {recordWords(team)}, {placeWords(myPlace(sync), sync.teams.length)}.
						{/if}
						<span class="read" role="status">{readLine(sync, now)}</span>
					</p>
				</div>
				<div class="reads">
					<Quiet size="sm" disabled={refreshing} onclick={() => void refresh()}
						>{refreshing ? READING_NOW : readNowWords(sync.host)}</Quiet
					>
				</div>
			</header>
			<div class="navrow">
				<div class="segs" role="tablist" aria-label="League view" tabindex="-1" onkeydown={arrow}>
					{#each VIEWS as v (v)}
						<button
							type="button"
							role="tab"
							id="league-tab-{v}"
							aria-controls="league-panel"
							aria-selected={view === v}
							tabindex={view === v ? 0 : -1}
							onclick={() => (view = v)}
							>{v === 'settings'
								? HOME.settings
								: playing && sync.week > 0
									? `${HOME.week} ${String(sync.week)}`
									: HOME.standings}</button
						>
					{/each}
				</div>
			</div>
			{#if problem}
				<Panel edge="loss" padding="sm"><ProblemLine>{problem}</ProblemLine></Panel>
			{/if}
			{#if sync.host_signed_out}
				<!-- The read line asks the drafter to connect: the sign-in that mends it sits under it. -->
				<HostReconnect host={sync.host} returnTo={here} onconnected={() => void refresh()} />
			{/if}
			<div class="panel" id="league-panel" role="tabpanel" aria-labelledby="league-tab-{view}">
				{#if view === 'settings'}
					<LeagueSettings
						terms={sync.terms}
						host={sync.host}
						teams={sync.teams.length}
						uncounted={advice?.uncounted_rules ?? []}
					/>
				{:else if playing}
					{#if bugs.length > 0 && scoreboard}
						<ScoreBoard
							week={scoreboard.week}
							{bugs}
							matchupHref={tabHref('matchup', id)}
							stamp={stampOf(scoreRead)}
							{gap}
						/>
					{/if}
					<div class="split" class:alone={summary === null && startSit === null}>
						<div class="col">
							<Standings
								{rows}
								terms={sync.terms}
								host={sync.host}
								projected={scoreboard !== null}
							/>
							<!-- Stacked, the power panel follows the lineup: the lineup is the screen's verb. -->
							{#if power}<div class="power-slot"><PowerPanel panel={power} /></div>{/if}
						</div>
						<div class="col">
							{#if startSit}<StartSitRow row={startSit} />{/if}
							{#if summary && team}
								<LineupSummary
									team={team.name}
									{platform}
									{summary}
									{lineupHref}
									benchHref={`${lineupHref}#${BENCH_ANCHOR}`}
									tagsOf={sheetTags}
									stamp={stampOf(lineupRead)}
									host={sync.host}
									now={now.getTime()}
								/>
							{/if}
						</div>
					</div>
					{#if sync.moves_read}<MovesFeed rows={moves} none={HOME.noMoves} />{/if}
					<!-- In season the page carries no draft plumbing: the mock draft lives under Account and
					     the rail's Mock draft (Lane 104, B54). -->
					<div class="basis" data-basis="league">
						{#if weekBasis.desk === weekBasis.phone}<p>{weekBasis.desk}</p>{:else}<p class="desk">
								{weekBasis.desk}
							</p>
							<p class="phone">{weekBasis.phone}</p>{/if}
					</div>
				{:else if board}
					<SeasonPanel
						{phase}
						draftAt={listed?.draft_at ?? null}
						team={team?.name ?? ''}
						standing={listed?.standing ?? null}
						mockHref={sync.settings_league_id
							? links.mockLeague(sync.settings_league_id)
							: sectionHref('mock')}
						{now}
					/>
					<Standings {rows} terms={sync.terms} host={sync.host} projected={false} />
					{#if boardBasis}<p class="basis-line">{boardBasis}</p>{/if}
					<div class="grid">
						{#if drafted}
							<RosterPanel roster={sync.roster} {board} tagsOf={sheetTags} host={sync.host} />
							{#if sync.moves_read}<MovesFeed rows={moves} none={HOME.noMoves} />{:else}<p
									class="basis-line"
								>
									{movesBasis(sync.host)}
								</p>{/if}
						{/if}
					</div>
					{@render footnotes(sync)}
				{/if}
			</div>
		</main>
	{:else}
		<div class="reserve"></div>
	{/if}
</Shell>

<style>
	.reads {
		display: flex;
		align-items: center;
		gap: var(--s-3);
	}

	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
	}

	.navrow {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s-3);
		flex-wrap: wrap;
	}

	.segs {
		display: inline-flex;
		gap: 2px;
		padding: 3px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
	}

	.segs button {
		height: 30px;
		padding: 0 var(--s-3);
		border: 0;
		border-radius: var(--r-pill);
		background: transparent;
		font-size: var(--t-sm);
		font-weight: 600;
		color: var(--ink-2);
		cursor: pointer;
	}

	.segs button[aria-selected='true'] {
		background: var(--ink);
		color: var(--bg);
	}

	.split {
		display: grid;
		grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
		gap: var(--s-5);
		align-items: start;
	}

	.col {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		min-width: 0;
	}

	.split.alone {
		grid-template-columns: minmax(0, 1fr);
	}

	.basis {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.basis p,
	.basis-line {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-3);
		line-height: 1.5;
	}

	/* The basis's desk and phone forms, where they differ (Lane 137 fix round 1). */
	.basis p.phone {
		display: none;
	}

	.pad {
		padding: var(--s-4) var(--s-5) 0;
	}

	.league {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		padding: var(--s-4) var(--s-5) var(--s-6);
	}

	.lead {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--s-3);
		flex-wrap: wrap;
	}

	.title {
		min-width: 0;
	}

	/* The quiet way out sits at its own width under the form, never a full-width bar. */
	.out {
		align-self: flex-start;
	}

	.sub {
		margin: var(--s-1) 0 0;
		color: var(--ink-2);
	}

	.read {
		color: var(--ink-3);
		font-size: var(--t-sm);
	}

	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
		gap: var(--s-4);
		align-items: start;
	}

	.foot {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		align-items: flex-start;
	}

	.reserve {
		min-height: 70vh;
	}

	@media (max-width: 1100px) {
		.grid,
		.split {
			grid-template-columns: minmax(0, 1fr);
		}

		.split .col {
			display: contents;
		}

		.power-slot {
			order: 1;
		}
	}

	@media (max-width: 760px) {
		/* The basis keeps to eight drawn lines in a hand. */
		.basis p,
		.basis-line {
			font-size: var(--t-xs);
			line-height: 1.45;
		}

		.basis p.desk {
			display: none;
		}

		.basis p.phone {
			display: block;
		}

		.league {
			padding: var(--s-3) var(--s-4);
		}

		.pad {
			padding: var(--s-4) var(--s-4) 0;
		}
	}
</style>
