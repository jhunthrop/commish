<script lang="ts">
	import { onMount } from 'svelte';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import { lazySheet } from '#lib/site/lazy-sheet.svelte.ts';
	import { ApiError, leagueApi, type LeagueSync } from './api.ts';
	import { inSeasonApi, type MatchupBox } from './inseason/api.ts';
	import InSeasonPage from './inseason/InSeasonPage.svelte';
	import { TAB_LABELS } from './inseason/words.ts';
	import MatchupPanel from './MatchupPanel.svelte';

	/** A followed league's Matchup screen (spec 2026-10-16 §3, Lane 66d): this week's game as a box
	 * score. The league's read names the teams and keeps the score; the API's box answer gives every
	 * player's row (his game and its facts, this week's projection, his points so far). Both read on
	 * open and once a minute, as the other screens are. A league the box cannot answer for (no saved
	 * scoring, no current week) keeps the read's starters and their points. */
	interface Props {
		id: string;
	}

	let { id }: Props = $props();

	/** How many rows the screen holds while it is read: a lineup's starters. */
	const RESERVE_ROWS = 9;

	interface Week {
		sync: LeagueSync;
		box: MatchupBox | null;
		read_at: string;
	}

	/** The API's refusals the screen stands without the box for: no saved scoring, no current week,
	 * a team missing from the read. Signed out and a server failure fail the read, as the league's do. */
	const STANDS_WITHOUT = new Set([404, 409, 422]);

	/** The box answer, null when the API refuses it for this league. */
	async function readBox(): Promise<MatchupBox | null> {
		try {
			return await inSeasonApi.matchup(id);
		} catch (error) {
			if (error instanceof ApiError && STANDS_WITHOUT.has(error.status)) return null;
			throw error;
		}
	}

	async function read(): Promise<Week> {
		const [sync, box] = await Promise.all([leagueApi.sync(id), readBox()]);
		return { sync, box, read_at: sync.read_at };
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
	title={TAB_LABELS.matchup}
	stamp={() => ''}
	{read}
	reserve={RESERVE_ROWS}
>
	{#snippet children(week: Week)}
		<MatchupPanel sync={week.sync} box={week.box} now={new Date(week.read_at)} />
		{#if week.sync.matchup === null && basis !== ''}<p class="basis">{basis}</p>{/if}
	{/snippet}
</InSeasonPage>

<style>
	.basis {
		margin: 0;
		color: var(--ink-2);
	}
</style>
