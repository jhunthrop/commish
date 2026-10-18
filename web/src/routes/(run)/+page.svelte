<script lang="ts">
	import { onMount } from 'svelte';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import RowSheetMark from '#lib/site/RowSheetMark.svelte';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import { lazySheet } from '#lib/site/lazy-sheet.svelte.ts';
	import { links } from '#lib/site/links.ts';
	import { PAGE_VERBS, frontWords, type FrontWords } from '#lib/site/season-words.ts';
	import { verbHref } from '#lib/site/verb-links.ts';
	import { shownRail } from '#lib/site/shown-rail.svelte.ts';
	import Figure from '#lib/ui/Figure.svelte';
	import HeroCard from '#lib/ui/HeroCard.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import Phased from '#lib/ui/Phased.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import { liveStatusClock, sayBoard, type LiveStatus } from '#lib/run/live-status.ts';
	import BasisLine from '#lib/ui/BasisLine.svelte';
	import BoardTable from '#lib/ui/BoardTable.svelte';
	import Row from '#lib/ui/Row.svelte';
	import { boardColumns } from '#lib/ui/board-columns.ts';
	import Verb from '#lib/ui/Verb.svelte';
	import { RAIL_OF_WORD_SET, railInSeason, type WordSet } from '#lib/ui/nav.ts';
	import type { Component } from 'svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Faces in the first screen load eagerly so they count toward the first paint. */
	const EAGER_ROWS = 6;

	const page = $derived(data.page);
	const format = $derived(page.format);
	const headline = $derived(page.record);
	const columns = $derived(
		boardColumns({
			order: 'board',
			tier: true,
			bye: true,
			range: false,
			gap: page.gap,
			season: page.underway,
			action: true
		})
	);

	onMount(() => lazySheet.armOnFirstIntent(window));
	/** The rows' status words as built, said again on the member's clock once the page is live, as
	 * the board says them (review finding 7). */
	let live = $state<LiveStatus | null>(null);
	onMount(() => {
		liveStatusClock(
			page.capture !== null,
			() => import('#lib/run/status-view.ts'),
			(said) => {
				live = said;
			}
		);
	});
	const words = $derived(sayBoard(page, live));

	/** A member who follows a league is sent back to the one selected in the shell; anyone
	 * else to follow one. */
	const leagueId = $derived(siteContext.league?.id ?? null);
	/** The words follow the season the rail shows: in season the followed league is the verb. Both
	 * sets are in the HTML and the root's rail shows one (Phased.svelte), so the hero is right on the
	 * first frame; the document's title follows the rail once the script runs. */
	const wordsOf = (set: WordSet): FrontWords =>
		frontWords(RAIL_OF_WORD_SET[set], { ...format, season: data.run.season }, leagueId !== null);
	const rail = shownRail(() => data.siteRail);
	const documentTitle = $derived(
		frontWords(rail(), { ...format, season: data.run.season }, leagueId !== null).title
	);

	/** In season with a followed league, the week leads the page in place of the board's hero (Lane
	 * 66k). Its band is loaded once it is wanted, so a visitor's front door carries none of it. */
	const weekShown = $derived(railInSeason(rail()) && leagueId !== null);
	let FrontWeek = $state<Component<{ chosen: string | null }> | null>(null);
	$effect(() => {
		if (weekShown && FrontWeek === null) {
			void import('#lib/front/FrontWeek.svelte').then((m) => (FrontWeek = m.default));
		}
	});
</script>

<svelte:head>
	<meta
		name="description"
		content="Our {data.run
			.season} {format.label} board from our own projections, every player's page, your league's lineup, waivers and trades, mock drafts and a cheat sheet."
	/>
</svelte:head>

{#snippet barTitle()}
	<Phased>{#snippet children(set: WordSet)}{wordsOf(set).title}{/snippet}</Phased>
{/snippet}

{#snippet heading()}
	<Phased>{#snippet children(set: WordSet)}{wordsOf(set).heading}{/snippet}</Phased>
{/snippet}

<SiteShell title={documentTitle} heading={barTitle} run={data.run}>
	<main class="front">
		{#if weekShown}
			{#if FrontWeek}<FrontWeek chosen={leagueId} />{:else}<div class="reserve"></div>{/if}
		{:else}
			<HeroCard title={heading}>
				{#snippet meta()}
					<span>{format.basis.join(' · ')}</span>
				{/snippet}
				{#snippet aside()}
					<Phased>
						{#snippet children(set: WordSet)}
							{@const words = wordsOf(set)}
							<Verb href={verbHref(words.verb, leagueId)} size="lg" fill
								>{PAGE_VERBS[words.verb]}</Verb
							>
							{#each words.quiet as verb (verb)}
								<Quiet href={verbHref(verb, leagueId)} size="lg" fill>{PAGE_VERBS[verb]}</Quiet>
							{/each}
						{/snippet}
					</Phased>
				{/snippet}
			</HeroCard>
		{/if}

		<div class="body">
			<section class="top" aria-label="The top of the board">
				<PanelHead
					title="The top of our {format.label} board"
					aside="{page.rows.length} of {page.boardSize}"
					level={2}
				/>
				<BasisLine parts={page.basis} tail={words?.capture ?? null} />
				<div class="rows">
					<BoardTable {columns} label="The top of our {format.label} board">
						{#each page.rows as player, i (player.id)}
							<Row
								{player}
								href={links.player(player.slug)}
								{columns}
								scale={page.scale}
								bye={page.byes[player.team] ?? null}
								eager={i < EAGER_ROWS}
								season={player.season}
								framing={page.framing}
								status={words?.rows[player.id] ?? null}
							>
								{#snippet action()}<RowSheetMark {player} />{/snippet}
							</Row>
						{/each}
					</BoardTable>
				</div>
				<div class="more">
					<Quiet href={links.board(format.id)}>All {page.boardSize} on the board</Quiet>
					<Quiet href={links.adp(format.id)}>ADP</Quiet>
				</div>
			</section>

			<aside class="side" aria-label="Our record">
				<Panel>
					<PanelHead title="Our record" aside={page.record.season.toString()} />
					<Figure value={headline.value} size="lg" caption={headline.caption} />
					<div class="more">
						<Quiet href={links.record()} size="sm">How the board has done</Quiet>
					</div>
				</Panel>
			</aside>
		</div>
	</main>
</SiteShell>

<style>
	.front {
		display: flex;
		flex-direction: column;
		gap: var(--s-5);
		padding: var(--s-5);
	}

	.reserve {
		min-height: 300px;
	}

	.body {
		display: grid;
		grid-template-columns: minmax(0, 1fr) var(--side-w);
		gap: var(--s-5);
		align-items: start;
	}

	.top {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
	}

	.more {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-3);
		margin-top: var(--s-3);
	}

	@media (max-width: 1180px) {
		.body {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (max-width: 760px) {
		.front {
			padding: var(--s-4);
			gap: var(--s-4);
		}
	}
</style>
