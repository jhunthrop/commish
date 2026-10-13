<script lang="ts">
	import type { Snippet } from 'svelte';
	import { inChipGroup } from './chips.ts';

	interface Props {
		/** Pressed fills with ink, never orange, so orange keeps meaning the verb, the brand and you. */
		pressed?: boolean;
		/** A chip that goes to another page, a view of the same thing: the PPR board, the WR board.
		 * It draws the same, and pressed marks the page you are on. */
		href?: string;
		/** A compact chip for a side panel's tag row. */
		size?: 'md' | 'sm';
		/** The chip's name for assistive tech when its words alone would repeat another control's:
		 * "Show Target" on a filter beside a row's Target. It holds the chip's words. */
		label?: string;
		onclick?: (event: MouseEvent) => void;
		children: Snippet;
	}

	let { pressed = false, href, size = 'md', label, onclick, children }: Props = $props();

	const grouped = inChipGroup();
</script>

{#if href}
	<a
		class="chip"
		class:grouped
		class:sm={size === 'sm'}
		class:on={pressed}
		{href}
		aria-current={pressed ? 'page' : undefined}
		aria-label={label}
		{onclick}
	>
		{@render children()}
	</a>
{:else}
	<button
		type="button"
		class="chip"
		class:grouped
		class:sm={size === 'sm'}
		class:on={pressed}
		aria-pressed={pressed}
		aria-label={label}
		{onclick}
	>
		{@render children()}
	</button>
{/if}

<style>
	.chip {
		display: inline-flex;
		align-items: center;
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
		text-decoration: none;
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

	.on {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--bg);
	}

	.on:hover {
		color: var(--bg);
	}
</style>
