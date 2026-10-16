<script lang="ts">
	import { onMount } from 'svelte';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import { followFormat } from '#lib/context/follow.svelte.ts';
	import { windowLabel } from '#lib/format/date.ts';
	import { plural } from '#lib/format/number.ts';
	import { rangeScale } from '#lib/run/derive.ts';
	import { rowFraming } from '#lib/run/row-framing.ts';
	import { liveStatusClock, sayBoard, type LiveStatus } from '#lib/run/live-status.ts';
	import type { AdpPage } from '#lib/server/pages/adp.ts';
	import type { RunStamp } from '#lib/run/stamp.ts';
	import BasisList from '#lib/ui/BasisList.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Row from '#lib/ui/Row.svelte';
	import RowHead from '#lib/ui/RowHead.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { sectionHref } from '#lib/ui/nav.ts';
	import RowSheetMark from './RowSheetMark.svelte';
	import SiteShell from './SiteShell.svelte';
	import { lazySheet } from './lazy-sheet.svelte.ts';
	import { links } from './links.ts';

	interface Props {
		page: AdpPage;
		run: RunStamp;
	}

	let { page, run }: Props = $props();

	/** How every row frames his rank against the drafts, the board's rule (run/row-framing.ts). */
	const framing = $derived(rowFraming(page.format));

	/** Faces in the first screen load eagerly so they count toward the first paint. */
	const EAGER_ROWS = 8;

	onMount(() => {
		lazySheet.armOnFirstIntent(window);
		siteContext.wantHeld();
	});
	/** The rows' status words as built, said again on the member's clock once the page is live. */
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
	// ADP opens in the context's format and turns with the switch.
	followFormat(
		() => page.format.id,
		() => run.formats,
		(id) => links.adp(id)
	);

	const scale = $derived(rangeScale(page.rows));
	const sourceNames = $derived(
		page.sources.map((source) => `${source.drafts}, ${windowLabel(source.window)}`)
	);
	const sourceTerms = $derived(
		page.sources.map((source) => ({
			term: source.drafts,
			means: `Averaged from ${windowLabel(source.window)}`
		}))
	);
</script>

<svelte:head>
	<link rel="canonical" href={links.adp(page.format.id)} />
</svelte:head>

<SiteShell title="{page.format.label} ADP" heading="ADP" {run}>
	{#snippet tail()}<Verb href={sectionHref('mock')}>Start a mock draft</Verb>{/snippet}
	<main class="adp">
		<div class="content">
			<div class="lead">
				<PageHead
					title="{run.season} ADP"
					lead="{sourceNames.join(' and ')} · against our {page.format
						.label} board · earliest pick first"
				/>
			</div>
			<section aria-label="{page.format.label} ADP">
				<RowHead action order="adp" {framing} />
				{#each page.rows as player, i (player.id)}
					<Row
						{player}
						href={links.player(player.slug)}
						{scale}
						showTier
						unit={page.format.unit}
						order="adp"
						{framing}
						eager={i < EAGER_ROWS}
						held={siteContext.held?.mark(player.id) ?? null}
						status={words?.rows[player.id] ?? null}
					>
						{#snippet action()}
							<RowSheetMark {player} />
						{/snippet}
					</Row>
				{/each}
			</section>
		</div>
		<aside class="side" aria-label="Sources">
			<Panel>
				<PanelHead title="Sources" aside={plural(page.sources.length, 'source')} />
				<BasisList
					terms={[
						...sourceTerms,
						{ term: 'No ADP yet', means: `${plural(page.unpriced, 'player')} on our board` }
					]}
				/>
			</Panel>
		</aside>
	</main>
</SiteShell>

<style>
	.adp {
		display: grid;
		grid-template-columns: minmax(0, 1fr) var(--side-w);
		gap: var(--s-5);
		padding: var(--s-5);
	}

	.content {
		min-width: 0;
	}

	.lead {
		margin-bottom: var(--s-4);
	}

	.side {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		align-self: start;
		position: sticky;
		top: 84px;
	}

	@media (max-width: 1180px) {
		.adp {
			grid-template-columns: minmax(0, 1fr);
		}

		.side {
			position: static;
		}
	}

	@media (max-width: 760px) {
		.adp {
			padding: var(--s-4);
		}
	}
</style>
