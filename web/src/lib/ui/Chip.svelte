<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import { inChipGroup, inManyChipGroup } from './chips.ts';

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
		/** The chip's name for assistive tech when its words alone would mislead or repeat another
		 * control's: "Half PPR, not on this run", "Show Target" beside a row's Target. */
		label?: string;
		/** A choice that cannot be taken here, drawn in quiet ink. A button only. */
		disabled?: boolean;
		onclick?: (event: MouseEvent) => void;
		children: Snippet;
	}

	let {
		pressed = false,
		href,
		size = 'md',
		absent = false,
		label,
		disabled = false,
		onclick,
		children
	}: Props = $props();

	const grouped = inChipGroup();
	/** In a many-choice group a button carries a check, its place kept when off so a tap never moves
	 * the row. */
	const checks = inManyChipGroup();
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
		class:checks
		aria-label={label}
		aria-pressed={pressed}
		{disabled}
		{onclick}
	>
		{#if checks}<span class="check" class:shown={pressed}><Icon name="check" size={14} /></span
			>{/if}
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

	.checks {
		gap: 6px;
		padding-left: var(--s-2);
	}

	.check {
		display: inline-flex;
		visibility: hidden;
	}

	.check.shown {
		visibility: visible;
	}

	.chip:disabled {
		color: var(--ink-3);
		cursor: default;
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
