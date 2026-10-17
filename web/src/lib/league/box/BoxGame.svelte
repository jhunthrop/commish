<script lang="ts">
	import { BOX, type BoxRow } from './box.ts';
	import WeatherGlyph from './WeatherGlyph.svelte';

	/** A box row's game in one cell (Lane 66d): the opponent and kickoff, or Bye, then the expected
	 * score with his club's first and the kickoff weather in two or three words. Shared by every box
	 * score's Game column and the phone's folded line under the name. */
	interface Props {
		row: Pick<BoxRow, 'game' | 'expected' | 'weather'>;
	}

	let { row }: Props = $props();
</script>

{#if row.game === 'bye'}
	<span class="bye">{BOX.bye}</span>
{:else if row.game}
	<span class="opp"><b>{row.game.where}</b> <span>{row.game.when}</span></span>
{/if}
{#if row.expected !== null || row.weather !== null}
	<span class="facts">
		{#if row.expected}<span class="exp">{row.expected}</span>{/if}
		{#if row.weather}<span class="wx"
				><WeatherGlyph glyph={row.weather.glyph} />{row.weather.words}</span
			>{/if}
	</span>
{/if}

<style>
	.opp {
		display: flex;
		gap: 4px;
		white-space: nowrap;
	}

	.opp b {
		font-weight: 600;
	}

	.opp span {
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}

	.facts {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		font-size: var(--t-xs);
		color: var(--ink-3);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.exp {
		font-family: var(--font-num);
		font-size: var(--t-sm);
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--ink-2);
	}

	.wx {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}

	.bye {
		display: inline-flex;
		align-items: center;
		height: 20px;
		padding: 0 var(--s-2);
		border-radius: var(--r-sm);
		background: var(--surface-2);
		color: var(--ink-2);
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
	}

	/* On a phone the cell folds under the name: its facts wrap and the expected score shrinks. */
	@media (max-width: 760px) {
		.facts {
			flex-wrap: wrap;
			white-space: normal;
			column-gap: var(--s-1);
		}

		.exp {
			font-size: var(--t-xs);
		}
	}
</style>
