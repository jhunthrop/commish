<script lang="ts">
	import { page } from '$app/state';
	import { inSeasonApi, type WaiverPosition } from '#lib/league/inseason/api.ts';
	import InSeasonPage from '#lib/league/inseason/InSeasonPage.svelte';
	import StartScreen from '#lib/league/inseason/StartScreen.svelte';
	import TradeScreen from '#lib/league/inseason/TradeScreen.svelte';
	import WaiverScreen from '#lib/league/inseason/WaiverScreen.svelte';
	import { links } from '#lib/site/links.ts';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import type { PageProps } from './$types';

	/** The rows each screen holds while its answer is read: a lineup with its bench, the first adds,
	 * the first teams' trades. */
	const RESERVE_ROWS = { start: 10, waivers: 10, trades: 8 } as const;

	let { data }: PageProps = $props();
	const id = $derived(page.params.id ?? '');
</script>

{#key `${id}-${data.screen}`}
	{#if data.screen === 'start'}
		<InSeasonPage
			{id}
			screen="start"
			title="Start and sit"
			read={() => inSeasonApi.lineup(id)}
			reserve={RESERVE_ROWS.start}
		>
			{#snippet children(advice, board, host)}<StartScreen {advice} {board} {host} />{/snippet}
		</InSeasonPage>
	{:else if data.screen === 'waivers'}
		<InSeasonPage
			{id}
			screen="waivers"
			title="Waivers"
			read={() => inSeasonApi.waivers(id)}
			reserve={RESERVE_ROWS.waivers}
		>
			{#snippet children(advice, board, host)}
				<WaiverScreen
					{advice}
					{board}
					{host}
					narrow={(position: WaiverPosition) => inSeasonApi.waivers(id, position)}
				/>
			{/snippet}
		</InSeasonPage>
	{:else if data.screen === 'trades'}
		<InSeasonPage
			{id}
			screen="trades"
			title="Trades"
			read={() => inSeasonApi.trades(id)}
			reserve={RESERVE_ROWS.trades}
		>
			{#snippet children(advice, board, host)}
				<TradeScreen
					{advice}
					{board}
					{host}
					narrow={(player: string) => inSeasonApi.trades(id, player)}
				/>
			{/snippet}
		</InSeasonPage>
	{:else}
		<Shell title="League" active="league">
			<div class="pad">
				<EmptyState
					title="Not found"
					line="Your league has its page, start and sit, waivers and trades."
				>
					{#snippet actions()}<Quiet href={links.league(id)}>Your league</Quiet>{/snippet}
				</EmptyState>
			</div>
		</Shell>
	{/if}
{/key}

<style>
	.pad {
		padding: var(--s-4) var(--s-5) 0;
	}
</style>
