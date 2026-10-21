<script lang="ts">
	import type { Component } from 'svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import { siteContext } from './context.svelte.ts';
	import { shownLeague, switchLabel } from './words.ts';

	/** The shell's league switch, at the right of the top bar on every width (founder ruling
	 * 2026-10-13): the selected league's name, or the format with none, opening the account's leagues,
	 * the formats and the way to follow another, its last row. On a league's page it names that
	 * league, the selected one marked in the list (B89). The switch is the one place a league
	 * is chosen (spec 2026-10-16 §2: the rail's Leagues is gone). The menu's
	 * code arrives on the first intent to open it, closing included (LeagueMenu), so every page
	 * carries only this button. */

	interface Props {
		/** The league whose page this is: the switch names it, the selected league marked in the list
		 * (Lane 115, B89). Left out, the selected league's name. */
		page?: string;
	}

	let { page }: Props = $props();

	const MENU_ID = 'league-menu';

	let Menu = $state<Component<{ shown: string | null }> | null>(null);
	let loading: Promise<void> | null = null;

	function preload(): void {
		loading ??= import('./LeagueMenu.svelte').then((module) => {
			Menu = module.default;
		});
	}

	const shown = $derived(shownLeague(page, siteContext.leagues, siteContext.league));
	const label = $derived(switchLabel(shown, siteContext.format));
</script>

<span class="switch" data-opens-leagues>
	<button
		type="button"
		class="face"
		aria-expanded={siteContext.open}
		aria-controls={MENU_ID}
		aria-label="{label}, your league and scoring"
		title={label}
		onclick={() => {
			preload();
			siteContext.open = !siteContext.open;
		}}
		onpointerenter={preload}
	>
		<span class="mark"><Icon name="league" size={18} /></span>
		<span class="words">{label}</span>
		<Icon name="chevron" size={16} />
	</button>
	<div class="pop" id={MENU_ID} hidden={!siteContext.open}>
		{#if Menu}<Menu shown={shown?.id ?? null} />{/if}
	</div>
</span>

<style>
	.switch {
		position: relative;
		display: flex;
		flex: 1;
		min-width: 0;
	}

	/* One width at every state, so the bar never moves when the league's name arrives. */
	.face {
		display: inline-flex;
		align-items: center;
		gap: var(--s-2);
		width: 100%;
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

	/* A long name gives way at its end, never in the middle. The button's label carries the full
	   name. */
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
		/* The phone gives the switch its bar's whole first row, the same width on every page. */
		.switch {
			position: static;
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
