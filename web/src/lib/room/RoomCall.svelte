<script lang="ts">
	import { adpWords, lastName, oddsWords } from '#lib/format/draft.ts';
	import { signed } from '#lib/format/number.ts';
	import CallPanel from '#lib/ui/CallPanel.svelte';
	import type { CallAction } from '#lib/types/room.ts';
	import type { CallView } from './call.ts';

	interface Props {
		view: CallView;
		/** The pick the ADP sentence is read against. */
		pickNumber: number;
		action: CallAction;
	}

	let { view, pickNumber, action }: Props = $props();

	/** "Is not" is said only when the odds back it. */
	const UNLIKELY = 0.5;

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
		{#if view.runner && view.runnerOdds !== null && view.conditional}
			<b>{view.runner.name}</b> has more over replacement at {signed(view.runner.vor ?? 0)}, but he
			reaches {view.forLabel} only {oddsWords(view.runnerOdds)} of the time.
		{:else if view.runner && view.runnerOdds !== null && view.nextLabel !== null}
			<b>{view.runner.name}</b> has more over replacement at {signed(view.runner.vor ?? 0)}, but he
			is still there at {view.nextLabel}
			{oddsWords(view.runnerOdds)} of the time.
			{#if (view.odds ?? 1) < UNLIKELY}
				{lastName(view.player.name)} is not.
			{:else}
				{lastName(view.player.name)} is there {oddsWords(view.odds ?? 0)} of the time.
			{/if}
		{:else if view.why}
			{view.why}
		{:else if view.nextLabel === null}
			This is your last pick.
		{:else}
			<b>{view.player.name}</b> has the most over replacement left for your roster.
		{/if}
	{/snippet}
</CallPanel>
