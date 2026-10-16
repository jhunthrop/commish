<script lang="ts">
	import type { Snippet } from 'svelte';
	import { gameFactsLine } from '#lib/format/game-facts.ts';
	import { POSITIONS, type Position } from '#lib/types/player.ts';
	import PositionPill from '#lib/ui/PositionPill.svelte';
	import TagChip from '#lib/ui/TagChip.svelte';
	import ToneChip from '#lib/ui/ToneChip.svelte';
	import ValueCell from '#lib/ui/ValueCell.svelte';
	import Label from '#lib/ui/Label.svelte';
	import LeagueRow from '../LeagueRow.svelte';
	import type { PlayerLine } from './api.ts';
	import {
		GAIN_DECIMALS,
		HELD,
		LINES,
		designationSitsHim,
		designationWords,
		gameWords,
		hisPorWords,
		lastGamesWords,
		porFigure
	} from './words.ts';

	/** One player of an in-season screen as a league row: his face and name (which opens his game
	 * log, when he has a page), his rank at his position on our order, his game this week, his
	 * designation with its stamp, his last games, his game's facts (the expected score, the margin, the
	 * roof and the kickoff weather, with their read time) while it is still to be played, and at the end
	 * his points over replacement a week.
	 * A screen that ends the row on its own number (a waiver's gain to your lineup) keeps his points
	 * over replacement on his line, said as his. Everything comes from the API's line: no board is
	 * read. On a phone the cell drops its label, as the league page's rows do, and the facts wrap
	 * under his name rather than run under the cell. */
	interface Props {
		line: PlayerLine;
		tags?: readonly string[];
		/** A slot label before the row: "RB2", "Bench". */
		slot?: string;
		/** A last fact on the row's line, the screen's own: "drop Jaylen Wright, RB58". */
		note?: string;
		trailing?: Snippet;
		/** Whether a phone shows his game's facts: the waiver and trade rows keep to their decision there,
		 * so the first row stays whole above the pinned verb. */
		factsOnPhone?: boolean;
	}

	let { line, tags = [], slot, note, trailing, factsOnPhone = true }: Props = $props();

	const facts = $derived(line.facts);
	const game = $derived(gameWords(facts));
	const last = $derived(lastGamesWords(facts.last_games));
	const conditions = $derived(facts.played || facts.bye ? null : gameFactsLine(facts));
	const position = $derived(
		POSITIONS.includes(line.player.position as Position) ? (line.player.position as Position) : null
	);
	const por = $derived(line.points_over_replacement);
	const none = $derived(por !== null && porFigure(por) === porFigure(0));
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
	{#if trailing && por !== null}
		<span class="fact his">{hisPorWords(por)}</span>
	{/if}
	{#if line.held}<TagChip label={HELD} />{/if}
	{#if note}<span class="note">{note}</span>{/if}
	{#if conditions}<span class="conditions" class:desk={!factsOnPhone}>{conditions}</span>{/if}
{/snippet}

{#snippet value()}
	{#if trailing}
		{@render trailing()}
	{:else if por !== null}
		<!-- A figure that rounds to nothing prints "0.0", with no sign. -->
		<ValueCell
			value={none ? 0 : por}
			label={LINES.overRepl}
			phoneLabel={false}
			signed={!none}
			decimals={GAIN_DECIMALS}
		/>
	{:else}
		<Label size="cell">{LINES.unranked}</Label>
	{/if}
{/snippet}

<LeagueRow
	player={null}
	host={line.player}
	face={{ headshot: line.headshot, slug: line.slug }}
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

	/* The game's facts are a sentence: a line of their own under the row's short facts. */
	.conditions {
		flex-basis: 100%;
		font-variant-numeric: tabular-nums;
	}

	/* On a phone a row that ends on its own number keeps to its game and last games: his own figure
	   is at a desk's width, beside the gain it is told apart from. */
	@media (max-width: 760px) {
		.his,
		.desk {
			display: none;
		}
	}
</style>
