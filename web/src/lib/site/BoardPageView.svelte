<script lang="ts">
	import { siteContext } from '#lib/context/context.svelte.ts';
	import type { BoardPage } from '#lib/server/pages/board.ts';
	import type { RunStamp } from '#lib/run/stamp.ts';
	import Phased from '#lib/ui/Phased.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { RAIL_OF_WORD_SET, type RailKey, type WordSet } from '#lib/ui/nav.ts';
	import BoardView from './BoardView.svelte';
	import SiteShell from './SiteShell.svelte';
	import { links } from './links.ts';
	import { weekBoardWords } from '#lib/order/week-head.ts';
	import { PAGE_VERBS, boardWords, type BoardWords } from './season-words.ts';
	import { shownRail } from './shown-rail.svelte.ts';
	import { verbHref } from './verb-links.ts';

	interface Props {
		page: BoardPage;
		run: RunStamp;
		/** The site's rail at build: the document's title follows it until the context says otherwise. */
		siteRail: RailKey;
	}

	let { page, run, siteRail }: Props = $props();

	const leagueId = $derived(siteContext.league?.id ?? null);
	/** The bar takes the rail's word for the board and leaves the format to the league switch beside
	 * it; the document names it. In season the one verb follows your league (season-words.ts). Both
	 * sets of words are in the HTML and the root's rail shows one (Phased.svelte), so the bar is right
	 * on the first frame; the document's title follows the rail once the script runs. */
	const wordsAt = (rail: RailKey): BoardWords => {
		const board = { ...page.format, season: run.season, position: page.position };
		// In season the kickers' and defenses' tabs are this week's (Lane 66w).
		return weekBoardWords(boardWords(rail, board, leagueId !== null), rail, board);
	};
	const wordsOf = (set: WordSet): BoardWords => wordsAt(RAIL_OF_WORD_SET[set]);
	const rail = shownRail(() => siteRail);
	const documentTitle = $derived(wordsAt(rail()).title);
</script>

<svelte:head>
	<link rel="canonical" href={links.board(page.format.id, page.position)} />
</svelte:head>

{#snippet barTitle()}
	<Phased>{#snippet children(set: WordSet)}{wordsOf(set).bar}{/snippet}</Phased>
{/snippet}

{#snippet heading()}
	<Phased>{#snippet children(set: WordSet)}{wordsOf(set).heading}{/snippet}</Phased>
{/snippet}

<SiteShell title={documentTitle} heading={barTitle} {run}>
	{#snippet tail()}
		<Phased>
			{#snippet children(set: WordSet)}
				{@const verb = wordsOf(set).verb}
				<Verb href={verbHref(verb, leagueId)}>{PAGE_VERBS[verb]}</Verb>
			{/snippet}
		</Phased>
	{/snippet}
	<BoardView {page} {heading} />
</SiteShell>
