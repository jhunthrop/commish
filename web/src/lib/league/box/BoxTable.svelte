<script lang="ts">
	import type { Snippet } from 'svelte';
	import { BOX, type BoxRow, type BoxStarter, type BoxTotals } from './box.ts';
	import BoxLine from './BoxLine.svelte';
	import TeamFigures from './TeamFigures.svelte';
	import TeamAvatar from './TeamAvatar.svelte';

	/** One team's box score (Lane 66d): its name with its avatar over the columns (slot, player, our
	 * rank, game, this week's projection, points so far), its starters, a totals row lit like the score bug, and
	 * its bench below in the same columns (the Matchup's two boxes; the Lineup's table is
	 * LineupTable). */
	interface Props {
		team: string;
		/** The drafter's own team: its edge and avatar in the accent. */
		mine?: boolean;
		starters: readonly BoxStarter[];
		bench: readonly BoxRow[];
		totals: BoxTotals;
		/** Said in place of the starters when the host shows none for this team. */
		empty?: string | null;
		/** The team's line beside its name: its score so far, its record. */
		aside?: Snippet;
		/** The team's avatar beside its name; a box titled for the drafter's own week leaves it out. */
		avatar?: boolean;
		/** Said under the bench's head when the bench is empty; without it an empty bench is left out. */
		noBench?: string | null;
		/** Your sheet's tags on a player, by board id: the drafter's own box only. */
		tagsOf?: (boardId: string | null) => readonly string[];
		/** The position chip in its own column under the Our rank head, its sentence in the screen's
		 * basis (the Matchup, Lane 99 B24); the League page's lineup keeps it under the name. */
		ranked?: boolean;
	}

	let {
		team,
		mine = false,
		starters,
		bench,
		totals,
		empty = null,
		aside,
		avatar = true,
		noBench = null,
		tagsOf = () => [],
		ranked = false
	}: Props = $props();

	const COLUMNS = $derived(ranked ? 6 : 5);
</script>

<table class="box" class:mine aria-label={team}>
	<!-- The phone's fixed layout reads its widths here: the team's name heads the box in one cell. -->
	<colgroup>
		<col class="c-slot" />
		<col />
		{#if ranked}<col class="c-rank" />{/if}
		<col class="c-game" />
		<col class="c-n" />
		<col class="c-n" />
	</colgroup>
	<thead>
		<tr class="team">
			<th colspan={COLUMNS}>
				<span class="tm">
					{#if avatar}<TeamAvatar name={team} size={32} me={mine} />{/if}
					<span class="tn">{team}</span>
					{#if mine}<span class="you">{BOX.you}</span>{/if}
					{#if aside}<span class="aside">{@render aside()}</span>{/if}
				</span>
			</th>
		</tr>
		<tr class="cols">
			<th class="slot" scope="col">{BOX.slot}</th>
			<th scope="col">{BOX.player}</th>
			{#if ranked}<th class="rank" scope="col">{BOX.ourRank}</th>{/if}
			<th class="game" scope="col">{BOX.game}</th>
			<th class="n" scope="col">{BOX.proj}</th>
			<th class="n" scope="col">{BOX.pts}</th>
		</tr>
	</thead>
	<tbody>
		{#if empty !== null && starters.length === 0}
			<tr><td class="empty" colspan={COLUMNS}>{empty}</td></tr>
		{/if}
		{#each starters as entry (entry.row.key)}
			<BoxLine row={entry.row} tags={tagsOf(entry.row.boardId)} rankCell={ranked} />
		{/each}
		<tr class="totals">
			<td colspan={COLUMNS - 2}
				><span class="tl">{BOX.totals}</span>{#if totals.note}<span class="tsub">{totals.note}</span
					>{/if}</td
			>
			<TeamFigures {totals} />
		</tr>
	</tbody>
	{#if bench.length > 0 || noBench !== null}
		<tbody>
			<tr class="bhead"><th colspan={COLUMNS} scope="rowgroup">{BOX.bench}</th></tr>
			{#each bench as row (row.key)}
				<BoxLine {row} tags={tagsOf(row.boardId)} bench rankCell={ranked} />
			{:else}
				<tr><td class="empty" colspan={COLUMNS}>{noBench}</td></tr>
			{/each}
		</tbody>
	{/if}
</table>

<style>
	.box {
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

	.team th {
		padding: var(--s-3);
		background: var(--bg);
		border-bottom: 2px solid var(--line-strong);
	}

	.mine .team th {
		border-bottom-color: var(--accent);
	}

	.tm {
		display: flex;
		align-items: center;
		gap: var(--s-3);
		min-width: 0;
	}

	.tn {
		font-weight: 700;
		font-size: var(--t-md);
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.you {
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--accent-text);
	}

	.aside {
		margin-left: auto;
		font-size: var(--t-sm);
		font-weight: 500;
		color: var(--ink-2);
		white-space: nowrap;
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

	.cols .slot {
		width: 48px;
	}

	/* Sized to the chip ("WR 149"), its head on two lines so the head never sets the column (Lane 108
	   fix round 1): two boxes side by side keep each name and "at LAR Final" on a line inside their
	   columns. */
	.cols .rank {
		width: 52px;
		white-space: normal;
		line-height: 1.1;
	}

	/* Narrow enough beside the Our rank column that two boxes side by side keep a name on a line. */
	.cols .game {
		width: 140px;
	}

	.cols .n {
		width: 60px;
		text-align: right;
		font-family: var(--font-ui);
	}

	.n {
		text-align: right;
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.empty {
		padding: var(--s-3);
		color: var(--ink-2);
		border-bottom: 1px solid var(--line);
	}

	/* The totals row is the score bug's board: lit numbers on black in both themes. */
	.totals td {
		height: 52px;
		padding: 0 var(--s-2);
		background: var(--scoreboard);
		color: var(--scoreboard-ink);
	}

	.tsub {
		margin-left: var(--s-3);
		font-size: var(--t-xs);
		color: var(--scoreboard-ink-2);
	}

	.tl {
		font-family: var(--font-num);
		font-size: var(--t-md);
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.bhead th {
		height: 30px;
		font-size: var(--t-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
		background: var(--bg);
		border-bottom: 1px solid var(--line);
	}

	/* At a desk a name keeps to one line (fix round 1, HIGH-2): the box is two side by side. */
	@media (min-width: 761px) {
		.box :global(.nm) {
			white-space: nowrap;
		}

		/* The game cell gives way first: its facts wrap before a name would, and its opponent keeps
		   his game's state beside the club ("at LAR Final", Lane 108, B83). */
		.box :global(.facts) {
			flex-wrap: wrap;
			white-space: normal;
			column-gap: 4px;
		}

		/* The Team row's "Proj final" caption on two lines over its figure, so the caption never sets
		   the Proj column and the box keeps inside its column (Lane 108 fix round 1). */
		.box .totals :global(small) {
			white-space: normal;
		}
	}

	@media (max-width: 760px) {
		/* Fixed on a phone: the heads set each column, the player takes the rest, so no long name
		   widens the box past the screen beside the Our rank column (Lane 99). */
		.box {
			table-layout: fixed;
		}

		.c-slot {
			width: 38px;
		}

		.c-rank {
			width: 36px;
		}

		.c-game {
			width: 0;
		}

		.c-n {
			width: 50px;
		}

		/* The game folds under the name on a phone: its column keeps its place in the table, at no
		   width, so every row's cells and the header's spans still line up. */
		.cols .game {
			width: 0;
			padding: 0;
			font-size: 0;
		}

		.cols .slot {
			width: 38px;
		}

		/* Its head on two lines over the rank alone (Lane 108, B83), so the player keeps the room for his
		   name. */
		.cols .rank {
			width: 36px;
			white-space: normal;
			line-height: 1.1;
		}

		.cols .n {
			width: 50px;
		}
	}
</style>
