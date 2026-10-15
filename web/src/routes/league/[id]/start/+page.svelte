<script lang="ts">
	import { page } from '$app/state';
	import { inSeasonApi } from '#lib/league/inseason/api.ts';
	import InSeasonPage from '#lib/league/inseason/InSeasonPage.svelte';
	import StartScreen from '#lib/league/inseason/StartScreen.svelte';

	/** A lineup's slots and its bench: the rows held while it is read. */
	const RESERVE_ROWS = 10;
	const id = $derived(page.params.id ?? '');
</script>

{#key id}
	<InSeasonPage
		{id}
		screen="start"
		title="Start and sit"
		read={() => inSeasonApi.lineup(id)}
		reserve={RESERVE_ROWS}
	>
		{#snippet children(advice, board, host)}<StartScreen {advice} {board} {host} />{/snippet}
	</InSeasonPage>
{/key}
