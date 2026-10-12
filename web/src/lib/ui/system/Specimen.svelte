<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** A specimen wider than the phone scrolls inside its frame instead of squeezing. */
		minWidth?: number;
		/** dashed frames a group of live room parts, solid frames one primitive on the page ground. */
		frame?: 'solid' | 'dashed' | 'none';
		/** stack piles the parts, row lays them side by side and wraps. */
		layout?: 'stack' | 'row';
		children: Snippet;
	}

	let { minWidth = 0, frame = 'solid', layout = 'stack', children }: Props = $props();
</script>

<div class="specimen {frame}">
	<div class="inner {layout}" style:min-width="{minWidth}px">{@render children()}</div>
</div>

<style>
	.specimen {
		border-radius: var(--r-md);
		overflow-x: auto;
		min-width: 0;
	}

	.solid {
		border: 1px solid var(--line);
		background: var(--bg);
	}

	.dashed {
		border: 1px dashed var(--line-strong);
		padding: var(--s-4);
	}

	.inner {
		display: flex;
		gap: var(--s-3);
	}

	.stack {
		flex-direction: column;
	}

	.row {
		flex-wrap: wrap;
		align-items: center;
	}
</style>
