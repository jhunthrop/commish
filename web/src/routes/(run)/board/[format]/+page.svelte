<script lang="ts">
	import AbsentFormatView from '#lib/site/AbsentFormatView.svelte';
	import BoardPageView from '#lib/site/BoardPageView.svelte';
	import { links } from '#lib/site/links.ts';
	import { boardWords } from '#lib/site/season-words.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** The board's name follows the season, as the board's own bar does (season-words.ts). */
	const noun = $derived(
		boardWords(data.siteRail, { season: data.run.season, label: '', position: null }, false).bar
	);
</script>

{#if data.view.kind === 'board'}
	<BoardPageView page={data.view.page} run={data.run} siteRail={data.siteRail} />
{:else}
	<AbsentFormatView page={data.view.page} run={data.run} {noun} href={links.board} />
{/if}
