<script lang="ts">
	import type { Snippet } from 'svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import PlayerSearch from './PlayerSearch.svelte';
	import type { HeadMarkup } from './head.ts';
	import { runStampText, type RunStamp } from '#lib/run/stamp.ts';

	interface Props {
		/** The document's title, and the bar's unless `heading` says otherwise. */
		title: string;
		/** The bar's title when it differs from the document's: a format page's bar leaves the format
		 * to the league switch beside it ("Board", where the document says "PPR Board"). */
		heading?: string | Snippet;
		/** The page's head but its title, built with the page on the server (Lane 169): its
		 * description, canonical address, share tags and structured data. */
		head: HeadMarkup;
		/** The run every number on the page comes from. */
		run: RunStamp;
		tail?: Snippet;
		children: Snippet;
	}

	let { title, heading, head, run, tail, children }: Props = $props();

	const stamp = $derived(runStampText(run));
</script>

<Shell
	title={heading ?? title}
	head={{ title, markup: head }}
	{stamp}
	{tail}
	weekLabel={run.weekRankings}
>
	{#snippet search()}<PlayerSearch placeholder={run.search} />{/snippet}
	{@render children()}
</Shell>
