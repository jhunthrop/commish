<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** gain is green (a steal, right on time), loss is rose (a reach, could have waited), even is grey. */
		tone: 'gain' | 'loss' | 'even';
		children: Snippet;
	}

	let { tone, children }: Props = $props();
</script>

<!-- A verdict in words on a tinted chip. The words carry the meaning, so the tint is never the only channel. -->
<span class="chip {tone}">{@render children()}</span>

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
</style>
