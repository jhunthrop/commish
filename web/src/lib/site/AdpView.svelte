<script lang="ts">
	import { onMount } from 'svelte';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import { followFormat } from '#lib/context/follow.svelte.ts';
	import { rangeScale } from '#lib/run/derive.ts';
	import { rowFraming } from '#lib/run/row-framing.ts';
	import { liveStatusClock, sayBoard, type LiveStatus } from '#lib/run/live-status.ts';
	import type { AdpPage } from '#lib/server/pages/adp.ts';
	import type { RunStamp } from '#lib/run/stamp.ts';
	import BasisLine from '#lib/ui/BasisLine.svelte';
	import BoardTable from '#lib/ui/BoardTable.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Row from '#lib/ui/Row.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { boardColumns } from '#lib/ui/board-columns.ts';
	import { pressed, sortRows, type Sort, type Sortable, type SortKey } from '#lib/ui/board-sort.ts';
	import { sectionHref } from '#lib/ui/nav.ts';
	import RowSheetMark from './RowSheetMark.svelte';
	import RowSheetTags from './RowSheetTags.svelte';
	import SiteShell from './SiteShell.svelte';
	import { lazySheet } from './lazy-sheet.svelte.ts';
	import { links } from './links.ts';

	interface Props {
		page: AdpPage;
		run: RunStamp;
	}

	let { page, run }: Props = $props();

	type AdpRow = AdpPage['rows'][number];

	/** How every row frames his rank against the drafts, the board's rule (run/row-framing.ts). */
	const framing = $derived(rowFraming(page.format));

	/** Faces in the first screen load eagerly so they count toward the first paint. */
	const EAGER_ROWS = 8;
	/** The drafters' order, earliest pick first. */
	const DRAFTERS_ORDER: Sort = { key: 'adpLead', turned: false };

	let sort = $state<Sort>(DRAFTERS_ORDER);
	const columns = $derived(
		boardColumns({
			order: 'adp',
			tier: true,
			bye: true,
			range: true,
			gap: page.gap,
			season: page.underway,
			action: true
		})
	);

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

	/** What a sort reads from a row: a kicker or a defense has no tier, points or value of ours, so he
	 * sorts after every ranked player on those columns. */
	function sortable(row: AdpRow): Sortable & { row: AdpRow } {
		const ours =
			row.orderBasis === 'market'
				? { tier: Infinity, projected: -Infinity, vor: -Infinity }
				: { tier: row.tier, projected: row.projected, vor: row.vor };
		return { row, ourRank: row.ourRank, adp: row.adp, team: row.team, season: row.season, ...ours };
	}

	const rows = $derived(
		sort.key === 'adpLead' && !sort.turned
			? page.rows
			: sortRows(page.rows.map(sortable), sort, page.byes).map((entry) => entry.row)
	);

	function onsort(key: SortKey): void {
		sort = pressed(sort, key);
	}
</script>

<svelte:head>
	<link rel="canonical" href={links.adp(page.format.id)} />
</svelte:head>

<SiteShell title="{page.format.label} ADP" heading="ADP" {run}>
	{#snippet tail()}<Verb href={sectionHref('mock')}>Start a mock draft</Verb>{/snippet}
	<main class="adp">
		<div class="lead">
			<PageHead title="{run.season} ADP">
				{#snippet actions()}<Quiet href={links.board(page.format.id)} size="sm">Board</Quiet
					>{/snippet}
			</PageHead>
			<BasisLine parts={page.basis} tail={words?.capture ?? null} />
		</div>
		<BoardTable {columns} label="{page.format.label} ADP" {sort} {onsort}>
			{#each rows as player, i (player.id)}
				{#if player.orderBasis === 'market'}
					{@const face = player.face}
					<Row
						{player}
						href={links.club(player.team)}
						{columns}
						{scale}
						bye={page.byes[player.team] ?? null}
						{framing}
						eager={i < EAGER_ROWS}
						held={siteContext.held?.mark(player.id) ?? null}
						status={words?.rows[player.id] ?? null}
					>
						{#snippet marks()}<RowSheetTags playerId={player.id} />{/snippet}
						{#snippet action()}<RowSheetMark player={{ ...player, headshot: face }} />{/snippet}
					</Row>
				{:else}
					<Row
						{player}
						href={links.player(player.slug)}
						{columns}
						{scale}
						bye={page.byes[player.team] ?? null}
						{framing}
						eager={i < EAGER_ROWS}
						season={player.season}
						held={siteContext.held?.mark(player.id) ?? null}
						status={words?.rows[player.id] ?? null}
					>
						{#snippet marks()}<RowSheetTags playerId={player.id} />{/snippet}
						{#snippet action()}<RowSheetMark {player} />{/snippet}
					</Row>
				{/if}
			{/each}
		</BoardTable>
	</main>
</SiteShell>

<style>
	.adp {
		padding: var(--s-5);
		min-width: 0;
	}

	.lead {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		margin-bottom: var(--s-4);
	}

	@media (max-width: 760px) {
		.adp {
			padding: var(--s-4);
		}
	}
</style>
