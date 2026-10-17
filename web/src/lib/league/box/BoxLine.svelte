<script lang="ts">
	import Icon from '#lib/ui/Icon.svelte';
	import { BOX, boxNumber, deltaWord, easeOf, oppRankWord, type BoxRow } from './box.ts';
	import BoxGame from './BoxGame.svelte';
	import BoxPlayer from './BoxPlayer.svelte';
	import type { Move } from './lineup.ts';
	import MoveMark from './MoveMark.svelte';

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
	}

	let {
		row,
		bench = false,
		tags = [],
		evidence = false,
		move = null,
		why = null,
		idle = false
	}: Props = $props();
	const rank = $derived(row.evidence.oppRank);
	/** The phone's evidence line's own words and separator, so the template adds no space. */
	const oppLead = `${BOX.opp} `;
	const SEPARATOR = ', ';
	/** "Avg 15.2, Last 0.8": the phone's evidence after the opponent's rank. */
	const seasonWords = $derived(
		`${BOX.avg} ${boxNumber(row.evidence.avg)}, ${BOX.last} ${boxNumber(row.evidence.last)}`
	);
</script>

{#snippet seasonLine()}
	<!-- The separators are expressions, so the template's own line breaks add no space (review L7). -->
	<span class="phone-ev"
		>{#if rank !== null}{oppLead}<span class="rk {easeOf(rank, row.evidence.oppOf)}"
				>{oppRankWord(rank)}</span
			>{SEPARATOR}{/if}{seasonWords}</span
	>
{/snippet}

<tr
	class:bench
	class:moved-in={move === 'in'}
	class:moved-out={move === 'out'}
	class:open={why?.open === true}
	class:idle
>
	<td class="slot"
		><span class="sl"
			>{#if move}<MoveMark {move} />{/if}{row.slot}</span
		></td
	>
	<td class="player">
		<BoxPlayer {row} {tags}
			>{#if evidence}{@render seasonLine()}{/if}</BoxPlayer
		>
	</td>
	<td class="game"><BoxGame {row} /></td>
	<td class="n proj">{boxNumber(row.proj)}</td>
	<td class="n pts" class:none={row.pts === null}>{boxNumber(row.pts)}</td>
	{#if evidence}
		<td class="n ev first"
			>{#if rank !== null}<span class="rk {easeOf(rank, row.evidence.oppOf)}"
					>{oppRankWord(rank)}</span
				>{:else}<span class="none">{BOX.none}</span>{/if}</td
		>
		<td class="n ev">{boxNumber(row.evidence.avg)}</td>
		<td class="n ev">{boxNumber(row.evidence.last)}</td>
		<td class="n ev delta">{deltaWord(row.evidence.delta)}</td>
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
</tr>

<style>
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

		.game > :global(*) {
			display: none;
		}

		.proj,
		.pts {
			font-size: var(--t-md);
		}

		.op {
			width: 34px;
			padding: 0 2px;
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

		.phone-ev .rk {
			height: auto;
			min-width: 0;
			padding: 0 3px;
			font-weight: 700;
		}
	}
</style>
