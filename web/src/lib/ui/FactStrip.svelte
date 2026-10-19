<script lang="ts">
	import type { FactCell } from './facts.ts';

	/** Facts as cells in one ruled strip (Lane 66o), where a sentence once listed them: the report's
	 * finish and settings, the setup's table, a pass's price and dates. */
	interface Props {
		/** Names the strip for assistive tech. */
		label: string;
		cells: readonly FactCell[];
		/** Tighter cells, for a strip inside a narrow panel: a plan's price and dates on one row. */
		dense?: boolean;
	}

	let { label, cells, dense = false }: Props = $props();
</script>

<dl class="facts" class:dense aria-label={label}>
	{#each cells as cell (cell.label)}
		<div class:mine={cell.mine}>
			<dt>{cell.label}</dt>
			<dd class:word={cell.word}>{cell.value}</dd>
		</div>
	{/each}
</dl>

<style>
	.facts {
		display: flex;
		flex-wrap: wrap;
		margin: 0;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--surface);
	}

	.facts div {
		display: flex;
		flex-direction: column-reverse;
		justify-content: flex-end;
		gap: 2px;
		padding: var(--s-2) var(--s-4);
		border-right: 1px solid var(--line);
	}

	.dense div {
		padding: var(--s-2) var(--s-3);
	}

	.facts div:last-child {
		border-right: 0;
	}

	dt {
		font-size: var(--t-xs);
		font-weight: 500;
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--ink-3);
	}

	dd {
		margin: 0;
		font-family: var(--font-num);
		font-weight: 700;
		font-size: 1.5rem;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	dd.word {
		font-family: var(--font-ui);
		font-size: var(--t-md);
		font-weight: 600;
		line-height: 1.5rem;
	}

	.mine dt,
	.mine dd {
		color: var(--accent-text);
	}

	/* On a phone the strip wraps: each cell grows to fill its row, so a row never stops short with a
	   rule standing in the open (Lane 87). The rules are each cell's left and top, pulled 1px out under
	   the strip's clip, so a rule stands only between two cells, whatever wraps. */
	@media (max-width: 760px) {
		.facts {
			overflow: hidden;
		}

		.facts div,
		.facts div:last-child {
			flex: 1 1 auto;
			padding: var(--s-2) var(--s-3);
			border-right: 0;
			border-left: 1px solid var(--line);
			border-top: 1px solid var(--line);
			margin: -1px 0 0 -1px;
		}

		dd {
			font-size: 1.25rem;
		}
	}
</style>
