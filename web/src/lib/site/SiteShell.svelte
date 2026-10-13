<script lang="ts">
	import type { Snippet } from 'svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import type { Section } from '#lib/ui/nav.ts';
	import PlayerSearch from './PlayerSearch.svelte';
	import { runStampText, type RunStamp } from '#lib/run/stamp.ts';

	interface Props {
		title: string;
		active: Section | null;
		/** The run every number on the page comes from. */
		run: RunStamp;
		tail?: Snippet;
		children: Snippet;
	}

	let { title, active, run, tail, children }: Props = $props();

	const stamp = $derived(runStampText(run));
</script>

<svelte:head>
	<title>{title} · Commish</title>
</svelte:head>

<Shell {title} {stamp} {active} {tail}>
	{#snippet search()}<PlayerSearch players={run.players} />{/snippet}
	{@render children()}
</Shell>
