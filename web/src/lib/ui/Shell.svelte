<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { page } from '$app/state';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import LeagueSwitch from '#lib/context/LeagueSwitch.svelte';
	import Icon from './Icon.svelte';
	import Stamp from './Stamp.svelte';
	import {
		HOME_HREF,
		RAIL,
		RAIL_FOOT,
		phoneRailCount,
		sectionOf,
		type RailItem,
		type Section
	} from './nav.ts';

	interface Props {
		/** The page's name in the top bar. Hidden on the phone, where the rail names the section. */
		title: string;
		/** What the page's numbers are as of, beside the title: the nightly run's date. Kept on the phone. */
		stamp?: string;
		/** The rail item for this page, or null for a page outside the sections. Left out, the page's
		 * path picks it by nav.ts's one rule. */
		active?: Section | null;
		/** The top bar's search, usually a Search. */
		search?: Snippet;
		/** The top bar's right end, before the league switch: the page's verb or a quiet action. The
		 * theme switch lives in the account room at every width, so the bar holds only the league
		 * switch, the account, the verb and search. */
		tail?: Snippet;
		children: Snippet;
	}

	let { title, stamp, active, search, tail, children }: Props = $props();

	const current = $derived(active === undefined ? sectionOf(page.url.pathname) : active);
	// The site's context: the session's copy at once, then /me. The rail's Board (/board, which
	// names no format) opens in the context's format by itself (follow.svelte.ts).
	onMount(() => void siteContext.load());

	/** Leagues opens the switch's menu in place of its page, which stays the way without script. */
	function openLeagues(event: MouseEvent): void {
		event.preventDefault();
		siteContext.open = !siteContext.open;
	}
</script>

{#snippet railLink(item: RailItem)}
	<a
		class="item"
		class:wide-only={item.wideOnly}
		href={item.href}
		aria-current={item.section === current ? 'page' : undefined}
		data-opens-leagues={item.opensLeagues ? '' : undefined}
		role={item.opensLeagues ? 'button' : undefined}
		aria-expanded={item.opensLeagues ? siteContext.open : undefined}
		onclick={item.opensLeagues ? openLeagues : undefined}
	>
		<Icon name={item.icon} />
		<span>{item.label}</span>
	</a>
{/snippet}

<div class="app">
	<nav class="rail" aria-label="Sections" style="--phone-items: {phoneRailCount(RAIL)}">
		<a class="mark" href={HOME_HREF} aria-label="Commish"><b>C</b></a>
		{#each RAIL as item (item.section)}
			{@render railLink(item)}
		{/each}
		<span class="spacer"></span>
		{@render railLink(RAIL_FOOT)}
	</nav>
	<div class="main">
		<header class="top">
			<h1>{title}</h1>
			{#if stamp}<span class="stamp"><Stamp text={stamp} /></span>{/if}
			{#if search}
				<div class="find">{@render search()}</div>
			{/if}
			<a
				class="account"
				href={RAIL_FOOT.href}
				aria-label={RAIL_FOOT.label}
				aria-current={current === RAIL_FOOT.section ? 'page' : undefined}
				><Icon name={RAIL_FOOT.icon} /></a
			>
			<div class="tail">
				{@render tail?.()}
			</div>
			<div class="league"><LeagueSwitch /></div>
		</header>
		{@render children()}
	</div>
</div>

<style>
	.app {
		display: grid;
		grid-template-columns: var(--rail-w) minmax(0, 1fr);
		min-height: 100vh;
	}

	.rail {
		position: sticky;
		top: 0;
		height: 100vh;
		background: var(--shell);
		border-right: 1px solid var(--shell-line);
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--s-1);
		padding-block: var(--s-4);
	}

	.mark {
		display: grid;
		place-items: center;
		height: 56px;
		margin-bottom: var(--s-3);
		text-decoration: none;
	}

	.mark b {
		font-family: var(--font-num);
		font-weight: 800;
		font-size: 30px;
		line-height: 1;
		color: var(--ink);
		border-bottom: 4px solid var(--accent);
		padding-bottom: 2px;
	}

	.item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 10px 4px;
		text-decoration: none;
		color: var(--ink-3);
		font-size: var(--t-xs);
		font-weight: 500;
		text-align: center;
		border-left: 3px solid transparent;
	}

	.item:hover {
		color: var(--ink);
	}

	.item[aria-current='page'] {
		color: var(--accent-text);
		border-left-color: var(--accent);
	}

	.spacer {
		flex: 1;
	}

	/* The account's way in on the phone, where the rail's foot is not drawn. */
	.account {
		display: none;
		place-items: center;
		width: 44px;
		height: 44px;
		color: var(--ink-2);
	}

	.account[aria-current='page'] {
		color: var(--accent-text);
	}

	.main {
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.top {
		position: sticky;
		top: 0;
		z-index: 5;
		background: var(--shell);
		border-bottom: 1px solid var(--shell-line);
		display: flex;
		align-items: center;
		gap: var(--s-4);
		padding: var(--s-3) var(--s-5);
		min-height: 68px;
	}

	h1 {
		margin: 0;
		font-size: var(--t-lg);
		font-weight: 700;
		white-space: nowrap;
	}

	.stamp {
		margin-left: calc(-1 * var(--s-2));
	}

	.find {
		flex: 1;
		max-width: 620px;
		display: flex;
	}

	.tail {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: var(--s-3);
		/* A verb's height whether or not the page has drawn its verb yet: a user page draws it
		   once the browser's data is read, and the bar must not grow then. */
		min-height: var(--verb-h);
	}

	/* The league switch closes the bar at the right on every width. */
	.league {
		display: flex;
		flex: none;
		min-width: 0;
	}

	@media (max-width: 760px) {
		.app {
			grid-template-columns: minmax(0, 1fr);
			padding-bottom: calc(var(--tab-bar-h) + env(safe-area-inset-bottom, 0px));
		}

		/* The tab bar is exactly --tab-bar-h over the safe area, so the page's padding and anything
		   pinned above the bar (ActionBar) read the same number. Its columns come from the item
		   count, not from the items drawn so far: a long page paints before the rail's last tab is
		   parsed, and a tab must not slide when the next one arrives. */
		.rail {
			position: fixed;
			inset: auto 0 0 0;
			box-sizing: border-box;
			height: calc(var(--tab-bar-h) + env(safe-area-inset-bottom, 0px));
			z-index: 20;
			display: grid;
			grid-template-columns: repeat(var(--phone-items), minmax(0, 1fr));
			padding: 4px 4px calc(4px + env(safe-area-inset-bottom, 0px));
			border-right: 0;
			border-top: 1px solid var(--shell-line);
		}

		.mark,
		.spacer,
		.wide-only {
			display: none;
		}

		.item {
			padding: 6px 2px;
			border-left: 0;
			border-top: 3px solid transparent;
		}

		.item[aria-current='page'] {
			border-top-color: var(--accent);
		}

		/* The phone bar is one grid on every page, so it never changes size between pages: the league
		   switch, the bar's one menu, takes the whole first row with the account in its last cell; the
		   run's date and the page's verb share the second, a verb's height whether or not the page has
		   either; the search runs across the last. */
		.top {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr) auto;
			grid-template-rows: auto var(--verb-h) auto;
			grid-template-areas:
				'league league account'
				'stamp tail tail'
				'find find find';
			align-items: center;
			padding: var(--s-2) var(--s-4);
			gap: var(--s-2);
			min-height: 0;
		}

		.league {
			grid-area: league;
		}

		h1 {
			display: none;
		}

		.stamp {
			grid-area: stamp;
			margin-left: 0;
		}

		.account {
			grid-area: account;
			display: grid;
			margin: -10px -10px -10px 0;
		}

		.tail {
			grid-area: tail;
			justify-content: flex-end;
		}

		.find {
			grid-area: find;
			max-width: none;
		}
	}
</style>
