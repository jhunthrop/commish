<script lang="ts">
	import CallPanel from '#lib/ui/CallPanel.svelte';
	import type { CallAction } from '#lib/types/room.ts';
	import { type CallView, chanceHead } from './call.ts';

	interface Props {
		view: CallView;
		action: CallAction;
		/** Set while the next turn's call is on its way: the panel holds this frame as a skeleton. */
		reading?: string;
	}

	let { view, action, reading }: Props = $props();

	const tag = $derived(
		view.conditional ? `If the board holds to ${view.forLabel}` : `Our call at ${view.forLabel}`
	);
</script>

<CallPanel
	{tag}
	rows={view.rows}
	chanceHead={chanceHead(view)}
	{action}
	waiting={view.conditional}
	{reading}
/>
