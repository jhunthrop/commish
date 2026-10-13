<script lang="ts">
	import type { BoardPage } from '#lib/server/pages/board.ts';
	import type { RunStamp } from '#lib/run/stamp.ts';
	import Verb from '#lib/ui/Verb.svelte';
	import { sectionHref } from '#lib/ui/nav.ts';
	import BoardView from './BoardView.svelte';
	import SiteShell from './SiteShell.svelte';
	import { links } from './links.ts';

	interface Props {
		page: BoardPage;
		run: RunStamp;
	}

	let { page, run }: Props = $props();

	const title = $derived(
		page.position === null
			? `${page.format.label} Board`
			: `${page.position} ${page.format.label} Board`
	);
</script>

<svelte:head>
	<link rel="canonical" href={links.board(page.format.id, page.position)} />
</svelte:head>

<SiteShell {title} active="board" {run}>
	{#snippet tail()}<Verb href={sectionHref('mock')}>Start a mock draft</Verb>{/snippet}
	<BoardView {page} season={run.season} />
</SiteShell>
