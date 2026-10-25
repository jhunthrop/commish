<script lang="ts">
	import { onMount } from 'svelte';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import { lazySheet } from '#lib/site/lazy-sheet.svelte.ts';
	import {
		ApiError,
		leagueApi,
		type LeagueHost,
		type LeagueMatchup,
		type LeagueSync
	} from './api.ts';
	import { otherGame } from './box/game.ts';
	import { inSeasonApi, type MatchupBox } from './inseason/api.ts';
	import InSeasonPage from './inseason/InSeasonPage.svelte';
	import { SCREEN_TITLES } from './inseason/words.ts';
	import MatchupPanel from './MatchupPanel.svelte';
	import { tabHref } from './inseason/tabs.ts';

	/** A followed league's Matchup screen (spec 2026-10-16 §3, Lane 66d): this week's game as a box
	 * score. The league's read names the teams and keeps the score; the API's box answer gives every
	 * player's row (his game and its facts, this week's projection, his points so far). Both read on
	 * open and once a minute, as the other screens are. A league the box cannot answer for (no saved
	 * scoring, no current week) keeps the read's starters and their points. With a roster (a score
	 * bug of another team's, Lane 204) the box is that roster's game, its score the scoreboard's; an
	 * API that draws only the member's game answers theirs, which the screen then draws. */
	interface Props {
		id: string;
		/** Another team's game by its first side's roster (?roster=), null for the member's own. */
		roster?: number | null;
	}

	let { id, roster = null }: Props = $props();

	/** How many rows the screen holds while it is read: a lineup's starters. */
	const RESERVE_ROWS = 9;

	interface Week {
		sync: LeagueSync;
		box: MatchupBox | null;
		/** Another team's game as the head draws it, null for the member's own. */
		game: LeagueMatchup | null;
		read_at: string;
	}

	/** The API's refusals the screen stands without the box for: no saved scoring, no current week,
	 * a team missing from the read. Signed out and a server failure fail the read, as the league's do. */
	const STANDS_WITHOUT = new Set([404, 409, 422]);

	/** An answer, null when the API refuses it for this league. */
	async function orNone<T>(answer: Promise<T>): Promise<T | null> {
		try {
			return await answer;
		} catch (error) {
			if (error instanceof ApiError && STANDS_WITHOUT.has(error.status)) return null;
			throw error;
		}
	}

	// The screen is created per game ({#key} in the route), so its roster is fixed for its life.
	// svelte-ignore state_referenced_locally
	const asked = roster;

	async function read(): Promise<Week> {
		const [sync, box, board] = await Promise.all([
			leagueApi.sync(id),
			orNone(inSeasonApi.matchup(id, asked)),
			// Another team's score is the scoreboard's, as the League page's bug draws it.
			asked === null ? null : orNone(inSeasonApi.scoreboard(id))
		]);
		return { sync, box, game: otherGame(box, board), read_at: sync.read_at };
	}

	// Your sheet's tags mark your own rows once the sheet is in (review L7).
	onMount(() => void lazySheet.load());

	/** The league's phase basis when it has no game this week: a league drafted before the season
	 * says the day the season starts. */
	const basis = $derived(siteContext.leagues.find((l) => l.id === id)?.phase_basis ?? '');
</script>

<InSeasonPage
	{id}
	screen="matchup"
	title={SCREEN_TITLES.matchup}
	stamp={() => ''}
	{read}
	reserve={RESERVE_ROWS}
>
	{#snippet children(week: Week, host: LeagueHost, clock: number)}
		<MatchupPanel
			sync={week.sync}
			box={week.box}
			game={week.game}
			yourGame={tabHref('matchup', id)}
			now={new Date(week.read_at)}
			live={{ host, clock }}
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
