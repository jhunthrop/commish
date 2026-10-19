<script lang="ts">
	import { EMPTY_FIGURE } from '#lib/format/empty.ts';
	import { gapText, gapTone } from '#lib/format/gap.ts';
	import { fixed, signed } from '#lib/format/number.ts';
	import type { Snippet } from 'svelte';
	import type { ShownMark } from '#lib/context/held-words.ts';
	import { HELD_FRAMING, framedVorCell, type RowFraming } from '#lib/run/row-framing.ts';
	import type { IndexSeason } from '#lib/run/schema.ts';
	import type { StatusView } from '#lib/run/status-view.ts';
	import type { BoardPlayer, MarketPosition, RangeScale } from '#lib/types/player.ts';
	import type { BoardColumns } from './board-columns.ts';
	import Face from './Face.svelte';
	import NameWords from './NameWords.svelte';
	import RangeBar from './RangeBar.svelte';
	import StatusPill from './StatusPill.svelte';
	import TierChip from './TierChip.svelte';

	/** A kicker or a defense in draft order (Lane 66m, the 2026-09-05 ruling): his place among the
	 * players the drafts take, the format's ADP, his face (a defense's is its club's mark), and no
	 * projected points, no tier and no range. */
	interface DraftOrderPlayer {
		orderBasis: 'market';
		name: string;
		position: MarketPosition;
		positionRank: number;
		team: string;
		adp: number;
		ourRank: number;
		face: string | null;
	}

	/** One board row as a box score (Lane 66n): the player the biggest thing on it, every figure under
	 * a column head that names it once (RowHead), the columns the view's (board-columns.ts). */
	interface Props {
		/** A ranked player, or a kicker or a defense in draft order. */
		player: BoardPlayer | DraftOrderPlayer;
		/** The player's page. */
		href: string;
		/** The view's columns, the same object its BoardTable and RowHead draw. */
		columns: BoardColumns;
		/** The range scale every row in this view shares. */
		scale?: RangeScale;
		/** His club's bye week, null when the run names none. */
		bye: number | null;
		/** Faces in the first screen of a prerendered board load eagerly. */
		eager?: boolean;
		/** The row's sheet control at its end (SheetMark), where the columns carry it. Anything in it
		 * marked data-reveal shows only while the row is hovered or holds focus. */
		action?: Snippet;
		/** Marks on his line from the member's own sheet (its tags), drawn once the sheet is in. */
		marks?: Snippet;
		/** His season so far, once the run is past the season's first kickoff: the GP and A game columns. */
		season?: IndexSeason;
		/** The league's mark, with the component that draws it (HeldMark): yours tints the row. */
		held?: ShownMark | null;
		/** How the row frames his rank against the drafts (run/row-framing.ts): the tint it keeps. */
		framing: RowFraming;
		/** His injury status when the run's capture lists him (run/status-view.ts), drawn by the shared
		 * pill: a season-long one shows as his rank and its chip ("IR since Sep 22"). */
		status?: StatusView | null;
	}

	let {
		player,
		href,
		columns,
		scale,
		bye,
		eager = false,
		action,
		marks,
		season,
		held = null,
		framing,
		status = null
	}: Props = $props();

	function inDraftOrder(row: BoardPlayer | DraftOrderPlayer): row is DraftOrderPlayer {
		// A ranked row read from the run carries orderBasis "projection" though its type does not name it.
		return (row as { orderBasis?: unknown }).orderBasis === 'market';
	}

	const ranked = $derived(inDraftOrder(player) ? null : player);
	const drafted = $derived(inDraftOrder(player) ? player : null);
	const cell = $derived(columns.cells);
	const has = (key: keyof typeof columns.cells): boolean => columns.cells[key] !== undefined;

	/** A player on a season-long list: his rank is the word, so no tier and no gap. */
	const heldOut = $derived(status !== null && status.rank !== null);
	const rankShown = $derived(status?.rank ?? (ranked === null ? '' : String(ranked.ourRank)));
	const vor = $derived(
		ranked === null
			? null
			: framedVorCell(ranked.vor, ranked.vorRound, heldOut ? HELD_FRAMING : framing)
	);
	/** Drafters' ADP less our rank, the one sign on every page: plus when drafters wait. */
	const gap = $derived(ranked === null || heldOut ? null : (ranked.gap ?? null));
	const tone = $derived(gapTone(gap));
	/** A kicker's or a defense's pill carries his place where no Draft order column does (ADP). */
	const pillRank = $derived(
		drafted === null ? undefined : has('order') ? undefined : drafted.positionRank
	);
</script>

<div class="row" class:mine={held?.kind === 'mine'}>
	{#if cell.rank}<span class="n rk {cell.rank}">{rankShown}</span>{/if}
	{#if cell.adpLead}<span class="n {cell.adpLead}" class:absent={player.adp === null}
			>{player.adp === null ? EMPTY_FIGURE : fixed(player.adp)}</span
		>{/if}
	<span class="face {cell.face}"
		><Face
			src={drafted === null ? (ranked?.headshot ?? null) : drafted.face}
			name={player.name}
			size={40}
			loading={eager ? 'eager' : 'lazy'}
		/>{#if held}<held.Mark words={held.words} kind={held.kind} />{/if}</span
	>
	<span class="who {cell.player}">
		<a class="name" {href}><NameWords name={player.name} /></a>
		<span class="meta">
			<StatusPill
				position={player.position}
				positionRank={ranked?.positionRank ?? pillRank}
				{status}
			/>
			<span class="club">{player.team}</span>
			{#if bye !== null}<span class="phone-bye">Bye {bye}</span>{/if}
			{#if marks}{@render marks()}{/if}
		</span>
	</span>
	{#if cell.tier}<span class={cell.tier}
			>{#if ranked && !heldOut}<TierChip tier={ranked.tier} bare />{:else}<span class="n absent"
					>{EMPTY_FIGURE}</span
				>{/if}</span
		>{/if}
	{#if cell.bye}<span class="n quiet {cell.bye}" class:absent={bye === null}
			>{bye ?? EMPTY_FIGURE}</span
		>{/if}
	{#if cell.proj}<span class="n {cell.proj}" class:absent={ranked === null}
			>{ranked ? fixed(ranked.projected) : EMPTY_FIGURE}</span
		>{/if}
	{#if cell.vor}<span class="end {cell.vor}"
			>{#if vor}<b class="n tile {vor.heat}">{signed(vor.value, 1)}</b>{:else}<span class="n absent"
					>{EMPTY_FIGURE}</span
				>{/if}</span
		>{/if}
	{#if cell.order}<span class="n {cell.order}" class:absent={drafted === null}
			>{drafted?.positionRank ?? EMPTY_FIGURE}</span
		>{/if}
	<!-- An empty range sits at the cell's end, as every other empty mark does (Lane 66q). -->
	{#if cell.range}<span
			class={cell.range}
			class:end={!(
				ranked &&
				scale &&
				ranked.floor !== null &&
				ranked.median !== null &&
				ranked.ceiling !== null
			)}
			>{#if ranked && scale && ranked.floor !== null && ranked.median !== null && ranked.ceiling !== null}<RangeBar
					floor={ranked.floor}
					median={ranked.median}
					ceiling={ranked.ceiling}
					{scale}
					form="inline"
				/>{:else}<span class="n absent">{EMPTY_FIGURE}</span>{/if}</span
		>{/if}
	{#if cell.adp}<span class="n {cell.adp}" class:absent={player.adp === null}
			>{player.adp === null ? EMPTY_FIGURE : fixed(player.adp)}</span
		>{/if}
	{#if cell.ourRank}<span class="n quiet {cell.ourRank}" class:absent={ranked === null}
			>{ranked ? rankShown : EMPTY_FIGURE}</span
		>{/if}
	{#if cell.gap}<span
			class="n gap {cell.gap}"
			class:absent={gap === null}
			class:gain={tone === 'gain'}
			class:loss={tone === 'loss'}>{gapText(gap)}</span
		>{/if}
	{#if cell.gp}<span class="n quiet {cell.gp}" class:absent={season === undefined}
			>{season?.games ?? EMPTY_FIGURE}</span
		>{/if}
	{#if cell.agame}<span
			class="n {cell.agame}"
			class:absent={season === undefined || season.pointsPerGame === null}
			>{season === undefined || season.pointsPerGame === null
				? EMPTY_FIGURE
				: fixed(season.pointsPerGame)}</span
		>{/if}
	{#if cell.action}<span class="action {cell.action}"
			>{#if action}{@render action()}{/if}</span
		>{/if}
</div>

<style>
	/* The name's link stretches over the whole row, so the face, the numbers and the empty space all
	   open his page. The action sits above it. The grid is the table's, one template per band
	   (BoardTable sets them, board-columns.ts decides them). */
	.row {
		position: relative;
		display: grid;
		grid-template-columns: var(--cols-desk);
		align-items: center;
		column-gap: var(--s-2);
		min-height: var(--row-h);
		padding: 4px var(--s-3);
		border-bottom: 1px solid var(--line);
	}

	.row:hover {
		background: var(--surface);
	}

	/* Your own player's row takes your wash, the one tint that means you. */
	.mine,
	.mine:hover {
		background: var(--accent-wash);
	}

	/* A figure: the number face, a step under the name, so the player stays the biggest thing. */
	.n {
		text-align: right;
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		font-size: var(--t-row-num);
		font-weight: 600;
		letter-spacing: 0.01em;
		white-space: nowrap;
	}

	.quiet,
	.rk {
		color: var(--ink-2);
	}

	.rk {
		color: var(--ink-3);
	}

	.absent {
		font-family: var(--font-ui);
		font-size: var(--t-xs);
		font-weight: 500;
		color: var(--ink-3);
	}

	.end {
		display: flex;
		justify-content: flex-end;
	}

	/* Over replacement: the tinted tile, the signed figure alone, its head naming it. */
	.tile {
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		min-width: 100%;
		height: 32px;
		padding: 0 var(--s-2);
		border-radius: var(--r-sm);
		color: var(--heat-ink);
		font-weight: 600;
	}

	.heat-1 {
		background: var(--heat-1);
	}

	.heat-2 {
		background: var(--heat-2);
	}

	.heat-3 {
		background: var(--heat-3);
	}

	.heat-4 {
		background: var(--heat-4);
	}

	.heat-neg {
		background: var(--heat-neg);
	}

	/* The gap: its sign carries it, its tone repeats it. */
	.gain {
		color: var(--gain-ink);
	}

	.loss {
		color: var(--loss-ink);
	}

	.face {
		position: relative;
		display: inline-grid;
	}

	.who {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.name {
		font-weight: 600;
		font-size: var(--t-row-name);
		line-height: 1.2;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-decoration: none;
	}

	.name::after {
		content: '';
		position: absolute;
		inset: 0;
	}

	.row:hover .name {
		text-decoration: underline;
	}

	/* His position (with its status chip), club and, on the phone, the bye: small, one line. */
	.meta {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		overflow: hidden;
		color: var(--ink-3);
		white-space: nowrap;
	}

	.meta > :global(*) {
		flex: none;
	}

	.club,
	.phone-bye {
		font-size: var(--t-xs);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.phone-bye {
		display: none;
	}

	.action {
		position: relative;
		z-index: 1;
		display: flex;
		justify-content: flex-end;
	}

	.action :global([data-reveal]) {
		opacity: 0;
	}

	.row:hover .action :global([data-reveal]),
	.row:focus-within .action :global([data-reveal]) {
		opacity: 1;
	}

	@media (hover: none) {
		.action :global([data-reveal]) {
			opacity: 1;
		}
	}

	/* Below a desk the sheet mark is its disc: his place on your sheet is in its name. */
	@media (max-width: 1439px) {
		.action :global(.place) {
			display: none;
		}

		.action :global(.add) {
			padding-left: 2px;
		}
	}

	@media (min-width: 961px) and (max-width: 1439px) {
		.row {
			grid-template-columns: var(--cols-lap);
		}

		.h-lap {
			display: none;
		}
	}

	@media (min-width: 761px) and (max-width: 960px) {
		.row {
			grid-template-columns: var(--cols-tab);
		}

		.h-tab {
			display: none;
		}
	}

	@media (min-width: 1440px) {
		.h-desk {
			display: none;
		}
	}

	@media (max-width: 760px) {
		.row {
			grid-template-columns: var(--cols-phone);
			column-gap: 6px;
			padding: 4px 0;
		}

		.h-phone {
			display: none;
		}

		.phone-bye {
			display: inline;
		}

		/* His club and bye never give way to a status chip: the line takes a second row instead. */
		.meta {
			flex-wrap: wrap;
			row-gap: 2px;
			overflow: visible;
		}

		.tile {
			height: 30px;
			padding: 0 6px;
		}

		/* A long name takes a second line rather than losing its end: "Jaxon Smith-Njigba". */
		.name {
			white-space: normal;
			display: -webkit-box;
			-webkit-box-orient: vertical;
			-webkit-line-clamp: 2;
			line-clamp: 2;
		}
	}
</style>
