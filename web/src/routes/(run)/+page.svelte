<script lang="ts">
	import { onMount } from 'svelte';
	import { recordHeadline } from '#lib/run/record.ts';
	import { runStampText } from '#lib/run/stamp.ts';
	import SheetAdd from '#lib/site/SheetAdd.svelte';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import { lazySheet } from '#lib/site/lazy-sheet.svelte.ts';
	import { links } from '#lib/site/links.ts';
	import Figure from '#lib/ui/Figure.svelte';
	import HeroCard from '#lib/ui/HeroCard.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Row from '#lib/ui/Row.svelte';
	import RowHead from '#lib/ui/RowHead.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { sectionHref } from '#lib/ui/nav.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Faces in the first screen load eagerly so they count toward the first paint. */
	const EAGER_ROWS = 6;

	const page = $derived(data.page);
	const format = $derived(page.format);
	const headline = $derived(recordHeadline(page.record));

	onMount(() => lazySheet.armOnFirstIntent(window));
</script>

<svelte:head>
	<meta
		name="description"
		content="Our {data.run
			.season} {format.label} board from our own projections, every player's page, mock drafts and a cheat sheet."
	/>
</svelte:head>

<SiteShell title="Draft prep" run={data.run}>
	<main class="front">
		<HeroCard title="Our {data.run.season} board, ready for your draft">
			{#snippet meta()}
				<span>{format.basis.join(' · ')} · {runStampText(data.run)}</span>
			{/snippet}
			{#snippet aside()}
				<Verb href={sectionHref('mock')} size="lg" fill>Start a mock draft</Verb>
				<Quiet href={sectionHref('sheet')} size="lg" fill>Build your cheat sheet</Quiet>
			{/snippet}
		</HeroCard>

		<div class="body">
			<section class="top" aria-label="The top of the board">
				<PanelHead
					title="The top of our {format.label} board"
					aside="{page.rows.length} of {page.boardSize}"
					level={2}
				/>
				<div class="rows">
					<RowHead range={false} action />
					{#each page.rows as player, i (player.id)}
						<Row
							{player}
							href={links.player(player.slug)}
							scale={page.scale}
							showTier
							unit={format.unit}
							range={false}
							eager={i < EAGER_ROWS}
						>
							{#snippet action()}<SheetAdd {player} variant="row" />{/snippet}
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
