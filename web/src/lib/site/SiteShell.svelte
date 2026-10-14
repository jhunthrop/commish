<script lang="ts">
	import type { Snippet } from 'svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import PlayerSearch from './PlayerSearch.svelte';
	import { runStampText, type RunStamp } from '#lib/run/stamp.ts';

	interface Props {
		/** The document's title, and the bar's unless `heading` says otherwise. */
		title: string;
		/** The bar's title when it differs from the document's: a format page's bar leaves the format
		 * to the league switch beside it ("Board", where the document says "PPR Board"). */
		heading?: string;
		/** The run every number on the page comes from. */
		run: RunStamp;
		tail?: Snippet;
		children: Snippet;
	}

	let { title, heading, run, tail, children }: Props = $props();

	const stamp = $derived(runStampText(run));
</script>

<svelte:head>
	<title>{title} · Commish</title>
</svelte:head>

<Shell title={heading ?? title} {stamp} {tail}>
	{#snippet search()}<PlayerSearch players={run.players} />{/snippet}
	{@render children()}
</Shell>
