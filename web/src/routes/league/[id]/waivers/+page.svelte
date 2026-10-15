<script lang="ts">
	import { page } from '$app/state';
	import { inSeasonApi } from '#lib/league/inseason/api.ts';
	import InSeasonPage from '#lib/league/inseason/InSeasonPage.svelte';
	import WaiverScreen from '#lib/league/inseason/WaiverScreen.svelte';

	/** The adds' first screen: the rows held while they are read. */
	const RESERVE_ROWS = 10;
	const id = $derived(page.params.id ?? '');
</script>

{#key id}
	<InSeasonPage
		{id}
		screen="waivers"
		title="Waivers"
		read={() => inSeasonApi.waivers(id)}
		reserve={RESERVE_ROWS}
	>
		{#snippet children(advice, board, host)}<WaiverScreen {advice} {board} {host} />{/snippet}
	</InSeasonPage>
{/key}
