<script lang="ts">
	import { onMount } from 'svelte';
	import { POSITION_NAMES, tierGroups } from '#lib/run/derive.ts';
	import type { BoardPage } from '#lib/server/pages/board.ts';
	import { sheet } from '#lib/sheet/sheet.svelte.ts';
	import BasisList from '#lib/ui/BasisList.svelte';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Row from '#lib/ui/Row.svelte';
	import RowHead from '#lib/ui/RowHead.svelte';
	import TierJump from '#lib/ui/TierJump.svelte';
	import TierStrip from '#lib/ui/TierStrip.svelte';
	import Toggle from '#lib/ui/Toggle.svelte';
	import type { BoardRow } from '#lib/run/schema.ts';
	import { links, tierAnchor } from './links.ts';
	import SheetRail from './SheetRail.svelte';

	interface Props {
		page: BoardPage;
		season: number;
	}

	let { page, season }: Props = $props();

	/** Faces in the first screen load eagerly so they count toward the first paint. */
	const EAGER_ROWS = 8;

	let belowReplacement = $state(true);
	let range = $state(true);
	let onlySheet = $state(false);

	onMount(() => {
		if (!sheet.loaded) sheet.load();
	});

	function shown(row: BoardRow): boolean {
		if (!belowReplacement && row.vor < 0) return false;
		return !onlySheet || sheet.has(row.id);
	}

	const groups = $derived(page.position === null ? [] : tierGroups(page.rows, page.position));
	const visible = $derived(page.rows.filter(shown));
	const group = $derived(POSITION_NAMES[page.position ?? 'WR']);
	const unit = $derived(page.format.unit);
	const basisTerms = $derived([
		{ term: 'Scoring', means: page.format.basis[0] ?? page.format.label },
		{
			term: 'Green',
			means: `The round his points over replacement rank in, among ${String(page.boardSize)}`
		},
		{ term: 'Rose', means: 'Below replacement' },
		{ term: 'Drafters', means: 'Their ADP against our rank' }
	]);
</script>

{#snippet row(player: BoardRow, i: number)}
	<Row
		{player}
		href={links.player(player.slug)}
		scale={page.scale}
		showTier={page.position === null}
		{unit}
		{range}
		eager={i < EAGER_ROWS}
	/>
{/snippet}

<main class="board">
	<div class="content">
		<div class="lead">
			<PageHead title="{season} Board" lead={page.format.basis.join(' · ')}>
				{#snippet actions()}
					<Quiet href={links.adp(page.format.id)} size="sm">ADP</Quiet>
					<Quiet href={links.schedule()} size="sm">Schedule strength</Quiet>
					<Quiet href={links.clubs()} size="sm">Clubs</Quiet>
				{/snippet}
			</PageHead>
		</div>
		<div class="filters">
			{#if page.formats.length > 1}
				<ChipGroup label="Scoring">
					{#each page.formats as format (format.id)}
						<Chip
							href={links.board(format.id, page.position)}
							pressed={format.id === page.format.id}>{format.label}</Chip
						>
					{/each}
				</ChipGroup>
			{/if}
			<ChipGroup label="Position">
				<Chip href={links.board(page.format.id)} pressed={page.position === null}>All</Chip>
				{#each page.positions as position (position)}
					<Chip href={links.board(page.format.id, position)} pressed={page.position === position}
						>{position}</Chip
					>
				{/each}
			</ChipGroup>
		</div>

		<section aria-label="{page.position ?? 'All'} {page.format.label} board">
			<RowHead {range} />
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

	<aside class="side" aria-label="Your board">
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
		<SheetRail format={page.format.id} />
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
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-3);
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

	@media (max-width: 1180px) {
		.board {
			grid-template-columns: minmax(0, 1fr);
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

		.filters {
			flex-wrap: nowrap;
			overflow-x: auto;
			margin-inline: calc(-1 * var(--s-4));
			padding-inline: var(--s-4);
			scrollbar-width: none;
		}

		.side {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
