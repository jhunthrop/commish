<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { LeagueHost } from '#lib/league/api.ts';
	import { weekHead } from '#lib/format/figure-words.ts';
	import { BOX, boxNumber, easeOf, oppRankWord } from '#lib/league/box/box.ts';
	import FigureStrip from '#lib/ui/FigureStrip.svelte';
	import { SHEET_MARK } from '#lib/ui/sheet-mark.ts';
	import BoxGame from '#lib/league/box/BoxGame.svelte';
	import BoxPlayer from '#lib/league/box/BoxPlayer.svelte';
	import { tabHref } from '#lib/league/inseason/tabs.ts';
	import MoveLink from '#lib/ui/MoveLink.svelte';
	import OppRank from '#lib/ui/OppRank.svelte';
	import RosterChip from '#lib/ui/RosterChip.svelte';
	import type { OrderAdvice } from './api.ts';
	import {
		FIGURE_HEADS,
		ORDER,
		figureColumns,
		sortedFigure,
		stripCells,
		moveHref,
		moveWords,
		orderSections,
		type OrderSection,
		type OrderView
	} from './order.ts';
	import SectionHead from './SectionHead.svelte';

	/** Our order as a box score (Lane 66j): #, the player, in a league his roster, his game, Proj, then
	 * Rest of season with his projected points first and big (Lane 139, C20), Over repl. beside it across
	 * positions (the key the # sorts on), Avg, Last and Opp rank, and the one move his row admits. Your players are tinted. Below
	 * 1100 px the figures after the key fold under the name as labelled cells (Lane 209, never a
	 * sentence); on a phone the row is two lines and its strip: #, face, name, pill, club and Projected
	 * big; his game, status and the verb with its word; then the strip with the week's figure. */
	interface Props {
		label: string;
		rows: readonly OrderView[];
		rankBy: OrderAdvice['rank_by'];
		/** The week the answer's projection is for (the API's), which heads it beside the season's
		 * Projected. */
		week: number;
		/** The attached league the rows are marked for, with its platform and the claim's moves; null
		 * draws no roster and no move. */
		league: { id: string; host: LeagueHost; moves: OrderAdvice['moves'] } | null;
		/** Your sheet's tags on a player, by board id. */
		tagsOf?: (boardId: string | null) => readonly string[];
		/** A row's own control at the end (the Players screen's sheet mark), when not a league's move. */
		end?: Snippet<[OrderView]>;
		/** The week's rankings (the Players page, Lane 163 D06): the byes in their own section after
		 * the players who play, headed "Bye in week 7" as the week's box score heads its byes. */
		byesApart?: boolean;
	}

	let {
		label,
		rows,
		rankBy,
		week,
		league,
		tagsOf = () => [],
		end,
		byesApart = false
	}: Props = $props();

	const marked = $derived(league !== null);
	const figures = $derived(figureColumns(rankBy));
	/** The column # sorts on, its head marked where it is not the big first column (MEDIUM-3). */
	const sortedBy = $derived(sortedFigure(rankBy));
	/** The rows in their sections: one with no head, unless the byes sit apart. */
	const sections = $derived<OrderSection[]>(
		byesApart ? orderSections(rows, week) : [{ key: 'playing', head: null, rows: [...rows] }]
	);
	/** Every column, for a section head across the row. */
	const span = $derived((marked ? 3 : 2) + 2 + figures.length + (marked || end ? 4 : 3));
</script>

{#snippet mark(row: OrderView, size: 'md' | 'fold')}
	{#if row.roster}<RosterChip kind={row.roster.kind} words={row.roster.words} {size} />{/if}
{/snippet}

<table class="order" class:marked aria-label={label}>
	<thead>
		<tr class="grp">
			<th colspan={marked ? 3 : 2} scope="colgroup" class="g-order">{ORDER.rankGroup}</th>
			<th colspan="2"></th>
			<th colspan={figures.length} scope="colgroup" class="g-rest">{ORDER.restGroup}</th>
			<th colspan={marked || end ? 4 : 3} class="g-tail"></th>
		</tr>
		<tr class="cols">
			<th class="n rank" scope="col" aria-label="{ORDER.rank}, {ORDER.rankGroup.toLowerCase()}"
				>{ORDER.rank}</th
			>
			<th class="pl" scope="col">{BOX.player}</th>
			{#if marked}<th class="roster" scope="col">{ORDER.roster}</th>{/if}
			<th class="game" scope="col">{BOX.game}</th>
			<th class="n proj" scope="col">{weekHead(week)}</th>
			{#each figures as f, i (f)}
				<th
					class="n {i === 0 ? 'key' : 'ev fig'}"
					class:sorted={f === sortedBy && i > 0}
					scope="col"
					aria-sort={f === sortedBy ? 'descending' : undefined}>{FIGURE_HEADS[f]}</th
				>
			{/each}
			<th class="n ev first" scope="col">{BOX.avg}</th>
			<th class="n ev" scope="col">{BOX.last}</th>
			<th class="n ev opp" scope="col">{BOX.oppRank}</th>
			{#if marked || end}<th class="act" scope="col"
					><span class="vh">{league === null ? SHEET_MARK.add : ORDER.tradeFor}</span></th
				>{/if}
		</tr>
	</thead>
	{#each sections as section (section.key)}
		<tbody class={section.key}>
			{#if section.head}<SectionHead {span} head={section.head} />{/if}
			{#each section.rows as row (row.key)}
				{@const href = moveHref(row, league?.id ?? null, tabHref)}
				{@const rank = row.box.evidence.oppRank}
				<tr class:mine={row.roster?.kind === 'yours'}>
					<td class="n rank">{row.place}</td>
					<td class="player">
						<BoxPlayer row={row.box} tags={tagsOf(row.box.boardId)} line fitOnPhone>
							{#snippet after()}<span class="ph-mark">{@render mark(row, 'fold')}</span>{/snippet}
							<span class="ph-ev"><FigureStrip cells={stripCells(row, rankBy, week)} /></span>
						</BoxPlayer>
					</td>
					{#if marked}<td class="roster">{@render mark(row, 'md')}</td>{/if}
					<td class="game"><BoxGame row={row.box} /></td>
					<td class="n proj">{boxNumber(row.week)}</td>
					{#each figures as f, i (f)}
						<td class="n {i === 0 ? 'key' : 'ev fig'}">{boxNumber(row.figures[f])}</td>
					{/each}
					<td class="n ev first">{boxNumber(row.box.evidence.avg)}</td>
					<td class="n ev">{boxNumber(row.box.evidence.last)}</td>
					<td class="n ev opp"
						><OppRank
							text={oppRankWord(rank)}
							ease={rank === null ? null : easeOf(rank, row.box.evidence.oppOf)}
						/></td
					>
					{#if marked || end}
						<td class="act">
							{#if league !== null && href !== null && row.move}
								<MoveLink
									{href}
									move={row.move}
									said={moveWords(row, league.moves, league.host)}
									name={row.box.name}
								/>
							{:else if league !== null && row.held !== null}<span class="held">{row.held}</span>
							{:else if end}{@render end(row)}{/if}
						</td>
					{/if}
				</tr>
			{/each}
		</tbody>
	{/each}
</table>

<style>
	.order {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		overflow: hidden;
	}

	th {
		padding: 0 var(--s-2);
		text-align: left;
		background: var(--bg);
	}

	.grp th {
		height: 22px;
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-2);
	}

	.grp .g-rest {
		text-align: center;
		border-left: 1px solid var(--line);
	}

	.cols th {
		height: 30px;
		font-size: var(--t-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
		border-bottom: 1px solid var(--line);
		white-space: nowrap;
	}

	/* The head # sorts on: in ink, with the sort's caret in the accent, as the boards draw it. */
	.cols .sorted {
		color: var(--ink);
	}

	.cols .sorted::after {
		content: '';
		display: inline-block;
		margin-left: 4px;
		border: 4px solid transparent;
		border-bottom: 5px solid var(--accent);
		vertical-align: 3px;
	}

	.cols .rank {
		width: 52px;
		color: var(--ink);
	}

	.cols .roster {
		width: 168px;
	}

	.cols .game {
		width: 200px;
	}

	.cols .proj {
		width: 60px;
	}

	.cols .key {
		width: 76px;
		border-left: 1px solid var(--line);
	}

	.cols .fig {
		width: 64px;
	}

	.cols .ev {
		width: 58px;
	}

	.cols .ev.first {
		width: 64px;
		border-left: 1px solid var(--line);
	}

	.cols .opp {
		width: 84px;
	}

	.cols .act {
		width: 148px;
	}

	.cols .n {
		text-align: right;
	}

	td {
		padding: 6px var(--s-2);
		border-bottom: 1px solid var(--line);
		vertical-align: middle;
	}

	tr {
		height: var(--row-h);
	}

	tbody tr:hover td {
		background: var(--surface-2);
	}

	tbody:last-child tr:last-child td {
		border-bottom: 0;
	}

	.mine td {
		background: color-mix(in srgb, var(--accent) 7%, var(--surface));
	}

	.mine td:first-child {
		box-shadow: inset 3px 0 0 var(--accent);
	}

	.n {
		text-align: right;
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	td.rank {
		font-size: var(--t-lg);
		font-weight: 800;
		padding-right: var(--s-3);
	}

	td.game {
		font-size: var(--t-sm);
	}

	td.proj {
		font-size: var(--t-lg);
		font-weight: 600;
		color: var(--ink-2);
	}

	td.key {
		font-size: var(--t-xl);
		font-weight: 800;
		color: var(--ink);
		border-left: 1px solid var(--line);
	}

	.ev {
		font-size: var(--t-md);
		font-weight: 600;
		color: var(--ink-2);
	}

	td.ev.first {
		border-left: 1px solid var(--line);
	}

	td.roster {
		max-width: 168px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.act {
		text-align: right;
		white-space: nowrap;
	}

	/* The verb's place for a free agent with no return date: the IR words, quiet, as a caption. */
	.held {
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.ph-mark,
	.ph-ev {
		display: none;
	}

	.vh {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	/* Below a wide screen the season's figures fold under the name, as the Lineup's do. */
	@media (max-width: 1100px) {
		.ev,
		.cols .ev,
		td.ev.first,
		.grp {
			display: none;
		}

		.ph-ev {
			display: block;
			margin-top: 2px;
		}
	}

	/* Below 900 px the roster mark moves onto his club line, as on a phone. */
	@media (max-width: 900px) {
		.roster,
		.cols .roster {
			display: none;
		}

		.ph-mark {
			display: inline-flex;
			min-width: 0;
			max-width: 132px;
		}

		/* The verb keeps its glyph (MoveLink), its printed words giving their width away. */
		.cols .act {
			width: 40px;
		}

		/* No room for the IR words in the glyph's column: his status chip says IR on his name's line. */
		.held {
			display: none;
		}
	}

	/* A phone's row (Lane 209): two lines and the strip, one height down the list. The row is a grid:
	   # and the player on the first line with Projected big at its end, the verb at the end of the
	   game's line, the player's cell spanning both and its strip running under them from the # column
	   (BoxPlayer's line, which keeps room at the line ends from the vars here). */
	@media (max-width: 760px) {
		.order {
			--rank-w: 26px;
			--col-gap: 6px;
			display: block;
		}

		thead,
		tbody {
			display: block;
		}

		.grp {
			display: none;
		}

		tr,
		.cols {
			display: grid;
			grid-template-columns: var(--rank-w) minmax(0, 1fr) auto;
			grid-template-rows: 28px 22px auto;
			column-gap: var(--col-gap);
			row-gap: 2px;
			height: auto;
			padding: 7px var(--s-2) 7px 2px;
			border-bottom: 1px solid var(--line);
		}

		.cols {
			grid-template-rows: 30px;
			padding-top: 0;
			padding-bottom: 0;
			align-items: center;
			background: var(--bg);
		}

		.cols th {
			height: auto;
			border-bottom: 0;
			padding: 0;
		}

		tbody:last-child tr:last-child {
			border-bottom: 0;
		}

		td {
			padding: 0;
			border-bottom: 0;
		}

		tbody tr:hover td,
		.mine td {
			background: none;
		}

		tbody tr:hover {
			background: var(--surface-2);
		}

		.mine {
			background: color-mix(in srgb, var(--accent) 7%, var(--surface));
			box-shadow: inset 3px 0 0 var(--accent);
		}

		.mine td:first-child {
			box-shadow: none;
		}

		.rank,
		.cols .rank,
		td.rank {
			grid-column: 1;
			grid-row: 1;
			width: auto;
			padding: 0;
			font-size: var(--t-md);
			align-self: center;
		}

		td.player {
			grid-column: 2 / 4;
			grid-row: 1 / 4;
			--line-end: 64px;
			--line-end-2: 72px;
			--strip-pull: calc(var(--rank-w) + var(--col-gap) + 28px + var(--s-2));
		}

		td.key,
		.cols .key {
			grid-column: 3;
			grid-row: 1;
			align-self: center;
			width: auto;
			border-left: 0;
			position: relative;
		}

		td.key {
			font-size: var(--t-lg);
		}

		td.act {
			grid-column: 3;
			grid-row: 2;
			align-self: center;
			position: relative;
		}

		.cols th:not(.rank):not(.key):not(.pl),
		td.proj,
		td.fig,
		td.roster,
		td.game {
			display: none;
		}

		.cols .pl {
			grid-column: 2;
		}

		.ph-mark {
			max-width: 80px;
		}
	}
</style>
