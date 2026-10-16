<script lang="ts">
	import { siteContext } from '#lib/context/context.svelte.ts';
	import type { BoardPage } from '#lib/server/pages/board.ts';
	import type { RunStamp } from '#lib/run/stamp.ts';
	import Verb from '#lib/ui/Verb.svelte';
	import type { RailKey } from '#lib/ui/nav.ts';
	import BoardView from './BoardView.svelte';
	import SiteShell from './SiteShell.svelte';
	import { links } from './links.ts';
	import { PAGE_VERBS, boardWords } from './season-words.ts';
	import { shownRail } from './shown-rail.svelte.ts';
	import { verbHref } from './verb-links.ts';

	interface Props {
		page: BoardPage;
		run: RunStamp;
		/** The site's rail at build: the words follow it until the context says otherwise. */
		siteRail: RailKey;
	}

	let { page, run, siteRail }: Props = $props();

	const leagueId = $derived(siteContext.league?.id ?? null);
	/** The bar takes the rail's word for the board and leaves the format to the league switch beside
	 * it; the document names it. In season the one verb follows your league (season-words.ts). */
	const rail = shownRail(() => siteRail);
	const words = $derived(
		boardWords(
			rail(),
			{ ...page.format, season: run.season, position: page.position },
			leagueId !== null
		)
	);
</script>

<svelte:head>
	<link rel="canonical" href={links.board(page.format.id, page.position)} />
</svelte:head>

<SiteShell title={words.title} heading={words.bar} {run}>
	{#snippet tail()}<Verb href={verbHref(words.verb, leagueId)}>{PAGE_VERBS[words.verb]}</Verb
		>{/snippet}
	<BoardView {page} heading={words.heading} />
</SiteShell>
