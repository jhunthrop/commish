<script lang="ts">
	import { adpWords } from '#lib/format/draft.ts';
	import CallPanel from '#lib/ui/CallPanel.svelte';
	import type { CallAction } from '#lib/types/room.ts';
	import { type CallView, runnerWords } from './call.ts';

	interface Props {
		view: CallView;
		/** The pick the ADP sentence is read against. */
		pickNumber: number;
		action: CallAction;
	}

	let { view, pickNumber, action }: Props = $props();

	const tag = $derived(
		view.conditional ? `If the board holds to ${view.forLabel}` : `Our call at ${view.forLabel}`
	);
	const oddsLabel = $derived(
		view.conditional
			? `chance he reaches your pick at ${view.forLabel}`
			: view.nextLabel === null
				? 'your last pick'
				: `chance he is still there at ${view.nextLabel}`
	);
	const runner = $derived(runnerWords(view));
</script>

<CallPanel
	{tag}
	player={view.player}
	vor={view.player.vor ?? 0}
	adp={adpWords(view.player.adp, pickNumber)}
	odds={view.odds ?? 0}
	{oddsLabel}
	{action}
	waiting={view.conditional}
>
	{#snippet reason()}
		{#if runner}
			<b>{runner.name}</b> {runner.rest}
		{:else if view.why}
			{view.why}
		{:else if view.nextLabel === null && !view.conditional}
			This is your last pick.
		{:else}
			<b>{view.player.name}</b> has the most over replacement left for your roster.
		{/if}
	{/snippet}
</CallPanel>
