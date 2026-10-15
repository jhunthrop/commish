<script lang="ts">
	import { page } from '$app/state';
	import { inSeasonApi } from '#lib/league/inseason/api.ts';
	import InSeasonPage from '#lib/league/inseason/InSeasonPage.svelte';
	import TradeScreen from '#lib/league/inseason/TradeScreen.svelte';

	/** The first teams' trades: the rows held while they are read. */
	const RESERVE_ROWS = 8;
	const id = $derived(page.params.id ?? '');
</script>

{#key id}
	<InSeasonPage
		{id}
		screen="trades"
		title="Trades"
		read={() => inSeasonApi.trades(id)}
		reserve={RESERVE_ROWS}
	>
		{#snippet children(advice, board, host)}<TradeScreen {advice} {board} {host} />{/snippet}
	</InSeasonPage>
{/key}
