<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** muted is the label grey, inherit takes the color of what it labels (a tinted cell). */
		tone?: 'muted' | 'inherit' | 'accent';
		/** cell sets the label under a number in a cell, at the type scale's 11px floor. */
		size?: 'xs' | 'cell';
		align?: 'start' | 'end';
		children: Snippet;
	}

	let { tone = 'muted', size = 'xs', align = 'start', children }: Props = $props();
</script>

<span class="label {tone} {size}" class:end={align === 'end'}>{@render children()}</span>

<style>
	.label {
		font-size: var(--t-xs);
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		font-weight: 500;
		font-style: normal;
		white-space: nowrap;
	}

	.muted {
		color: var(--ink-3);
	}

	.inherit {
		color: inherit;
	}

	.accent {
		color: var(--accent-text);
		font-weight: 700;
	}

	.cell {
		font-size: var(--t-xs);
		margin-top: 3px;
	}

	.end {
		text-align: right;
	}

	@media (max-width: 760px) {
		.cell {
			letter-spacing: 0.03em;
		}
	}
</style>
