<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		BOX,
		boxNumber,
		type BoxRow,
		type BoxStarter,
		type BoxTotals,
		figureCountWords
	} from './box.ts';
	import BoxLine from './BoxLine.svelte';
	import TeamAvatar from './TeamAvatar.svelte';

	/** One team's box score (Lane 66d): its name with its avatar over the columns (slot, player, game,
	 * this week's projection, points so far), its starters, a totals row lit like the score bug, and
	 * its bench below in the same columns. A lineup's change shows the starter we start over the one
	 * we sit, with the fact that tipped it. */
	interface Props {
		team: string;
		/** The drafter's own team: its edge and avatar in the accent. */
		mine?: boolean;
		starters: readonly BoxStarter[];
		bench: readonly BoxRow[];
		/** The bench rows a change sits, by key, on the change's wash. */
		benchSat?: ReadonlySet<string>;
		totals: BoxTotals;
		/** Said in place of the starters when the host shows none for this team. */
		empty?: string | null;
		/** The team's line beside its name: its score so far, its record. */
		aside?: Snippet;
		/** The team's avatar beside its name; a box titled for the drafter's own week leaves it out. */
		avatar?: boolean;
		/** Said under the bench's head when the bench is empty; without it an empty bench is left out. */
		noBench?: string | null;
	}

	let {
		team,
		mine = false,
		starters,
		bench,
		benchSat = new Set<string>(),
		totals,
		empty = null,
		aside,
		avatar = true,
		noBench = null
	}: Props = $props();

	const COLUMNS = 5;
</script>

<table class="box" class:mine aria-label={team}>
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
			<BoxLine row={entry.row} tone={entry.sits === undefined ? null : 'start'} />
			{#if entry.sits}<BoxLine row={entry.sits} tone="sit" />{/if}
			{#if entry.sentence}
				<tr class="why"><td colspan={COLUMNS}>{entry.sentence}</td></tr>
			{/if}
		{/each}
		<tr class="totals">
			<td colspan="3"
				><span class="tl">{BOX.totals}</span>{#if totals.count}<span class="tsub"
						>{figureCountWords(totals.count)}</span
					>{/if}</td
			>
			<td class="n proj">{boxNumber(totals.proj)}</td>
			<td class="n pts">{boxNumber(totals.pts)}</td>
		</tr>
	</tbody>
	{#if bench.length > 0 || noBench !== null}
		<tbody>
			<tr class="bhead"><th colspan={COLUMNS} scope="rowgroup">{BOX.bench}</th></tr>
			{#each bench as row (row.key)}
				<!-- A starter a change sits is on the change's wash here too, so the two read as one move. -->
				<BoxLine {row} bench tone={benchSat.has(row.key) ? 'sit' : null} />
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
	}

	.cols .slot {
		width: 48px;
	}

	.cols .game {
		width: 186px;
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

	.why td {
		padding: 0 var(--s-3) var(--s-3) 60px;
		font-size: var(--t-sm);
		color: var(--ink);
		background: var(--accent-wash);
		box-shadow: inset 4px 0 0 var(--accent);
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

	.totals .proj {
		font-size: var(--t-xl);
		font-weight: 700;
		color: var(--scoreboard-num);
	}

	.totals .pts {
		font-size: var(--t-xl);
		font-weight: 700;
		color: var(--scoreboard-ink-2);
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

	@media (max-width: 760px) {
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

		.cols .n {
			width: 50px;
		}

		.why td {
			padding-left: var(--s-3);
		}

		.totals .proj,
		.totals .pts {
			font-size: var(--t-lg);
		}
	}
</style>
