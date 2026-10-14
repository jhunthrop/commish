<script lang="ts">
	import type { Component } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import Icon from '#lib/ui/Icon.svelte';
	import { siteContext } from './context.svelte.ts';
	import { switchLabel } from './words.ts';

	/** The shell's league switch, at the right of the top bar on every width (founder ruling
	 * 2026-10-13): the selected league's name, or the format with none, opening the account's leagues,
	 * the formats and the way to follow another. The rail's Leagues opens the same menu. The menu's
	 * code arrives on the first intent to open it, so every page carries only this button. A tap
	 * outside the switch or Escape closes it; a tap on the rail's Leagues is its own toggle. */

	const MENU_ID = 'league-menu';
	/** What marks another control that opens the menu (the rail's Leagues, a page's scoring chip),
	 * whose own tap opens and closes it. */
	const OPENER = '[data-opens-leagues]';

	let root: HTMLElement | undefined = $state();
	let button: HTMLButtonElement | undefined = $state();
	let Menu = $state<Component | null>(null);
	let loading: Promise<void> | null = null;

	function preload(): void {
		loading ??= import('./LeagueMenu.svelte').then((module) => {
			Menu = module.default;
		});
	}

	// A page the menu opens (a league's, the attach page) closes it.
	afterNavigate(() => {
		siteContext.open = false;
	});

	// Opened from the rail before any intent here: fetch the menu then.
	$effect(() => {
		if (siteContext.open) preload();
	});

	function onWindowPointer(event: PointerEvent): void {
		if (!siteContext.open || !(event.target instanceof Element)) return;
		if (root?.contains(event.target) || event.target.closest(OPENER)) return;
		siteContext.open = false;
	}

	function onKey(event: KeyboardEvent): void {
		if (!siteContext.open || event.key !== 'Escape') return;
		event.preventDefault();
		siteContext.open = false;
		button?.focus();
	}

	const label = $derived(switchLabel(siteContext.league, siteContext.format));
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={onKey} />

<span class="switch" bind:this={root}>
	<button
		bind:this={button}
		type="button"
		class="face"
		aria-expanded={siteContext.open}
		aria-controls={MENU_ID}
		aria-label="{label}, your league and scoring"
		onclick={() => (siteContext.open = !siteContext.open)}
		onpointerenter={preload}
		onfocus={preload}
	>
		<span class="mark"><Icon name="league" size={18} /></span>
		<span class="words">{label}</span>
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

	.words {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
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
		.switch {
			position: static;
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
