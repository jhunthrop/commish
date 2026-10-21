<script lang="ts">
	import WeatherGlyph from '#lib/league/box/WeatherGlyph.svelte';
	import { CARD } from './card.ts';
	import type { NextCell } from './week-words.ts';

	/** The week ahead under the player card's name (Lane 66h), in the box's Game cell form: the week,
	 * his opponent or "Bye" with the kickoff, then the expected score and the weather while his game is
	 * still to be played. Shared by his page's card and the player shelf (Lane 113), which folds it
	 * into lines as a phone does. */
	interface Props {
		/** The week the card shows, null before his page's build is read (the shelf's first paint). */
		week: number | null;
		/** His opponent as the build says it ("at NYJ", "Bye"), under the cell's once read. */
		opponent: string | null;
		cell: NextCell | null;
		/** In lines at every width: the shelf's. */
		folded?: boolean;
	}

	let { week, opponent, cell, folded = false }: Props = $props();
</script>

<div class="nx" class:folded>
	{#if week !== null}<span class="wk">{CARD.week} {week}</span>{/if}
	<span class="opp"
		><b>{cell?.where ?? opponent}</b>{#if cell?.when}<span>{cell.when}</span>{/if}</span
	>
	<span class="facts"
		>{#if cell?.expected}<span class="exp">{cell.expected}</span>{/if}{#if cell?.weather}<span
				class="wx"><WeatherGlyph glyph={cell.weather.glyph} />{cell.weather.words}</span
			>{/if}</span
	>
</div>

<style>
	.nx {
		--nx-flow: column;
		--nx-align: stretch;
		--nx-gap: 3px;
		--nx-wk: auto;

		display: flex;
		flex-flow: var(--nx-flow);
		align-items: var(--nx-align);
		gap: var(--nx-gap);
	}

	/* In lines, set once for the shelf and once for a phone. */
	.nx.folded {
		--nx-flow: row wrap;
		--nx-align: baseline;
		--nx-gap: 4px var(--s-3);
		--nx-wk: 100%;
	}

	.wk {
		flex-basis: var(--nx-wk);
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--accent-text);
	}

	.opp {
		display: flex;
		gap: 6px;
		font-size: var(--t-md);
	}

	.opp span {
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}

	.facts {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		min-height: 1lh;
		font-size: var(--t-xs);
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}

	.exp {
		font-family: var(--font-num);
		font-size: var(--t-md);
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--ink-2);
	}

	.wx {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}

	@media (max-width: 760px) {
		.nx {
			--nx-flow: row wrap;
			--nx-align: baseline;
			--nx-gap: 4px var(--s-3);
			--nx-wk: 100%;
		}
	}
</style>
