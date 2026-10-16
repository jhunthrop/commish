<script lang="ts">
	import AbsentFormatView from '#lib/site/AbsentFormatView.svelte';
	import BoardPageView from '#lib/site/BoardPageView.svelte';
	import { links } from '#lib/site/links.ts';
	import { boardWords, type BoardWords } from '#lib/site/season-words.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** The board's name follows the season as the board's own words do (season-words.ts). */
	const wordsFor = (label: string): BoardWords =>
		boardWords(
			data.siteRail,
			{
				season: data.run.season,
				label,
				position: null,
				...(data.view.kind === 'absent' && data.view.page.rosFromWeek !== undefined
					? { rosFromWeek: data.view.page.rosFromWeek }
					: {})
			},
			false
		);
</script>

{#if data.view.kind === 'board'}
	<BoardPageView page={data.view.page} run={data.run} siteRail={data.siteRail} />
{:else}
	<AbsentFormatView
		page={data.view.page}
		run={data.run}
		heading={wordsFor(data.view.page.format.label).heading}
		name={(label: string) => wordsFor(label).title}
		href={links.board}
	/>
{/if}
