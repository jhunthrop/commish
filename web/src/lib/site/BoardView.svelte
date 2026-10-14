<script lang="ts">
	import { onMount } from 'svelte';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import ContextNote from '#lib/context/ContextNote.svelte';
	import { followFormat } from '#lib/context/follow.svelte.ts';
	import { POSITION_NAMES, tierGroups } from '#lib/run/derive.ts';
	import type { BoardPage } from '#lib/server/pages/board.ts';
	import { lazySheet } from './lazy-sheet.svelte.ts';
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
	import { apiFormatOf } from '#lib/run/format-ids.ts';
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
	let rangeOn = $state(true);
	/** The floor to ceiling column: shown while the switch is on, and only on a board with a range. */
	const range = $derived(page.range && rangeOn);
	let onlySheet = $state<boolean>(false);

	// The sheet loads on the reader's first intent, and at once when they ask for only their sheet.
	// The league's rosters mark who is held.
	onMount(() => {
		lazySheet.armOnFirstIntent(window);
		siteContext.wantHeld();
	});
	// The board opens in the context's format and turns with the switch.
	const carried = $derived(page.formats.filter((chip) => chip.onRun).map((chip) => chip.id));
	followFormat(
		() => page.format.id,
		() => carried,
		(id) => links.board(id, page.position)
	);
	const figures = $derived(apiFormatOf(page.format));
	/** What this board is against the league's scoring, also when a link named another board. */
	const note = $derived(siteContext.notes?.lineFor(figures, 'This board is', carried) ?? null);
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
		held={siteContext.held?.mark(player.id) ?? null}
	>
		{#snippet action()}
			<RowSheetMark {player} />
		{/snippet}
	</Row>
{/snippet}

<main class="board" class:rest={!page.range}>
	<!-- The league's line sits by the switch, not under the caption: atop the side column on a desk,
	     first under the bar elsewhere. -->
	<div class="league-line">
		<ContextNote note={note?.text ?? null} link={note?.link ?? null} />
	</div>
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
			<RowHead {range} action games={page.seasonLead !== null} />
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
			{#if page.range}<span class="range-toggle"
					><Toggle label="Floor to ceiling" bind:checked={rangeOn} /></span
				>{/if}
			<Toggle label="Only my sheet" bind:checked={onlySheet} />
		</Panel>
		<Panel>
			<PanelHead title="Basis" />
			<BasisList terms={page.basisTerms} />
		</Panel>
		<!-- Last in the column, so the rail arriving with the sheet moves nothing above it, in a slot
		     holding an empty sheet's height, so the column does not grow when it arrives. -->
		<div class="rail-slot">
			{#if Rail}<Rail />{/if}
		</div>
	</aside>
</main>

<style>
	/* On a desk the content spans both rows and the league's line heads the side column, so the line
	   takes no row of its own when there is none (the flexible second row takes the content's height). */
	.board {
		display: grid;
		grid-template-columns: minmax(0, 1fr) var(--side-w);
		grid-template-rows: auto 1fr;
		column-gap: var(--s-5);
		padding: var(--s-5);
	}

	.league-line {
		grid-column: 2;
		grid-row: 1;
	}

	/* On a desk the line sits in the side column, as narrow as a phone, so it keeps the phone's room. */
	@media (min-width: 1181px) {
		:global(html[data-league='2']) .league-line :global(.note) {
			min-height: 2lh;
		}

		:global(html[data-league='3']) .league-line :global(.note) {
			min-height: 3lh;
		}
	}

	:global(html[data-league]) .league-line,
	.league-line:has(:global(.filled)) {
		margin-bottom: var(--s-4);
	}

	.content {
		grid-column: 1;
		grid-row: 1 / span 2;
		min-width: 0;
	}

	.side {
		grid-column: 2;
		grid-row: 2;
	}

	.lead {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
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

	.range-toggle {
		display: contents;
	}

	/* In season the ADP is the drafts' preseason order and our rank the rest of the season's: the
	   column shows the ADP alone, with no picks-earlier-or-later chip and no "vs us". */
	.rest :global(.adp > :first-child),
	.rest :global(.head .vs) {
		display: none;
	}

	/* From 961 to 1439px an in-season row has no floor to ceiling column, so no switch for it. */
	@media (min-width: 961px) and (max-width: 1439px) {
		.board:has(:global(.row.games)) .range-toggle {
			display: none;
		}

		/* The Range line, last in the Basis list, hides with its column. A board with no range has
		   neither the line nor the switch, so its last line (Drafters) stays. */
		.board:has(.range-toggle):has(:global(.row.games)) .side :global(dl > :nth-last-child(-n + 2)) {
			display: none;
		}
	}

	/* The sheet card's height with no one on it yet ("Your sheet", "No one yet"). */
	.rail-slot {
		min-height: 86px;
	}

	@media (max-width: 1180px) {
		.board {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: none;
		}

		.league-line,
		.content,
		.side {
			grid-column: auto;
			grid-row: auto;
		}

		.content {
			margin-bottom: var(--s-5);
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
		}

		.content {
			margin-bottom: var(--s-4);
		}

		.side {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
