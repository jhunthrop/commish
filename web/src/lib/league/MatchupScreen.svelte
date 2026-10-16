<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import { gameWeek } from '#lib/api/games.ts';
	import { clubGame, gameFactsLine, toBePlayed, type GameWeek } from '#lib/format/game-facts.ts';
	import { gameLine, runClub, type Kickoffs } from '#lib/run/kickoffs.ts';
	import { lazySheet } from '#lib/site/lazy-sheet.svelte.ts';
	import { leagueApi, type LeagueSync } from './api.ts';
	import { loadBoard, type LeagueBoard } from './board.ts';
	import InSeasonPage from './inseason/InSeasonPage.svelte';
	import { TAB_LABELS } from './inseason/words.ts';
	import MatchupPanel from './MatchupPanel.svelte';
	import { sheetTags } from './sheet-tags.ts';

	/** A followed league's Matchup screen (spec 2026-10-16 §3): this week's game with both teams
	 * named, the score so far, each starter's game with its kickoff on the member's clock and its
	 * facts (the expected score, the margin, the roof and the kickoff weather, Lane 66a), and the
	 * panel's honesty lines. The league's read, our board for the faces and places, the run's
	 * kickoffs and the week's games; read on open and once a minute, as the other screens are. */
	interface Props {
		id: string;
	}

	let { id }: Props = $props();

	/** How many rows the screen holds while it is read: a lineup's starters. */
	const RESERVE_ROWS = 9;

	interface Week {
		sync: LeagueSync;
		board: LeagueBoard;
		kickoffs: Kickoffs;
		/** The week's games with their facts, null when the read failed: the rows stand without them. */
		games: GameWeek | null;
		read_at: string;
	}

	/** The board and the kickoffs are the run's own files: read once, the board again only when the
	 * league reads on another. */
	let board: Promise<LeagueBoard> | null = null;
	let boardFormat: LeagueSync['board_format'] | null = null;
	let kickoffs: Promise<Kickoffs> | null = null;

	async function readKickoffs(): Promise<Kickoffs> {
		const response = await fetch(resolve('/data/kickoffs.json'));
		if (response.ok) return response.json<Kickoffs>();
		// The rows go without their games: the one record of why, for whoever has the console open.
		// eslint-disable-next-line no-console -- no user-facing text: the screen stands without kickoffs
		console.warn('Matchup: kickoffs', response.status);
		return {};
	}

	async function read(): Promise<Week> {
		const sync = await leagueApi.sync(id);
		if (board === null || boardFormat !== sync.board_format) {
			boardFormat = sync.board_format;
			board = loadBoard(sync.board_format, sync.byes);
		}
		kickoffs ??= readKickoffs().catch((error: unknown) => {
			// eslint-disable-next-line no-console -- no user-facing text: the screen stands without kickoffs
			console.warn('Matchup: kickoffs', error);
			return {};
		});
		const week = sync.matchup?.week;
		const games =
			week === undefined
				? null
				: await gameWeek(week).catch((error: unknown) => {
						// eslint-disable-next-line no-console -- no user-facing text: the rows stand without their facts
						console.warn('Matchup: game facts', error);
						return null;
					});
		return { sync, board: await board, kickoffs: await kickoffs, games, read_at: sync.read_at };
	}

	/** A starter's game facts this week, null from kickoff or when nothing is held. */
	function factsOf(games: GameWeek | null, team: string): string | null {
		const game = games === null ? null : clubGame(games, runClub(team));
		return game === null || !toBePlayed(game) ? null : gameFactsLine(game);
	}

	onMount(() => void lazySheet.load());

	/** The league's phase basis when it has no game this week: a league drafted before the season
	 * says the day the season starts. */
	const basis = $derived(siteContext.leagues.find((l) => l.id === id)?.phase_basis ?? '');
</script>

<InSeasonPage
	{id}
	screen="matchup"
	title={TAB_LABELS.matchup}
	stamp={() => ''}
	{read}
	reserve={RESERVE_ROWS}
>
	{#snippet children(week: Week)}
		<MatchupPanel
			sync={week.sync}
			board={week.board}
			tagsOf={sheetTags}
			now={new Date(week.read_at)}
			gameOf={(team: string, number: number) => gameLine(week.kickoffs, team, number)}
			factsOf={(team: string) => factsOf(week.games, team)}
		/>
		{#if week.sync.matchup === null && basis !== ''}<p class="basis">{basis}</p>{/if}
	{/snippet}
</InSeasonPage>

<style>
	.basis {
		margin: 0;
		color: var(--ink-2);
	}
</style>
