<script lang="ts">
	import { COLUMN_HEADS, type BoardColumns, type ColumnKey } from './board-columns.ts';
	import { isSortKey, type Sort, type SortKey } from './board-sort.ts';

	/** The column heads over a run of Rows, on the same grid: each figure's unit said once, here, never
	 * in the rows (Lane 66n). Given a sort, the heads that sort are buttons and the sorted one is marked. */
	interface Props {
		columns: BoardColumns;
		/** The rows' order, when the view sorts. */
		sort?: Sort;
		onsort?: (key: SortKey) => void;
	}

	let { columns, sort, onsort }: Props = $props();

	const LEFT: ReadonlySet<ColumnKey> = new Set(['player', 'range']);
</script>

<div class="head">
	{#each columns.keys as key (key)}
		{@const head = COLUMN_HEADS[key]}
		{@const sorts = onsort !== undefined && isSortKey(key)}
		<span
			class="h {columns.cells[key]}"
			class:left={LEFT.has(key)}
			aria-sort={sort?.key === key ? (sort.turned ? 'descending' : 'ascending') : undefined}
		>
			{#if sorts && isSortKey(key)}
				<button
					type="button"
					class:on={sort?.key === key}
					title={head.title}
					onclick={() => onsort(key)}
					>{#if head.short}<span class="full">{head.text}</span><span class="short"
							>{head.short}</span
						>{:else}{head.text}{/if}{#if head.note}<span class="note">{head.note}</span
						>{/if}</button
				>
			{:else if head.text !== ''}
				<span title={head.title}
					>{#if head.short}<span class="full">{head.text}</span><span class="short"
							>{head.short}</span
						>{:else}{head.text}{/if}{#if head.note}<span class="note">{head.note}</span>{/if}</span
				>
			{/if}
		</span>
	{/each}
</div>

<style>
	.head {
		display: grid;
		grid-template-columns: var(--cols-desk);
		align-items: end;
		column-gap: var(--s-2);
		min-height: 32px;
		padding: 0 var(--s-3) 6px;
		border-bottom: 1px solid var(--line-strong);
	}

	.h {
		display: flex;
		justify-content: flex-end;
		min-width: 0;
		font-size: var(--t-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
		/* A head wider than its column ("Over repl" on a phone) takes a second line, never its
		   neighbour's room. */
		text-align: right;
		line-height: 1.15;
	}

	.left {
		justify-content: flex-start;
		text-align: left;
	}

	button {
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		letter-spacing: inherit;
		text-transform: inherit;
		color: inherit;
		cursor: pointer;
	}

	button:hover {
		color: var(--ink);
	}

	/* The sorted head: in ink, with a caret in the accent. */
	.on {
		color: var(--ink);
	}

	.on::after {
		content: '';
		display: inline-block;
		margin-left: 4px;
		border: 4px solid transparent;
		border-top: 5px solid var(--accent);
		vertical-align: -1px;
	}

	[aria-sort='descending'] .on::after {
		border-top-color: transparent;
		border-bottom: 5px solid var(--accent);
		vertical-align: 3px;
	}

	.short {
		display: none;
	}

	/* What the head counts, under it in plain case: Tier's "by position". */
	.note {
		display: block;
		font-weight: 500;
		text-transform: none;
		letter-spacing: 0;
	}

	@media (min-width: 961px) and (max-width: 1439px) {
		.head {
			grid-template-columns: var(--cols-lap);
		}

		.h-lap {
			display: none;
		}
	}

	@media (min-width: 761px) and (max-width: 960px) {
		.head {
			grid-template-columns: var(--cols-tab);
		}

		.h-tab {
			display: none;
		}
	}

	@media (max-width: 760px) {
		.head {
			grid-template-columns: var(--cols-phone);
			column-gap: 6px;
			padding: 0 0 6px;
		}

		.h-phone,
		.full {
			display: none;
		}

		.short {
			display: inline;
		}
	}
</style>
