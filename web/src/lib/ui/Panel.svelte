<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		as?: 'div' | 'section' | 'aside';
		/** Names a section or aside for assistive tech. */
		label?: string;
		padding?: 'none' | 'sm' | 'md';
		/** A left edge: accent marks our call, quiet marks a call that waits on the board. */
		edge?: 'accent' | 'quiet';
		children: Snippet;
	}

	let { as = 'div', label, padding = 'md', edge, children }: Props = $props();
</script>

<svelte:element
	this={as}
	class="panel pad-{padding} {edge ? `edge-${edge}` : ''}"
	aria-label={label}
>
	{@render children()}
</svelte:element>

<style>
	.panel {
		min-width: 0;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
	}

	.pad-sm {
		padding: var(--s-3) var(--s-4);
	}

	.pad-md {
		padding: var(--s-4);
	}

	.edge-accent {
		border-left: 4px solid var(--accent);
	}

	.edge-quiet {
		border-left: 4px solid var(--line-strong);
	}

	@media (max-width: 760px) {
		.pad-md {
			padding: var(--s-3);
		}
	}
</style>
