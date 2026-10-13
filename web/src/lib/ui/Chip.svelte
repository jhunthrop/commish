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
		/** A choice this page cannot show yet, like a format the run does not carry: drawn with a
		 * dashed edge in quiet ink, still a link to the page that says so. Never pressed. */
		absent?: boolean;
		/** The chip's name for assistive tech when its words alone would mislead: "Half PPR, not on this run". */
		label?: string;
		onclick?: (event: MouseEvent) => void;
		children: Snippet;
	}

	let {
		pressed = false,
		href,
		size = 'md',
		absent = false,
		label,
		onclick,
		children
	}: Props = $props();

	const grouped = inChipGroup();
</script>

{#if href}
	<a
		class="chip"
		class:grouped
		class:sm={size === 'sm'}
		class:on={pressed}
		class:absent
		{href}
		aria-label={label}
		aria-current={pressed ? 'page' : undefined}
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
		class:absent
		aria-label={label}
		aria-pressed={pressed}
		{onclick}
	>
		{@render children()}
	</button>
{/if}

<style>
	.chip {
		position: relative;
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

	.absent,
	.grouped.absent {
		border: 1px dashed var(--line-strong);
		color: var(--ink-3);
	}

	/* A thumb's 44px on the phone: the chip draws at its size and its hit area reaches 44 tall. */
	@media (max-width: 760px) {
		.chip {
			min-width: 44px;
			justify-content: center;
		}

		.chip::after {
			content: '';
			position: absolute;
			inset: -8px 0;
		}
	}
</style>
