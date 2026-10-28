<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import PositionPill from '#lib/ui/PositionPill.svelte';
	import {
		BOX,
		boxNumber,
		deltaWord,
		easeOf,
		oppRankWord,
		reserveRow,
		type BoxPick,
		type BoxRow
	} from './box.ts';
	import type { Move } from './lineup.ts';
	import MoveMark from './MoveMark.svelte';
	import BoxGame from './BoxGame.svelte';
	import BoxPlayer from './BoxPlayer.svelte';

	/** One player's row of a box score: the slot, his face (a defense's club mark), his name on a line
	 * of its own, under it his club and Lane 63's status pill (his position and rank, and his status
	 * when the report lists him), his game in one cell, this week's projection and his points so far.
	 * On a phone the game cell folds under the pill, so a long name wraps rather than cuts. */
	interface Props {
		row: BoxRow;
		/** A bench row: shorter and quieter. */
		bench?: boolean;
		/** Your sheet's tags on him, as the league's rows mark them (review L7). */
		tags?: readonly string[];
		/** The Lineup's columns after Pts (Lane 66e): Opp rank, Avg, Last, the projection's change and
		 * the cell that opens a swap's evidence line. */
		evidence?: boolean;
		/** A row the advice moves, marked in its slot cell. */
		move?: Move | null;
		/** A spot no one who can play this week fills: the member's player, left there, muted. */
		idle?: boolean;
		/** A swap's evidence line, opened by its button: its row's id, whether it is open. */
		why?: { id: string; open: boolean; toggle: () => void } | null;
		/** The Waivers table (Lane 66f) has no slot and no points so far: these drop their cells. */
		slotCell?: boolean;
		ptsCell?: boolean;
		/** The cells after the evidence in place of the evidence line's button (the Waivers table's
		 * Rest of season, Beats and Add). */
		tail?: Snippet;
		/** More for the phone's evidence line: "Rest of season 8.4". */
		phoneMore?: string | null;
		/** "Clears Wed", after the kickoff in the game's first line, where the platform says it. */
		clears?: string | null;
		/** A row the decision names: the accent tint and edge, as a move in. */
		marked?: boolean;
		/** A row of the panel under another row (the Waivers drop choices): set in, quieter ground. */
		nested?: boolean;
		/** The Trades screen's last column (Lane 66g): his rest-of-season points a game, in place of
		 * the projection's change and the evidence line's button. */
		season?: boolean;
		/** The trade builder's columns (Lane 66g): his game folds under his name at every width, and
		 * the slot and Pts are left out (a roster, not a lineup), so two boxes sit side by side. */
		compact?: boolean;
		/** The trade builder's tick (Lane 66g), first in the row. */
		pick?: BoxPick | null;
		/** A narrow phone cell prints his short form, "A. Rodgers", never a cut surname (rereview N2). */
		/** The phone's game line draws the expected score and weather (BoxPlayer phoneFacts). */
		phoneFacts?: boolean;
		/** The phone's evidence line leads with Opp rank (false in the trade builder, whose phone basis
		 * cannot hold its sentence: a figure drawn keeps its sentence, review H2). */
		phoneOpp?: boolean;
		shortOnPhone?: boolean;
		/** Whether the row draws Proj and its change: not on a page whose week has no published
		 * projection read yet (Lane 95), whose cells would all be "--". */
		projCells?: boolean;
		/** His position chip in its own cell after the player, under the Our rank head (the Matchup and
		 * the Lineup, Lane 99 B24). */
		rankCell?: boolean;
		/** A player on injured reserve (Lane 98, B34): on the bench his game cell says why he is a drop,
		 * in the IR slot it is empty; neither draws his matchup (Opp rank), the slot no points. */
		reserve?: 'bench' | 'slot' | null;
		/** The Game cell's expected score and weather under the opponent; the trade builder's rows leave
		 * them out, so a row keeps the box-score height (Lane 268). */
		gameFacts?: boolean;
		/** A Waivers stash row's Game cell (Lane 118, B79): "Back week 9" in place of his game, with no
		 * matchup, Proj or points, as an IR slot row draws none. */
		away?: string | null;
	}

	let {
		row,
		bench = false,
		tags = [],
		evidence = false,
		move = null,
		why = null,
		idle = false,
		slotCell = true,
		ptsCell = true,
		tail,
		phoneMore = null,
		clears = null,
		marked = false,
		nested = false,
		season = false,
		compact = false,
		pick = null,
		shortOnPhone = false,
		phoneFacts = true,
		phoneOpp = true,
		projCells = true,
		rankCell = false,
		reserve = null,
		gameFacts = true,
		away = null
	}: Props = $props();
	/** The row as drawn: an IR row, or a stash, without its matchup (reserveRow). */
	const drawn = $derived(reserveRow(row, reserve ?? (away === null ? null : 'slot')));
	const note = $derived(away ?? (reserve === 'bench' ? BOX.irBench : null));
	const picked = $derived(pick?.state === 'on');
	const rank = $derived(drawn.evidence.oppRank);
	/** The Opp rank's colour, while his game is still to come (Lane 99, B56): on a game played it is
	 * decoration. */
	const ease = $derived(
		rank !== null && drawn.toCome ? easeOf(rank, drawn.evidence.oppOf) : 'even'
	);
	/** The phone's evidence line's own words and separator, so the template adds no space. */
	const oppLead = `${BOX.opp} `;
	const SEPARATOR = ', ';
	/** "Avg 15.2", "Last 0.8": the phone's evidence after the opponent's rank, each label with its
	 * figure, so a line breaks only at a separator and never between "Last" and its figure or inside
	 * "--" (Lane 83 review 2). */
	const seasonPairs = $derived([
		`${BOX.avg} ${boxNumber(drawn.evidence.avg)}`,
		`${BOX.last} ${boxNumber(drawn.evidence.last)}`,
		...(phoneMore === null ? [] : [phoneMore])
	]);
</script>

{#snippet seasonLine()}
	<!-- The separators are expressions, so the template's own line breaks add no space (review L7). -->
	<span class="phone-ev"
		>{#if rank !== null && phoneOpp}<span class="pair"
				>{oppLead}<span class="rk {ease}">{oppRankWord(rank)}</span></span
			>{SEPARATOR}{/if}{#each seasonPairs as pair, i (i)}{#if i > 0}{SEPARATOR}{/if}<span
				class="pair">{pair}</span
			>{/each}</span
	>
{/snippet}

<tr
	data-player={row.boardId}
	class:bench
	class:moved-in={move === 'in' || marked}
	class:moved-out={move === 'out'}
	class:open={why?.open === true}
	class:idle
	class:nested
	class:compact
	class:picked
	class:dropped={pick?.state === 'drop'}
>
	{#if pick}
		<td class="tk">
			{#if pick.state === 'drop'}
				<span class="drop-mark">{BOX.drop}</span>
			{:else if pick.state === 'no'}
				<span class="tick no" aria-hidden="true"></span>
			{:else}
				<button
					type="button"
					class="tick"
					class:on={picked}
					aria-pressed={picked}
					aria-label="{BOX.pick} {row.name}"
					disabled={pick.disabled}
					onclick={pick.toggle ?? undefined}
					>{#if picked}<Icon name="check" size={14} />{/if}</button
				>
			{/if}
		</td>
	{/if}
	{#if slotCell && !compact}
		<td class="slot"
			><span class="sl"
				>{#if move}<MoveMark {move} />{/if}{row.slot}</span
			></td
		>
	{/if}
	<td class="player">
		<BoxPlayer
			row={drawn}
			{tags}
			{shortOnPhone}
			fitOnPhone={rankCell}
			{compact}
			{clears}
			{phoneFacts}
			{note}
			rankApart={rankCell}
			>{#if evidence}{@render seasonLine()}{/if}</BoxPlayer
		>
	</td>
	{#if rankCell}
		<!-- His place in our order alone: unranked (or a defense) is "--", and a season-long list's
		     word stays in his status chip, never here (fix round 1, MEDIUM-2); an injured reserve row
		     leaves it empty (Lane 98's IR rows). On a phone the cell prints the rank alone and the club
		     line his position, so the name keeps its line (Lane 108, B83). -->
		<td class="rank" data-position={drawn.position}
			>{#if reserve !== null}{:else if drawn.pill && drawn.pill.rank !== null}<span class="chip"
					><PositionPill position={drawn.pill.position} rank={drawn.pill.rank} /></span
				><span class="rank-n">{drawn.pill.rank}</span>{:else}<span class="none">{BOX.none}</span
				>{/if}</td
		>
	{/if}
	{#if !compact}<td class="game"><BoxGame row={drawn} facts={gameFacts} {clears} {note} /></td>{/if}
	{#if projCells}<td class="n proj">{boxNumber(drawn.proj)}</td>{/if}
	{#if ptsCell && !compact}<td class="n pts" class:none={drawn.pts === null}
			>{boxNumber(drawn.pts)}</td
		>{/if}
	{#if evidence}
		<td class="n ev first"
			>{#if rank !== null}<span class="rk {ease}">{oppRankWord(rank)}</span>{:else}<span
					class="none">{BOX.none}</span
				>{/if}</td
		>
		<td class="n ev">{boxNumber(drawn.evidence.avg)}</td>
		<td class="n ev">{boxNumber(drawn.evidence.last)}</td>
	{/if}
	{#if season}
		<td class="n season">{boxNumber(drawn.evidence.season)}</td>
	{:else if evidence}
		{#if projCells}<td class="n ev delta">{deltaWord(drawn.evidence.delta)}</td>{/if}
		{#if tail}{@render tail()}{:else}
			<td class="op"
				>{#if why}<button
						type="button"
						class="why"
						aria-expanded={why.open}
						aria-controls={why.id}
						aria-label="{BOX.why} {row.name}"
						onclick={why.toggle}><Icon name="chevron" size={16} /></button
					>{/if}</td
			>
		{/if}
	{/if}
</tr>

<style>
	/* The player a player page sent here (?player=, asked.ts), marked in the accent's rule. */
	tr:global([data-asked]) td {
		box-shadow:
			inset 0 2px 0 var(--accent),
			inset 0 -2px 0 var(--accent);
	}

	td {
		padding: 6px var(--s-2);
		border-bottom: 1px solid var(--line);
		vertical-align: middle;
	}

	tr {
		height: var(--row-h);
	}

	tr:hover td {
		background: var(--surface-2);
	}

	.moved-in td {
		background: color-mix(in srgb, var(--accent) 8%, var(--surface));
	}

	.moved-in td:first-child {
		box-shadow: inset 3px 0 0 var(--accent);
	}

	.moved-out td {
		background: color-mix(in srgb, var(--ink) 4%, var(--surface));
	}

	.moved-out td:first-child {
		box-shadow: inset 3px 0 0 var(--line-strong);
	}

	.nested td {
		background: var(--surface-2);
	}

	.nested td:nth-child(1) {
		padding-left: var(--s-5);
	}

	.nested.moved-in td {
		background: color-mix(in srgb, var(--accent) 10%, var(--surface-2));
	}

	.idle td {
		color: var(--ink-3);
		background: color-mix(in srgb, var(--loss-bg) 35%, var(--surface));
	}

	.open td {
		border-bottom-color: transparent;
	}

	.sl {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.ev {
		font-size: var(--t-md);
		font-weight: 600;
		color: var(--ink-2);
	}

	.ev.first {
		border-left: 1px solid var(--line);
		padding-left: var(--s-3);
	}

	.delta {
		color: var(--ink-3);
		font-size: var(--t-sm);
	}

	.rk {
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		min-width: 40px;
		height: 22px;
		padding: 0 6px;
		border-radius: var(--r-sm);
	}

	/* A rank drawn without its colour sits flush, so its comma on the phone's line follows it. */
	.rk.even {
		padding: 0;
		min-width: 0;
	}

	.rk.easy {
		background: var(--gain-bg);
		color: var(--gain-ink);
	}

	.rk.hard {
		background: var(--loss-bg);
		color: var(--loss-ink);
	}

	.op {
		width: 40px;
		padding: 0 var(--s-1);
		text-align: center;
	}

	.why {
		display: inline-grid;
		place-items: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: transparent;
		color: var(--ink-2);
		cursor: pointer;
	}

	.why[aria-expanded='true'] {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--bg);
	}

	.why[aria-expanded='true'] :global(svg) {
		transform: rotate(180deg);
	}

	.phone-ev {
		display: none;
	}

	.slot {
		font-family: var(--font-num);
		font-size: var(--t-md);
		font-weight: 700;
		letter-spacing: 0.03em;
		color: var(--ink-2);
		white-space: nowrap;
	}

	.game {
		font-size: var(--t-sm);
	}

	.rank {
		white-space: nowrap;
	}

	/* The rank alone, a phone's (B83). */
	.rank-n {
		display: none;
	}

	.n {
		text-align: right;
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.proj {
		font-size: var(--t-lg);
		font-weight: 700;
	}

	.pts {
		font-size: var(--t-lg);
		font-weight: 700;
	}

	.none {
		color: var(--ink-3);
		font-weight: 600;
	}

	.bench {
		height: 46px;
	}

	.bench .proj {
		font-size: var(--t-md);
		color: var(--ink-2);
	}

	.bench .pts {
		font-size: var(--t-md);
	}

	.season {
		font-size: var(--t-lg);
		font-weight: 700;
	}

	.tk {
		width: 36px;
		padding: 0;
		text-align: center;
	}

	.tick {
		display: inline-grid;
		place-items: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border: 1.5px solid var(--ink-3);
		border-radius: 5px;
		background: transparent;
		color: var(--accent-ink);
		cursor: pointer;
		vertical-align: middle;
	}

	.tick.on {
		background: var(--accent);
		border-color: var(--accent);
	}

	.tick:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}

	.tick.no {
		border-style: dashed;
		border-color: var(--line-strong);
		cursor: default;
	}

	.tick:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}

	.drop-mark {
		display: inline-flex;
		align-items: center;
		height: 20px;
		padding: 0 5px;
		border-radius: var(--r-sm);
		background: var(--loss-bg);
		color: var(--loss-ink);
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.picked td {
		background: color-mix(in srgb, var(--accent) 10%, var(--surface));
	}

	.picked td:first-child {
		box-shadow: inset 3px 0 0 var(--accent);
	}

	.dropped td {
		background: color-mix(in srgb, var(--loss-ink) 7%, var(--surface));
	}

	.dropped td:first-child {
		box-shadow: inset 3px 0 0 var(--loss-ink);
	}

	@media (max-width: 760px) {
		td {
			padding: 7px 6px;
		}

		tr {
			height: auto;
		}

		.game {
			width: 0;
			max-width: 0;
			padding: 0;
			overflow: hidden;
		}

		td.game > :global(*) {
			display: none;
		}

		.proj,
		.pts {
			font-size: var(--t-md);
		}

		/* The chip keeps its own width and gives the player the rest (Lane 99): the rank cell's own
		   padding is the gap after the name. */
		.rank {
			padding-inline: 2px;
		}

		/* The rank alone under the Our rank head, his position beside his club (BoxPlayer), so the
		   cell gives the name its room (Lane 108, B83). */
		.rank .chip {
			display: none;
		}

		.rank .rank-n {
			display: inline;
			font-family: var(--font-num);
			font-size: var(--t-md);
			font-weight: 700;
			font-variant-numeric: tabular-nums;
		}

		.player:has(+ .rank) {
			padding-right: 2px;
			padding-left: 4px;
		}

		/* The slot word a size down beside the Our rank boxes' names (Lane 108, B83). */
		.slot:has(+ .player + .rank) {
			font-size: var(--t-sm);
			letter-spacing: 0;
		}

		.op {
			width: 30px;
			padding: 0 1px;
		}

		.why {
			width: 28px;
			height: 28px;
		}
	}

	/* Below a wide screen the evidence folds under the name, one short line, as on a phone: its
	   columns keep their places at no width. */
	@media (max-width: 900px) {
		.ev,
		.ev.first {
			width: 0;
			max-width: 0;
			padding: 0;
			overflow: hidden;
			font-size: 0;
			border-left: 0;
		}

		.ev > * {
			display: none;
		}

		.phone-ev {
			display: block;
			font-size: var(--t-xs);
			color: var(--ink-3);
			font-variant-numeric: tabular-nums;
		}

		/* A label and its figure never part across lines. */
		.phone-ev .pair {
			white-space: nowrap;
		}

		.phone-ev .rk {
			height: auto;
			min-width: 0;
			padding: 0 3px;
			font-weight: 700;
		}

		.phone-ev .rk.even {
			padding: 0;
		}
	}
</style>
