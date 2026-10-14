<script lang="ts">
	import type { Component } from 'svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import { siteContext } from './context.svelte.ts';
	import { labelEnds, switchLabel } from './words.ts';

	/** The shell's league switch, at the right of the top bar on every width (founder ruling
	 * 2026-10-13): the selected league's name, or the format with none, opening the account's leagues,
	 * the formats and the way to follow another. The rail's Leagues opens the same menu. The menu's
	 * code arrives on the first intent to open it, closing included (LeagueMenu), so every page
	 * carries only this button. */

	const MENU_ID = 'league-menu';

	let Menu = $state<Component | null>(null);
	let loading: Promise<void> | null = null;

	function preload(): void {
		loading ??= import('./LeagueMenu.svelte').then((module) => {
			Menu = module.default;
		});
	}

	// Opened from the rail before any intent here: fetch the menu then.
	$effect(() => {
		if (siteContext.open) preload();
	});

	const label = $derived(switchLabel(siteContext.league, siteContext.format));
	const ends = $derived(labelEnds(label));
</script>

<span class="switch" data-opens-leagues>
	<button
		type="button"
		class="face"
		aria-expanded={siteContext.open}
		aria-controls={MENU_ID}
		aria-label="{label}, your league and scoring"
		title={label}
		onclick={() => (siteContext.open = !siteContext.open)}
		onpointerenter={preload}
	>
		<span class="mark"><Icon name="league" size={18} /></span>
		<span class="words"><span class="head">{ends[0]}</span><span class="tail">{ends[1]}</span></span
		>
		<Icon name="chevron" size={16} />
	</button>
	<div class="pop" id={MENU_ID} hidden={!siteContext.open}>
		{#if Menu}<Menu />{/if}
	</div>
</span>

<style>
	.switch {
		position: relative;
		display: flex;
		min-width: 0;
	}

	/* One width at every state, so the bar never moves when the league's name arrives. */
	.face {
		display: inline-flex;
		align-items: center;
		gap: var(--s-2);
		width: var(--switch-w, 232px);
		min-width: 0;
		height: 40px;
		padding: 0 var(--s-3);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		font-size: var(--t-sm);
		font-weight: 600;
		text-align: left;
		cursor: pointer;
	}

	.face:hover {
		border-color: var(--ink-3);
	}

	.face[aria-expanded='true'] {
		border-color: var(--ink);
	}

	.mark {
		display: inline-flex;
		color: var(--accent-text);
	}

	/* A long name gives way in the middle: its head takes the ellipsis and its last word, which tells
	   one contest entry from the next, stays whole. The button's label carries the full name. */
	.words {
		flex: 1;
		min-width: 0;
		display: flex;
		white-space: pre;
	}

	.head {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tail {
		flex: none;
	}

	.face :global(svg:last-child) {
		flex: none;
		color: var(--ink-3);
	}

	.pop {
		position: absolute;
		top: calc(100% + var(--s-2));
		right: 0;
		z-index: 30;
		width: min(360px, calc(100vw - 2 * var(--s-3)));
		max-height: calc(100vh - 120px);
		overflow-y: auto;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: var(--bg);
		box-shadow: var(--shadow-pop);
	}

	.pop[hidden] {
		display: none;
	}

	@media (max-width: 760px) {
		/* The phone gives the switch its bar's whole first row, the same width on every page. */
		.switch {
			position: static;
			flex: 1;
		}

		.face {
			width: 100%;
		}

		/* In a hand the menu spans the screen under the bar, whichever control opened it. */
		.pop {
			--under-bar: calc(40px + 2 * var(--s-2) + var(--s-1));
			position: fixed;
			top: var(--under-bar);
			left: var(--s-3);
			right: var(--s-3);
			width: auto;
			max-height: calc(100dvh - var(--under-bar) - var(--tab-bar-h) - var(--s-3));
		}
	}
</style>
