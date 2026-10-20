<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { BOX } from './box.ts';
	import { askedPlayer, markAsked } from './asked.ts';
	import BoxLine from './BoxLine.svelte';
	import TeamFigures from './TeamFigures.svelte';
	import { BENCH_ANCHOR, LINEUP, type LineupBox, type LineupRow } from './lineup.ts';

	/** The Lineup screen's one table (Lane 66e): the lineup the advice sets, Totals lit like the score
	 * bug, the bench and the injured reserve, each row in the same columns (slot, player, game, Proj,
	 * Pts, then Opp rank, Avg, Last and the projection's change). A row the advice moves in carries an
	 * arrow, a tint and a button that opens its one evidence line; a starter it sits carries the arrow
	 * down on the bench. */
	interface Props {
		label: string;
		box: LineupBox;
		/** Your sheet's tags on a player, by board id. */
		tagsOf?: (boardId: string | null) => readonly string[];
		/** Said under the bench's head when the bench is empty. */
		noBench: string;
	}

	let { label, box, tagsOf = () => [], noBench }: Props = $props();

	const COLUMNS = 10;
	const opened = new SvelteSet<string>();

	// The League page's bench count links here: the table is read after the page opens, so the
	// browser's own jump to the bench missed it, and the table makes it once it is drawn.
	onMount(() => {
		if (location.hash === `#${BENCH_ANCHOR}`) {
			document.getElementById(BENCH_ANCHOR)?.scrollIntoView({ block: 'start' });
		}
	});

	let table = $state<HTMLTableElement | null>(null);

	/** A player page's verb names him (?player=, Lane 66h): his row is marked and brought into view. */
	onMount(() => {
		const asked = askedPlayer(window.location.href);
		if (asked !== null && table !== null) markAsked(table, asked);
	});

	function whyOf(entry: LineupRow): { id: string; open: boolean; toggle: () => void } | null {
		if (entry.why === null) return null;
		const key = entry.row.key;
		return {
			id: `why-${key}`,
			open: opened.has(key),
			toggle: () => {
				if (opened.has(key)) opened.delete(key);
				else opened.add(key);
			}
		};
	}
</script>

<table class="lineup" aria-label={label} bind:this={table}>
	<thead>
		<tr class="cols">
			<th class="slot" scope="col">{BOX.slot}</th>
			<th scope="col">{BOX.player}</th>
			<th class="game" scope="col">{BOX.game}</th>
			<th class="n num" scope="col">{BOX.proj}</th>
			<th class="n num pts" scope="col">{BOX.pts}</th>
			<th class="n ev first" scope="col">{BOX.oppRank}</th>
			<th class="n ev" scope="col">{BOX.avg}</th>
			<th class="n ev" scope="col">{BOX.last}</th>
			<th class="n ev delta" scope="col">{BOX.delta}</th>
			<th class="op" scope="col"><span class="vh">{BOX.why}</span></th>
		</tr>
	</thead>
	<tbody>
		{#each box.starters as entry (entry.row.key)}
			{@const why = whyOf(entry)}
			<BoxLine
				row={entry.row}
				tags={tagsOf(entry.row.boardId)}
				evidence
				move={entry.move}
				{why}
				idle={entry.idle}
			/>
			{#if why?.open}
				<tr class="whyline"><td></td><td id={why.id} colspan={COLUMNS - 1}>{entry.why}</td></tr>
			{/if}
		{/each}
		{#each box.empty as slot (slot)}
			<!-- A spot empty on the platform that no one who can play fills (review N2). -->
			<tr class="nobody">
				<td class="slot-word">{slot}</td>
				<td colspan="2">{LINEUP.noOneHere}</td>
				<td class="n">{BOX.none}</td>
				<td class="n">{BOX.none}</td>
				<td colspan={COLUMNS - 5}></td>
			</tr>
		{/each}
		<tr class="totals">
			<td colspan="3"
				><span class="tl">{BOX.totals}</span>{#if box.totals.note}<span class="tsub"
						>{box.totals.note}</span
					>{/if}</td
			>
			<TeamFigures totals={box.totals} size="lg" />
			<td class="rest" colspan={COLUMNS - 5}></td>
		</tr>
	</tbody>
	<tbody>
		<tr class="sect" id={BENCH_ANCHOR}><th colspan={COLUMNS} scope="rowgroup">{BOX.bench}</th></tr>
		{#each box.bench as entry (entry.row.key)}
			<BoxLine
				row={entry.row}
				tags={tagsOf(entry.row.boardId)}
				bench
				evidence
				move={entry.move}
				reserve={entry.row.reserve ? 'bench' : null}
			/>
		{:else}
			<tr><td class="empty" colspan={COLUMNS}>{noBench}</td></tr>
		{/each}
	</tbody>
	{#if box.reserve.length > 0}
		<tbody>
			<tr class="sect"><th colspan={COLUMNS} scope="rowgroup">{BOX.reserve}</th></tr>
			{#each box.reserve as row (row.key)}
				<BoxLine {row} tags={tagsOf(row.boardId)} bench evidence reserve="slot" />
			{/each}
		</tbody>
	{/if}
</table>

<style>
	.lineup {
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
	}

	.cols th {
		height: 32px;
		font-size: var(--t-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
		background: var(--bg);
		border-bottom: 1px solid var(--line);
		white-space: nowrap;
	}

	.cols .slot {
		width: 68px;
	}

	.cols .game {
		width: 200px;
	}

	.cols .num {
		width: 64px;
	}

	.cols .ev {
		width: 60px;
	}

	.cols .ev.first {
		width: 88px;
		padding-left: var(--s-3);
		border-left: 1px solid var(--line);
	}

	.cols .delta {
		width: 68px;
	}

	.cols .op {
		width: 44px;
	}

	.cols .n {
		text-align: right;
	}

	.n {
		text-align: right;
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.vh {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.whyline td {
		padding: 0 var(--s-3) var(--s-3) var(--s-2);
		font-size: var(--t-sm);
		color: var(--ink);
		font-variant-numeric: tabular-nums;
		background: color-mix(in srgb, var(--accent) 8%, var(--surface));
		border-bottom: 1px solid var(--line);
	}

	.whyline td:first-child {
		box-shadow: inset 3px 0 0 var(--accent);
	}

	.whyline td + td {
		padding-left: calc(32px + var(--s-3));
	}

	.nobody td {
		height: var(--row-h);
		padding: 0 var(--s-2);
		color: var(--ink-3);
		background: color-mix(in srgb, var(--loss-bg) 35%, var(--surface));
		border-bottom: 1px solid var(--line);
		font-size: var(--t-sm);
	}

	.nobody .slot-word {
		padding-left: var(--s-3);
		font-family: var(--font-num);
		font-size: var(--t-md);
		font-weight: 700;
		color: var(--ink-2);
	}

	.nobody .n {
		text-align: right;
		font-family: var(--font-num);
	}

	.totals td {
		height: 56px;
		padding: 0 var(--s-2);
		background: var(--scoreboard);
		color: var(--scoreboard-ink);
	}

	.tl {
		font-family: var(--font-num);
		font-size: var(--t-lg);
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.tsub {
		margin-left: var(--s-3);
		font-size: var(--t-xs);
		color: var(--scoreboard-ink-2);
	}

	.sect th {
		height: 32px;
		padding-left: var(--s-3);
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
		background: var(--bg);
		border-bottom: 1px solid var(--line);
	}

	.empty {
		padding: var(--s-3);
		color: var(--ink-2);
		border-bottom: 1px solid var(--line);
	}

	@media (max-width: 760px) {
		/* Fixed on a phone: the heads set each column, the player takes the rest, so no row widens the
		   table past the screen. */
		.lineup {
			table-layout: fixed;
		}

		/* The game and the evidence fold under the name on a phone: their columns keep their places
		   at no width, so every row's cells and the head still line up. */
		.cols .game {
			width: 0;
			padding: 0;
			font-size: 0;
		}

		.cols .slot {
			width: 46px;
		}

		/* Wide enough for the Team row's 101.6 at its size with the cell's padding (Lane 83). */
		.cols .num {
			width: 58px;
		}

		/* Wide enough for a total such as 101.6 beside its Proj, with a gap between them (Lane 79 fix 9). */
		.cols .num.pts {
			width: 40px;
		}

		.cols .op {
			width: 34px;
		}

		.whyline td + td {
			padding-left: var(--s-2);
		}
	}

	@media (max-width: 900px) {
		.cols .ev,
		.cols .ev.first,
		.cols .delta {
			width: 0;
			padding: 0;
			font-size: 0;
			border-left: 0;
		}
	}
</style>
