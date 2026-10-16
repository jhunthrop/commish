<script lang="ts">
	import { onMount } from 'svelte';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import RowSheetMark from '#lib/site/RowSheetMark.svelte';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import { lazySheet } from '#lib/site/lazy-sheet.svelte.ts';
	import { links } from '#lib/site/links.ts';
	import { PAGE_VERBS, frontWords } from '#lib/site/season-words.ts';
	import { verbHref } from '#lib/site/verb-links.ts';
	import { shownRail } from '#lib/site/shown-rail.svelte.ts';
	import Figure from '#lib/ui/Figure.svelte';
	import Footnote from '#lib/ui/Footnote.svelte';
	import HeroCard from '#lib/ui/HeroCard.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Row from '#lib/ui/Row.svelte';
	import RowHead from '#lib/ui/RowHead.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Faces in the first screen load eagerly so they count toward the first paint. */
	const EAGER_ROWS = 6;

	const page = $derived(data.page);
	const format = $derived(page.format);
	const headline = $derived(page.record);

	onMount(() => lazySheet.armOnFirstIntent(window));

	/** A member who follows a league is sent back to the one selected in the shell; anyone
	 * else to follow one. */
	const leagueId = $derived(siteContext.league?.id ?? null);
	/** The words follow the season the rail shows: in season the followed league is the verb. */
	const rail = shownRail(() => data.siteRail);
	const words = $derived(
		frontWords(rail(), { ...format, season: data.run.season }, leagueId !== null)
	);
</script>

<svelte:head>
	<meta
		name="description"
		content="Our {data.run
			.season} {format.label} board from our own projections, every player's page, your league's lineup, waivers and trades, mock drafts and a cheat sheet."
	/>
</svelte:head>

<SiteShell title={words.title} run={data.run}>
	<main class="front">
		<HeroCard title={words.heading}>
			{#snippet meta()}
				<span>{format.basis.join(' · ')}</span>
			{/snippet}
			{#snippet aside()}
				<Verb href={verbHref(words.verb, leagueId)} size="lg" fill>{PAGE_VERBS[words.verb]}</Verb>
				{#each words.quiet as verb (verb)}
					<Quiet href={verbHref(verb, leagueId)} size="lg" fill>{PAGE_VERBS[verb]}</Quiet>
				{/each}
			{/snippet}
		</HeroCard>

		<div class="body">
			<section class="top" aria-label="The top of the board">
				<PanelHead
					title="The top of our {format.label} board"
					aside="{page.rows.length} of {page.boardSize}"
					level={2}
				/>
				{#if page.seasonLead !== null}<Footnote>{page.seasonLead}</Footnote>{/if}
				<div class="rows">
					<RowHead range={false} action games={page.seasonLead !== null} framing={page.framing} />
					{#each page.rows as player, i (player.id)}
						<Row
							{player}
							href={links.player(player.slug)}
							scale={page.scale}
							showTier
							unit={format.unit}
							range={false}
							eager={i < EAGER_ROWS}
							season={player.season}
							framing={page.framing}
						>
							{#snippet action()}<RowSheetMark {player} />{/snippet}
						</Row>
					{/each}
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
