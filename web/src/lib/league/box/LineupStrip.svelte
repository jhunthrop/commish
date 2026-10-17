<script lang="ts">
	import { links } from '#lib/site/links.ts';
	import { changesTitle, LINEUP, stripSum, type LineupBox } from './lineup.ts';
	import MoveMark from './MoveMark.svelte';

	/** The Lineup's decision as a strip (Lane 66e): the board week, the count of changes, each swap as
	 * a chip ("QB, Williams in, Stroud out"), and what they add to the lineup as it is set now. The
	 * screen's one verb sits beside it. Past weeks live on Our record. */
	interface Props {
		week: number;
		box: LineupBox;
	}

	let { week, box }: Props = $props();
	const sum = $derived(stripSum(box));
</script>

<div class="strip">
	<div class="head">
		<span class="wk">Week {week}</span>
		<span class="title">{changesTitle(box.swaps.length)}</span>
	</div>
	{#if box.swaps.length > 0}
		<ul class="swaps">
			{#each box.swaps as swap (swap.key)}
				<li class="swap">
					<span class="slot">{swap.slot}</span>
					<span class="in"><MoveMark move="in" size={16} />{swap.in} in</span>
					{#if swap.out}<span class="out"><MoveMark move="out" size={16} />{swap.out} out</span
						>{/if}
				</li>
			{/each}
		</ul>
	{/if}
	<div class="sum">
		{#if sum}<b class="figure">{sum.figure}</b><span class="words"
				>{sum.words}{#if sum.gain}, <em>{sum.gain}</em>{/if}</span
			>{/if}
		<a class="past" href={links.record()}>{LINEUP.pastWeeks}</a>
	</div>
</div>

<style>
	.strip {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-2) var(--s-5);
		min-width: 0;
	}

	.head {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.wk {
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--accent-text);
	}

	.title {
		font-family: var(--font-num);
		font-size: var(--t-head);
		font-weight: 800;
		line-height: 1;
		text-transform: uppercase;
		letter-spacing: 0.01em;
		white-space: nowrap;
	}

	.swaps {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.swap {
		display: inline-flex;
		align-items: center;
		gap: var(--s-2);
		height: 34px;
		padding: 0 var(--s-3) 0 4px;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-pill);
		background: var(--bg);
		font-size: var(--t-sm);
		white-space: nowrap;
	}

	.slot {
		display: grid;
		place-items: center;
		height: 26px;
		min-width: 34px;
		padding: 0 6px;
		border-radius: var(--r-pill);
		background: var(--surface-2);
		font-family: var(--font-num);
		font-size: var(--t-sm);
		font-weight: 700;
		letter-spacing: 0.03em;
	}

	.in,
	.out {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.in {
		font-weight: 700;
		color: var(--ink);
	}

	.out {
		color: var(--ink-3);
	}

	.sum {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-left: auto;
		text-align: right;
	}

	.figure {
		font-family: var(--font-num);
		font-size: var(--t-xl);
		font-weight: 800;
		line-height: 1;
		color: var(--accent-text);
		font-variant-numeric: tabular-nums;
	}

	em {
		font-style: normal;
		font-weight: 700;
		color: var(--gain-ink);
	}

	.words {
		font-size: var(--t-xs);
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.past {
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	@media (max-width: 760px) {
		.strip {
			gap: var(--s-2) var(--s-3);
		}

		.title {
			font-size: var(--t-xl);
		}

		.swaps {
			flex-basis: 100%;
			order: 3;
			gap: 3px;
		}

		.swap {
			height: 24px;
			gap: 6px;
			padding-right: var(--s-2);
			font-size: var(--t-xs);
		}

		.slot {
			height: 18px;
			min-width: 28px;
			font-size: var(--t-xs);
		}

		.words {
			white-space: normal;
			font-size: var(--t-xs);
		}

		.past {
			display: none;
		}
	}
</style>
