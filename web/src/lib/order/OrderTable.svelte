<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { LeagueHost } from '#lib/league/api.ts';
	import { weekHead } from '#lib/format/figure-words.ts';
	import { BOX, boxNumber, easeOf, oppRankWord } from '#lib/league/box/box.ts';
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
		moveHref,
		moveWords,
		type OrderView
	} from './order.ts';

	/** Our order as a box score (Lane 66j): #, the player, in a league his roster, his game, Proj, then
	 * Rest of season with the key the # sorts on first and big (Over repl. across positions, Points at a
	 * position), Avg, Last and Opp rank, and the one move his row admits. Your players are tinted. Below
	 * 1100 px the figures after the key fold under the name in one short line; on a phone the game folds
	 * too, the roster mark onto his club line. */
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
	}

	let { label, rows, rankBy, week, league, tagsOf = () => [], end }: Props = $props();

	const marked = $derived(league !== null);
	const figures = $derived(figureColumns(rankBy));
	const SEPARATOR = ', ';

	/** The folded line under the name below 1100 px: every figure after the key, the opponent's rank,
	 * then Avg and Last. */
	function folded(row: OrderView): string {
		const rest = figures.slice(1).map((f) => `${FIGURE_HEADS[f]} ${boxNumber(row.figures[f])}`);
		const rank = row.box.evidence.oppRank;
		const opp = rank === null ? [] : [`${BOX.opp} ${oppRankWord(rank)}`];
		return [
			...rest,
			...opp,
			`${BOX.avg} ${boxNumber(row.box.evidence.avg)}`,
			`${BOX.last} ${boxNumber(row.box.evidence.last)}`
		].join(SEPARATOR);
	}
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
			<th scope="col">{BOX.player}</th>
			{#if marked}<th class="roster" scope="col">{ORDER.roster}</th>{/if}
			<th class="game" scope="col">{BOX.game}</th>
			<th class="n proj" scope="col">{weekHead(week)}</th>
			{#each figures as f, i (f)}
				<th class="n {i === 0 ? 'key' : 'ev fig'}" scope="col">{FIGURE_HEADS[f]}</th>
			{/each}
			<th class="n ev first" scope="col">{BOX.avg}</th>
			<th class="n ev" scope="col">{BOX.last}</th>
			<th class="n ev opp" scope="col">{BOX.oppRank}</th>
			{#if marked || end}<th class="act" scope="col"><span class="vh">{ORDER.tradeFor}</span></th
				>{/if}
		</tr>
	</thead>
	<tbody>
		{#each rows as row (row.key)}
			{@const href = moveHref(row, league?.id ?? null, tabHref)}
			{@const rank = row.box.evidence.oppRank}
			<tr class:mine={row.roster?.kind === 'yours'}>
				<td class="n rank">{row.rank}</td>
				<td class="player">
					<BoxPlayer row={row.box} tags={tagsOf(row.box.boardId)}>
						{#snippet after()}<span class="ph-mark">{@render mark(row, 'fold')}</span>{/snippet}
						<span class="ph-ev">{folded(row)}</span>
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

	tbody tr:last-child td {
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
			font-size: var(--t-xs);
			color: var(--ink-3);
			font-variant-numeric: tabular-nums;
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
	}

	@media (max-width: 760px) {
		.grp {
			display: none;
		}

		td {
			padding: 7px 4px;
		}

		tr {
			height: auto;
		}

		.cols .rank,
		td.rank {
			width: 30px;
			font-size: var(--t-md);
			padding-right: 2px;
		}

		.cols .proj {
			width: 44px;
		}

		.cols .key {
			width: 52px;
		}

		.cols .act {
			width: 40px;
		}

		.roster,
		.cols .roster,
		.game,
		.cols .game {
			display: none;
		}

		td.proj {
			font-size: var(--t-sm);
		}

		td.key {
			font-size: var(--t-md);
		}
	}
</style>
