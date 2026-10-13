<script lang="ts">
	import { onMount } from 'svelte';
	import { HTTP_STATUS, hasStatus, isSignedOut } from '#lib/api/status.ts';
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
	import { presetWords } from '#lib/room/setup/scoring.ts';
	import { droppedKinds } from './scoring-words.ts';
	import FFPCSignIn from '#lib/hosts/FFPCSignIn.svelte';
	import { ApiError, leagueApi, type LeagueSync } from './api.ts';
	import { loadBoard, type LeagueBoard } from './board.ts';
	import MatchupPanel from './MatchupPanel.svelte';
	import MovesPanel from './MovesPanel.svelte';
	import RosterPanel from './RosterPanel.svelte';
	import StandingsStrip from './StandingsStrip.svelte';
	import WaiverPool from './WaiverPool.svelte';
	import { POLL_MS, hostWords, myPlace, myTeam, poolRows, readLine, recordWords } from './model.ts';

	/** One attached league: read on open and once a minute while open (the API reads the host at most
	 * once a minute whatever the number of viewers), and again on the drafter's one tap. Everything is
	 * read in the browser; the shell paints first. */
	interface Props {
		id: string;
	}

	let { id }: Props = $props();

	let sync = $state<LeagueSync | null>(null);
	let board = $state<LeagueBoard | null>(null);
	let failure = $state<'signed-out' | 'missing' | 'unreachable' | 'host-sign-in' | null>(null);
	/** The league's saved name, for the sign-in an FFPC league with no member signed in asks for. */
	let savedName = $state('');
	let problem = $state<string | null>(null);
	/** The run's board file could not be read; cleared when one loads. */
	let boardFailed = $state(false);
	let refreshing = $state(false);
	let now = $state(new Date());

	function take(answer: LeagueSync): void {
		sync = answer;
		// The board is the run's own file: read once, and again only when the league reads on another.
		// A failed board read says so and is tried again with the next read of the league.
		if (board?.format !== answer.board_format) {
			void loadBoard(answer.board_format, answer.byes)
				.then((loaded) => {
					board = loaded;
					boardFailed = false;
				})
				.catch(() => (boardFailed = true));
		}
		now = new Date();
		problem = null;
	}

	async function read(): Promise<void> {
		try {
			take(await leagueApi.sync(id));
		} catch (error) {
			if (isSignedOut(error)) failure = 'signed-out';
			else if (hasStatus(error, HTTP_STATUS.conflict)) {
				// An FFPC league with no member signed in to read it as: sign in right here, under the
				// league's saved name.
				failure = 'host-sign-in';
				// The name is a nicety: a failed list read leaves the generic title, and the form works
				// without it, so the failure is shown as that floor and not as an error.
				if (savedName === '') {
					void leagueApi
						.attached()
						.then((list) => (savedName = list.find((a) => a.id === id)?.name ?? ''))
						.catch(() => (savedName = ''));
				}
			} else if (hasStatus(error, HTTP_STATUS.notFound)) failure = 'missing';
			else if (sync === null) failure = 'unreachable';
			else problem = 'Your league could not be read just now. The page shows the last read.';
		}
	}

	async function refresh(): Promise<void> {
		refreshing = true;
		try {
			take(await leagueApi.refresh(id));
		} catch (error) {
			problem =
				error instanceof ApiError ? error.message : 'Your league could not be read just now.';
		} finally {
			refreshing = false;
		}
	}

	onMount(() => {
		void lazySheet.load();
		void read();
		const timer = setInterval(() => void read(), POLL_MS);
		return () => clearInterval(timer);
	});

	/** Your sheet's tags on a board player, none before the sheet is in. */
	function tagsOf(boardId: string | null): readonly string[] {
		if (boardId === null) return [];
		return lazySheet.parts?.store.sheet.rows.find((row) => row.id === boardId)?.tags ?? [];
	}

	const here = $derived(links.league(id));
	const dropped = $derived(sync ? droppedKinds(sync.scoring_dropped) : []);
	const team = $derived(sync ? myTeam(sync) : undefined);
	/** What every row's numbers are: the season's first, then the preseason board's. */
	const basis = $derived(
		board ? `${board.seasonBasis} Proj and over repl are our preseason board's: ${board.basis}` : ''
	);
</script>

<svelte:head>
	<title>{sync?.name ? `${sync.name} · Commish` : 'Your league · Commish'}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<Shell title="League" active="league">
	{#snippet tail()}
		{#if sync && failure === null}<Quiet href={links.leagueNew()}>Follow another league</Quiet>{/if}
	{/snippet}
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
			<DisplayTitle size="page">{savedName || `Your ${hostWords('ffpc')} league`}</DisplayTitle>
			<p class="sub">Read from FFPC as a member. Sign in to FFPC to read it now.</p>
			<FFPCSignIn
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
	{:else if sync && !board && boardFailed}
		<div class="pad">
			<ProblemLine>Our board can't be read right now. We try again in a minute.</ProblemLine>
		</div>
	{:else if sync && board}
		<main class="league">
			<header class="lead">
				<div class="title">
					<DisplayTitle size="page"
						>{sync.name || `Your ${hostWords(sync.host)} league`}</DisplayTitle
					>
					<p class="sub">
						{#if team}
							{team.name}, {recordWords(team)}, {myPlace(sync)} of {sync.teams.length}.
						{/if}
						<span class="read" role="status">{readLine(sync, now)}</span>
					</p>
				</div>
				<Quiet size="sm" disabled={refreshing} onclick={() => void refresh()}
					>{refreshing ? 'Reading' : `Read ${hostWords(sync.host)} now`}</Quiet
				>
			</header>
			{#if problem}
				<Panel edge="loss" padding="sm"><ProblemLine>{problem}</ProblemLine></Panel>
			{/if}
			{#if sync.host_signed_out}
				<!-- The read line says no one is signed in: the sign-in that mends it sits under it. -->
				<FFPCSignIn onconnected={() => void refresh()} />
			{/if}
			<StandingsStrip teams={sync.teams} me={sync.me} />
			<div class="grid">
				<div class="col">
					<MatchupPanel {sync} {board} {tagsOf} />
					<RosterPanel roster={sync.roster} {board} {tagsOf} {basis} />
				</div>
				<div class="col">
					<WaiverPool rows={poolRows(board, sync)} {tagsOf} {basis} />
					<MovesPanel {sync} />
				</div>
			</div>
			<footer class="foot">
				{#if sync.settings_league_id}
					<Footnote>
						Your league's roster and scoring are saved for mock drafts, under its name in your saved
						leagues. It scores like {presetWords(sync.scoring_like)}.
					</Footnote>
					<Quiet href={links.mockLeague(sync.settings_league_id)} size="sm"
						>Start a mock draft</Quiet
					>
				{:else if sync.settings_note}
					<Footnote>{sync.settings_note}</Footnote>
				{/if}
				{#if dropped.length > 0}
					<Footnote>
						Your league also scores {listWords(dropped)}, which mock drafts do not use yet.
					</Footnote>
				{/if}
				{#if sync.scoring_defaulted.length > 0}
					<Footnote>
						For {plural(sync.scoring_defaulted.length, 'rule')} your league does not state, mock drafts
						use our standard points.
					</Footnote>
				{/if}
				{#if sync.placement.unplaced > 0}
					<Footnote>
						{sync.placement.unplaced} rostered
						{sync.placement.unplaced === 1 ? 'player is' : 'players are'} not on our board, so the waiver
						pool cannot rule them out.
					</Footnote>
				{/if}
			</footer>
		</main>
	{:else}
		<div class="reserve"></div>
	{/if}
</Shell>

<style>
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

	.col {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		min-width: 0;
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
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (max-width: 760px) {
		.league {
			padding: var(--s-3) var(--s-4) var(--s-5);
		}

		.pad {
			padding: var(--s-4) var(--s-4) 0;
		}
	}
</style>
