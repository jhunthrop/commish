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
	import { LINES, TAB_LABELS, refreshedWords } from '#lib/league/inseason/words.ts';
	import type { AdviceHead } from '#lib/league/inseason/api.ts';
	import { sectionHref } from '#lib/ui/nav.ts';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import type { PageProps } from './$types';

	/** The rows each screen holds while its answer is read: a lineup with its bench, the first adds,
	 * the first teams' trades. */
	const RESERVE_ROWS = { start: 10, waivers: 10, trades: 8 } as const;

	/** What an advice screen was read from: the order and when it was refreshed. */
	const ordered = (advice: AdviceHead): string =>
		refreshedWords(advice.order_basis, advice.refreshed);

	let { data }: PageProps = $props();
	const id = $derived(page.params.id ?? '');
</script>

{#key `${id}-${data.screen}`}
	{#if data.screen === 'start'}
		<InSeasonPage
			{id}
			screen="start"
			title={TAB_LABELS.start}
			stamp={ordered}
			read={() => inSeasonApi.lineup(id)}
			reserve={RESERVE_ROWS.start}
		>
			{#snippet children(advice, host, reread)}
				<StartScreen
					{advice}
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
			title={TAB_LABELS.waivers}
			stamp={ordered}
			read={() => inSeasonApi.waivers(id)}
			reserve={RESERVE_ROWS.waivers}
		>
			{#snippet children(advice, host, reread)}
				<WaiverScreen
					{advice}
					{host}
					narrow={(position: WaiverPosition) => inSeasonApi.waivers(id, position)}
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
			title={TAB_LABELS.trades}
			stamp={ordered}
			read={() => inSeasonApi.trades(id)}
			reserve={RESERVE_ROWS.trades}
		>
			{#snippet children(advice, host)}
				<TradeScreen
					{advice}
					{host}
					narrow={(player: string) => inSeasonApi.trades(id, player)}
					check={(trade: TradeCheckInput) => inSeasonApi.checkTrade(id, trade)}
				/>
			{/snippet}
		</InSeasonPage>
	{:else if data.screen === 'matchup'}
		<MatchupScreen {id} />
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
