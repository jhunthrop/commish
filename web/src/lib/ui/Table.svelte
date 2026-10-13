<script lang="ts">
	import type { Snippet } from 'svelte';

	import type { Column } from './table.ts';

	interface Props {
		/** What the table holds, for assistive tech and as its visible title when shown. */
		caption: string;
		showCaption?: boolean;
		columns: readonly Column[];
		/** Wider than the phone, the table scrolls inside its frame instead of squeezing. */
		minWidth?: number;
		/** The rows: <tr> elements whose cells take the classes num, end and wide. */
		children: Snippet;
	}

	let { caption, showCaption = false, columns, minWidth = 0, children }: Props = $props();
</script>

<div class="frame">
	<table style:min-width="{minWidth}px">
		<caption class:hidden={!showCaption}>{caption}</caption>
		<thead>
			<tr>
				{#each columns as column (column.label)}
					<th scope="col" class:end={column.align === 'end'} class:wide={column.wideOnly === true}
						>{column.label}</th
					>
				{/each}
			</tr>
		</thead>
		<tbody>{@render children()}</tbody>
	</table>
</div>

<style>
	.frame {
		overflow-x: auto;
		min-width: 0;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--t-sm);
	}

	caption {
		text-align: start;
		font-size: var(--t-md);
		font-weight: 700;
		padding-bottom: var(--s-3);
	}

	.hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	th {
		padding: 0 var(--s-3) var(--s-2);
		border-bottom: 1px solid var(--line);
		text-align: start;
		font-size: var(--t-xs);
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
		white-space: nowrap;
	}

	tbody :global(td) {
		padding: 6px var(--s-3);
		border-bottom: 1px solid var(--line);
		vertical-align: middle;
	}

	tbody :global(tr:hover) {
		background: var(--surface);
	}

	tbody :global(td.num) {
		font-family: var(--font-num);
		font-weight: 700;
		font-size: 20px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.end,
	tbody :global(td.end),
	tbody :global(td.num) {
		text-align: end;
	}

	@media (max-width: 760px) {
		th,
		tbody :global(td) {
			padding-inline: var(--s-2);
		}

		.wide,
		tbody :global(td.wide) {
			display: none;
		}
	}
</style>
