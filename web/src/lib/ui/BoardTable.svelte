<script lang="ts">
	import type { Snippet } from 'svelte';
	import { columnStyle, type BoardColumns } from './board-columns.ts';
	import type { Sort, SortKey } from './board-sort.ts';
	import RowHead from './RowHead.svelte';

	/** A run of board rows under their heads (Lane 66n): the view's grid set once, here, for the head
	 * and every Row inside, so the two never drift and no row carries its own template. */
	interface Props {
		columns: BoardColumns;
		/** What the table holds, for assistive tech. */
		label: string;
		sort?: Sort;
		onsort?: (key: SortKey) => void;
		children: Snippet;
	}

	let { columns, label, sort, onsort, children }: Props = $props();
</script>

<section class="table" aria-label={label} style={columnStyle(columns)}>
	<RowHead {columns} {sort} {onsort} />
	{@render children()}
</section>

<style>
	.table {
		min-width: 0;
	}
</style>
