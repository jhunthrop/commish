<script lang="ts">
	import type { Snippet } from 'svelte';
	import { inChipGroup } from './chips.ts';

	interface Props {
		/** Pressed fills with ink, never orange, so orange keeps meaning the verb, the brand and you. */
		pressed?: boolean;
		/** A compact chip for a side panel's tag row. */
		size?: 'md' | 'sm';
		onclick?: (event: MouseEvent) => void;
		children: Snippet;
	}

	let { pressed = false, size = 'md', onclick, children }: Props = $props();

	const grouped = inChipGroup();
</script>

<button
	type="button"
	class="chip"
	class:grouped
	class:sm={size === 'sm'}
	aria-pressed={pressed}
	{onclick}
>
	{@render children()}
</button>

<style>
	.chip {
		height: 32px;
		padding: 0 var(--s-3);
		border-radius: var(--r-pill);
		border: 1px solid var(--line-strong);
		background: transparent;
		font-size: var(--t-sm);
		font-weight: 500;
		color: var(--ink-2);
		cursor: pointer;
		white-space: nowrap;
	}

	.chip:hover {
		color: var(--ink);
	}

	.sm,
	.grouped {
		height: 28px;
	}

	.grouped {
		border-color: transparent;
	}

	.chip[aria-pressed='true'] {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--bg);
	}
</style>
