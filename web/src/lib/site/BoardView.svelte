<script lang="ts">
	import type { FormatChip } from '#lib/server/pages/format-route.ts';
	import { onMount } from 'svelte';
	import { POSITION_NAMES, tierGroups } from '#lib/run/derive.ts';
	import type { BoardPage } from '#lib/server/pages/board.ts';
	import { lazySheet } from './lazy-sheet.svelte.ts';
	import FormatChips from './FormatChips.svelte';
	import RowSheetMark from './RowSheetMark.svelte';
	import BasisList from '#lib/ui/BasisList.svelte';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import FilterBar from '#lib/ui/FilterBar.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Row from '#lib/ui/Row.svelte';
	import RowHead from '#lib/ui/RowHead.svelte';
	import TierJump from '#lib/ui/TierJump.svelte';
	import TierStrip from '#lib/ui/TierStrip.svelte';
	import Toggle from '#lib/ui/Toggle.svelte';
	import { scoringBasis } from '#lib/run/catalog.ts';
	import type { BoardRowView } from '#lib/run/schema.ts';
	import { links, tierAnchor } from './links.ts';

	interface Props {
		page: BoardPage;
		season: number;
	}

	let { page, season }: Props = $props();

	/** Faces in the first screen load eagerly so they count toward the first paint. */
	const EAGER_ROWS = 8;

	let belowReplacement = $state(true);
	let range = $state(true);
	let onlySheet = $state<boolean>(false);

	// The sheet loads on the reader's first intent, and at once when they ask for only their sheet.
	onMount(() => lazySheet.armOnFirstIntent(window));
	$effect(() => {
		if (onlySheet) void lazySheet.load();
	});

	const Rail = $derived(lazySheet.parts?.Rail);

	function shown(row: BoardRowView): boolean {
		if (!belowReplacement && row.vor < 0) return false;
		return !onlySheet || lazySheet.has(row.id);
	}

	const groups = $derived(page.position === null ? [] : tierGroups(page.rows, page.position));
	const visible = $derived(page.rows.filter(shown));
	const group = $derived(POSITION_NAMES[page.position ?? 'WR']);
	const unit = $derived(page.format.unit);
	const basisTerms = $derived([
		{ term: 'Scoring', means: scoringBasis(page.format) },
		// In season the lead names the sort and the season, so the order and the tiers move here.
		...(page.seasonLead === null
			? []
			: [{ term: 'Order', means: page.format.basis.slice(1).join(', ') }]),
		{
			term: 'Green',
			means: `The round his points over replacement rank in, among ${String(page.boardSize)}`
		},
		{ term: 'Rose', means: 'Below replacement' },
		{ term: 'Drafters', means: `Their ADP from ${page.adpBasis.join(' and ')}, against our rank` }
	]);

	/** The side column's anchor: the basis, the toggles and the tiers. */
	const SIDE_ID = 'board-side';
</script>

{#snippet row(player: BoardRowView, i: number)}
	<Row
		{player}
		href={links.player(player.slug)}
		scale={page.scale}
		showTier={page.position === null}
		{unit}
		{range}
		eager={i < EAGER_ROWS}
		season={player.season}
	>
		{#snippet action()}
			<RowSheetMark {player} />
		{/snippet}
	</Row>
{/snippet}

<main class="board">
	<div class="content">
		<div class="lead">
			<PageHead title="{season} Board" lead={page.seasonLead ?? page.format.basis.join(' · ')}>
				{#snippet actions()}
					<Quiet href={links.adp(page.format.id)} size="sm">ADP</Quiet>
					<Quiet href={links.schedule()} size="sm">Schedule strength</Quiet>
					<!-- Where the side column falls below 400 rows, a way to it from the top. -->
					<span class="to-side"><Quiet href="#{SIDE_ID}" size="sm">Basis and filters</Quiet></span>
				{/snippet}
			</PageHead>
		</div>
		<div class="filters">
			<FilterBar>
				<FormatChips
					formats={page.formats}
					current={page.format.id}
					href={(chip: FormatChip) => links.board(chip.id, chip.onRun ? page.position : null)}
				/>
				<ChipGroup label="Position">
					<Chip href={links.board(page.format.id)} pressed={page.position === null}>All</Chip>
					{#each page.positions as position (position)}
						<Chip href={links.board(page.format.id, position)} pressed={page.position === position}
							>{position}</Chip
						>
					{/each}
				</ChipGroup>
			</FilterBar>
		</div>

		<section aria-label="{page.position ?? 'All'} {page.format.label} board">
			<RowHead {range} action />
			{#if page.position === null}
				{#each visible as player, i (player.id)}
					{@render row(player, i)}
				{/each}
			{:else}
				{#each groups as tierGroup (tierGroup.tier)}
					{@const rows = tierGroup.rows.filter(shown)}
					{#if rows.length > 0}
						<div class="tier">
							<TierStrip
								id={tierAnchor(page.position, tierGroup.tier)}
								tier={tierGroup.tier}
								count={tierGroup.rows.length}
								{group}
								cliff={tierGroup.cliff}
								{unit}
							/>
							{#each rows as player (player.id)}
								{@render row(player, player.positionRank - 1)}
							{/each}
						</div>
					{/if}
				{/each}
			{/if}
		</section>
	</div>

	<aside class="side" id={SIDE_ID} aria-label="Your board">
		{#if page.position !== null}
			<Panel>
				<PanelHead title="Tiers" aside="Drop to next" />
				<TierJump
					{group}
					tiers={groups.map((tierGroup) => ({
						tier: tierGroup.tier,
						count: tierGroup.rows.length,
						cliff: tierGroup.cliff,
						href: `#${tierAnchor(page.position ?? 'WR', tierGroup.tier)}`
					}))}
				/>
			</Panel>
		{/if}
		<Panel>
			<PanelHead title="Show" />
			<Toggle label="Players below replacement" bind:checked={belowReplacement} />
			<Toggle label="Floor to ceiling" bind:checked={range} />
			<Toggle label="Only my sheet" bind:checked={onlySheet} />
		</Panel>
		<Panel>
			<PanelHead title="Basis" />
			<BasisList terms={basisTerms} />
		</Panel>
		<!-- Last in the column, so the rail arriving with the sheet moves nothing above it. -->
		{#if Rail}<Rail />{/if}
	</aside>
</main>

<style>
	.board {
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

	.filters {
		margin-bottom: var(--s-4);
	}

	.tier {
		margin-top: var(--s-4);
	}

	.side {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		align-self: start;
		position: sticky;
		top: 84px;
	}

	.to-side {
		display: none;
	}

	@media (max-width: 1180px) {
		.board {
			grid-template-columns: minmax(0, 1fr);
		}

		.to-side {
			display: contents;
		}

		.side {
			position: static;
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		}
	}

	@media (max-width: 760px) {
		.board {
			padding: var(--s-4);
			gap: var(--s-4);
		}

		.side {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
