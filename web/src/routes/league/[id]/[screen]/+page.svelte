<script lang="ts">
	import { page } from '$app/state';
	import {
		inSeasonApi,
		type HostMoveInput,
		type TradeCheckInput,
		type WaiverPosition
	} from '#lib/league/inseason/api.ts';
	import InSeasonPage from '#lib/league/inseason/InSeasonPage.svelte';
	import StartScreen from '#lib/league/inseason/StartScreen.svelte';
	import TradeScreen from '#lib/league/inseason/TradeScreen.svelte';
	import WaiverScreen from '#lib/league/inseason/WaiverScreen.svelte';
	import MatchupScreen from '#lib/league/MatchupScreen.svelte';
	import { LINES, SCREEN_TITLES, refreshedWords } from '#lib/league/inseason/words.ts';
	import type { AdviceHead } from '#lib/league/inseason/api.ts';
	import { ASKED_PARAM } from '#lib/league/box/asked.ts';
	import { gameRoster } from '#lib/league/box/game.ts';
	import { sectionHref } from '#lib/ui/nav.ts';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import { standingWords } from '#lib/league/model.ts';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import type { PageProps } from './$types';

	/** The rows each screen holds while its answer is read: a lineup with its bench, the first adds,
	 * the first teams' trades. */
	const RESERVE_ROWS = { start: 10, waivers: 10, trades: 8 } as const;

	/** The player a link named (?player=): Waivers keeps his row past its first page (review 66j N2). */
	const asked = $derived(page.url.searchParams.get(ASKED_PARAM));
	/** The game the Matchup draws (?roster=, Lane 204): another team's, null for the member's own. */
	const roster = $derived(gameRoster(page.url.searchParams));

	/** What an advice screen was read from: the order and when it was refreshed. */
	const ordered = (advice: AdviceHead): string =>
		refreshedWords(advice.order_basis, advice.refreshed);

	let { data }: PageProps = $props();
	const id = $derived(page.params.id ?? '');
	/** The followed league as the switch lists it: the member's team and standing for the Trades
	 * screen's builder (Lane 66g). */
	const league = $derived(siteContext.leagues.find((l) => l.id === id) ?? null);
</script>

<!-- The Matchup's game is part of the key (Lane 204): moving between games, back or forward, draws
     each game's own reads, never the last game's box. -->
{#key `${id}-${data.screen}-${data.screen === 'matchup' ? String(roster) : ''}`}
	{#if data.screen === 'start'}
		<InSeasonPage
			{id}
			screen="start"
			title={SCREEN_TITLES.start}
			stamp={ordered}
			read={() => inSeasonApi.lineup(id)}
			reserve={RESERVE_ROWS.start}
		>
			{#snippet children(advice, host, now, reread)}
				<StartScreen
					{advice}
					{now}
					{host}
					plan={(move: HostMoveInput) => inSeasonApi.planMove(id, move)}
					make={(move: HostMoveInput, confirm: string) => inSeasonApi.makeMove(id, move, confirm)}
					{reread}
				/>
			{/snippet}
		</InSeasonPage>
	{:else if data.screen === 'waivers'}
		<InSeasonPage
			{id}
			screen="waivers"
			title={SCREEN_TITLES.waivers}
			stamp={ordered}
			read={() => inSeasonApi.waivers(id, null, asked)}
			reserve={RESERVE_ROWS.waivers}
		>
			{#snippet children(advice, host, now, reread)}
				<WaiverScreen
					{advice}
					{now}
					{host}
					narrow={(position: WaiverPosition) => inSeasonApi.waivers(id, position, asked)}
					plan={(move: HostMoveInput) => inSeasonApi.planMove(id, move)}
					make={(move: HostMoveInput, confirm: string) => inSeasonApi.makeMove(id, move, confirm)}
					{reread}
				/>
			{/snippet}
		</InSeasonPage>
	{:else if data.screen === 'trades'}
		<InSeasonPage
			{id}
			screen="trades"
			title={SCREEN_TITLES.trades}
			stamp={ordered}
			read={() => inSeasonApi.trades(id)}
			reserve={RESERVE_ROWS.trades}
			oneLine
		>
			{#snippet children(advice, host, now)}
				<TradeScreen
					{advice}
					{now}
					{host}
					me={{ name: league?.team_name ?? '', aside: league ? standingWords(league) : '' }}
					check={(trade: TradeCheckInput) => inSeasonApi.checkTrade(id, trade)}
				/>
			{/snippet}
		</InSeasonPage>
	{:else if data.screen === 'matchup'}
		<MatchupScreen {id} {roster} />
	{:else}
		<!-- The site's not-found in its own words. Drawn here, not by importing the root error page,
		     which would split that page into another file every page loads. -->
		<Shell title={LINES.notFoundBar} active={null}>
			<div class="pad">
				<EmptyState title={LINES.notFound} line={LINES.notFoundLine}>
					{#snippet actions()}<Verb href={sectionHref('board')}>{LINES.toBoard}</Verb>{/snippet}
				</EmptyState>
			</div>
		</Shell>
	{/if}
{/key}

<style>
	.pad {
		padding: var(--s-6) var(--s-5);
	}

	@media (max-width: 760px) {
		.pad {
			padding: var(--s-5) var(--s-4);
		}
	}
</style>
