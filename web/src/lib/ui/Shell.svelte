<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { page } from '$app/state';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import LeagueSwitch from '#lib/context/LeagueSwitch.svelte';
	import RailIcon from './RailIcon.svelte';
	import Stamp from './Stamp.svelte';
	import {
		HOME_HREF,
		PHONE_RAIL_ITEMS,
		RAIL_FOOT,
		RAIL_ITEMS,
		railHref,
		sectionOf,
		type RailItem,
		type Section
	} from './nav.ts';

	interface Props {
		/** The page's name in the top bar. Hidden on the phone, where the rail names the section. */
		title: string | Snippet;
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
	const leagueId = $derived(siteContext.league?.id ?? null);
	/** A followed league's own pages, the follow page (/league/new) not among them. */
	const LEAGUE_PAGE = /^\/league\/(?!new(?:\/|$))[^/]+/;
	/** On a league's pages the phone bar leads with the site mark, the way home (Lane 66t): the bottom
	 * bar keeps its five, so the mark takes no tab. */
	const homeMark = $derived(LEAGUE_PAGE.test(page.url.pathname));
</script>

{#snippet siteMark(cls: string)}
	<a class={cls} href={HOME_HREF} aria-label="Commish"><b>C</b></a>
{/snippet}

{#snippet railLink(item: RailItem, foot: boolean)}
	<a
		class="item"
		class:foot
		data-k={foot ? undefined : item.key}
		href={railHref(item, leagueId)}
		aria-current={item.section === current ? 'page' : undefined}
	>
		<RailIcon name={item.icon} />
		<span>{item.label}</span>
	</a>
{/snippet}

<div class="app">
	<!-- The rail follows the season (spec 2026-10-16 §2): every item is drawn in one order every
	     rail follows, and the rail styles (rail-css.ts, in the head) show the rail the root's
	     data-rail names, set by
	     the boot script before the first paint and by the context after. So a prerendered page never
	     paints the wrong rail and then swaps it. -->
	<nav class="rail" aria-label="Sections" style="--phone-items: {PHONE_RAIL_ITEMS}">
		{@render siteMark('mark')}
		{#each RAIL_ITEMS as item (item.key)}
			{@render railLink(item, false)}
		{/each}
		<span class="spacer"></span>
		{@render railLink(RAIL_FOOT, true)}
	</nav>
	<div class="main">
		<header class="top" class:homed={homeMark}>
			{#if homeMark}{@render siteMark('home')}{/if}
			<h1>
				{#if typeof title === 'string'}{title}{:else}{@render title()}{/if}
			</h1>
			{#if stamp}<span class="stamp"><Stamp text={stamp} /></span>{/if}
			{#if search}
				<div class="find">{@render search()}</div>
			{/if}
			<a
				class="account"
				href={RAIL_FOOT.href}
				aria-label={RAIL_FOOT.label}
				aria-current={current === RAIL_FOOT.section ? 'page' : undefined}
				><RailIcon name={RAIL_FOOT.icon} /></a
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

	.mark b,
	.home b {
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

	/* The site mark in the phone bar on a league's pages; the rail draws it at a desk. */
	.home {
		display: none;
		place-items: center;
		width: 44px;
		height: 44px;
		text-decoration: none;
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
		min-width: var(--find-min-w);
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

	/* The league switch closes the bar at the right on every width: 232px where the bar has the room,
	   giving way as the bar narrows (under 1024px) down to a cut name with its flag and chevron, so the
	   bar never runs past the screen. Its width comes from the bar, never from the name, so the name's
	   arrival moves nothing. */
	.league {
		display: flex;
		flex: 0 1 var(--switch-w);
		min-width: var(--switch-min-w);
	}

	/* With no league selected (signed out, or a format only) the switch says a format, "PPR", and
	   takes only its words' width, so the search keeps the room for its placeholder. The boot script
	   marks a selected league before the first paint, so the width never changes as a page loads. */
	:global(html:not([data-league])) .league {
		flex: 0 1 auto;
		min-width: 0;
	}

	/* Under 1024px the bar's title gives way, as on the phone (the rail names the section), so the
	   search, the verb and the switch keep their room and the bar never runs past the screen. */
	@media (max-width: 1024px) {
		h1 {
			display: none;
		}

		.stamp {
			margin-left: 0;
		}
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
		.foot {
			display: none;
		}

		/* A label of two words or more ("Rest of season", "Cheat sheet") takes two lines in a cell a
		   fifth of a phone wide: the padding and the gap give it the room inside the bar's height. */
		.item {
			gap: 2px;
			padding: 3px 1px 2px;
			border-left: 0;
			border-top: 3px solid transparent;
			overflow: hidden;
		}

		.item span {
			display: block;
			line-height: 1.05;
			text-wrap: balance;
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

		/* The mark leads the first row, where the desk rail puts it, the account still its last cell. */
		.top.homed {
			grid-template-columns: 44px auto minmax(0, 1fr) auto;
			grid-template-areas:
				'home league league account'
				'stamp stamp tail tail'
				'find find find find';
		}

		.home {
			grid-area: home;
			display: grid;
			margin: -10px 0 -10px -10px;
		}

		.home b {
			font-size: 24px;
			border-bottom-width: 3px;
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
