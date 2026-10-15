<script lang="ts">
	import type { Snippet } from 'svelte';
	import { POSITIONS, type Position } from '#lib/types/player.ts';
	import PositionPill from '#lib/ui/PositionPill.svelte';
	import ToneChip from '#lib/ui/ToneChip.svelte';
	import ValueCell from '#lib/ui/ValueCell.svelte';
	import Label from '#lib/ui/Label.svelte';
	import type { LeagueBoard } from '../board.ts';
	import LeagueRow from '../LeagueRow.svelte';
	import { rowOf } from '../model.ts';
	import type { PlayerLine } from './types.ts';
	import {
		GAIN_DECIMALS,
		designationSitsHim,
		designationWords,
		gameWords,
		lastGamesWords
	} from './words.ts';

	/** One player of an in-season screen as a league row: his face and name (which opens his game
	 * log), his rank at his position on our order, his game this week, his designation with its
	 * stamp, his last games, and at the end his points over replacement, unless the screen ends the
	 * row on its own number. */
	interface Props {
		line: PlayerLine;
		board: LeagueBoard;
		tags?: readonly string[];
		/** A slot label before the row: "RB2", "Bench". */
		slot?: string;
		/** A last fact on the row's line, the screen's own: "for Jaylen Wright, RB58". */
		note?: string;
		trailing?: Snippet;
	}

	let { line, board, tags = [], slot, note, trailing }: Props = $props();

	const facts = $derived(line.facts);
	const game = $derived(gameWords(facts));
	const last = $derived(lastGamesWords(facts.last_games));
	const position = $derived(
		POSITIONS.includes(line.player.position as Position) ? (line.player.position as Position) : null
	);
</script>

{#snippet meta()}
	{#if position && line.position_rank !== null}
		<PositionPill {position} rank={line.position_rank} />
	{:else}
		<span>{line.player.position}</span>
	{/if}
	{#if line.player.team}<span>{line.player.team}</span>{/if}
	{#if game}<span class="fact">{game}</span>{/if}
	{#if facts.designation}
		<ToneChip tone={designationSitsHim(facts.designation) ? 'loss' : 'even'}
			>{designationWords(facts.designation)}</ToneChip
		>
	{/if}
	{#if last}<span class="fact">{last}</span>{/if}
	{#if note}<span class="note">{note}</span>{/if}
{/snippet}

{#snippet value()}
	{#if trailing}
		{@render trailing()}
	{:else if line.points_over_replacement !== null}
		<ValueCell
			value={line.points_over_replacement}
			label="over repl"
			signed
			decimals={GAIN_DECIMALS}
		/>
	{:else}
		<Label size="cell">Unranked</Label>
	{/if}
{/snippet}

<LeagueRow
	player={rowOf(board, line.player)}
	host={line.player}
	{tags}
	{slot}
	status={line.player.injured_reserve ? 'ir' : null}
	{meta}
	trailing={value}
/>

<style>
	.note {
		color: var(--ink);
		font-weight: 600;
	}

	.fact {
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
</style>
