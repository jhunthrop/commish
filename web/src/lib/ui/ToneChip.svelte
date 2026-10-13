<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** gain is green (a steal, right on time), loss is rose (a reach, could have waited), even is grey. */
		tone: 'gain' | 'loss' | 'even';
		/** sm is a verdict in a room's row; md is a board row's gap, a step up on desktop. */
		size?: 'sm' | 'md';
		children: Snippet;
	}

	let { tone, size = 'sm', children }: Props = $props();
</script>

<!-- A verdict in words on a tinted chip. The words carry the meaning, so the tint is never the only channel. -->
<span class="chip {tone} {size}">{@render children()}</span>

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		height: 22px;
		padding: 0 8px;
		border-radius: var(--r-sm);
		font-size: var(--t-xs);
		font-weight: 600;
		white-space: nowrap;
	}

	.md {
		font-size: var(--t-sm);
	}

	.gain {
		background: var(--gain-bg);
		color: var(--gain-ink);
	}

	.loss {
		background: var(--loss-bg);
		color: var(--loss-ink);
	}

	.even {
		background: var(--surface-2);
		color: var(--ink-2);
	}

	@media (max-width: 760px) {
		.md {
			font-size: var(--t-xs);
			padding: 0 6px;
		}
	}
</style>
