<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { page } from '$app/state';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import LeagueSwitch from '#lib/context/LeagueSwitch.svelte';
	import HeadTags from '#lib/site/HeadTags.svelte';
	import type { ShellHead } from '#lib/site/head.ts';
	import Mark from './Mark.svelte';
	import RailIcon from './RailIcon.svelte';
	import SiteFooter from './SiteFooter.svelte';
	import Stamp from './Stamp.svelte';
	import { barRows } from './bar-rows.ts';
	import {
		HELD_WEEK_LABEL,
		HOME_HREF,
		PHONE_RAIL_ITEMS,
		RAIL_FOOT,
		RAIL_ITEMS,
		WEEK_RANKINGS_KEY,
		railHref,
		sectionOf,
		RANKINGS_NAME,
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
		/** The league a league's page is for: the rail's league screens open its pages and the switch
		 * names it, the selected league marked in its list (B38, Lane 115 B89). Left out, they open and
		 * name the selected league's. */
		league?: string;
		/** The rail's week order named "Rankings" in season (Lane 140, C19; Lane 164), built
		 * with the page (a prerendered one, server/build-week.ts); absent outside the season and on a
		 * page the Worker draws in the browser, which names it from the context's week, read before
		 * its first render (context/first-season.ts, Lane 143, B126). */
		weekLabel?: string;
		/** The page holds the week item's label before its season read starts: the Worker's error
		 * page, drawn on the server where no read runs (Lane 148). */
		holdWeek?: boolean;
		/** The page's head (Lane 169): its title, and its description, canonical address, share tags
		 * and structured data as the server built them. Left out by a page the browser draws, whose
		 * head the Worker answers with (hooks.server.ts), and which sets only its title as it reads. */
		head?: ShellHead;
		children: Snippet;
	}

	let {
		title,
		stamp,
		active,
		search,
		tail,
		league,
		weekLabel,
		holdWeek = false,
		head,
		children
	}: Props = $props();
	// The week's order: the page's own name for it, else on a page the Worker draws the context's week
	// (Lane 142), else Players, the page it opens, while no week is named (fix round 1).
	const labelOf = (item: RailItem, week = siteContext.season?.board_week): string =>
		item.key === WEEK_RANKINGS_KEY
			? (weekLabel ?? (week ? RANKINGS_NAME : item.label))
			: item.label;

	// The week item's label is held unpainted while a page the Worker draws reads the site's season
	// (context/first-season.ts), so it paints once, named (Lane 143).
	const held = (item: RailItem): boolean =>
		item.key === WEEK_RANKINGS_KEY &&
		weekLabel === undefined &&
		(holdWeek || siteContext.seasonPending);

	const current = $derived(active === undefined ? sectionOf(page.url.pathname) : active);
	// The site's context: the session's copy at once, then /me. The rail's Board (/board, which
	// names no format) opens in the context's format by itself (follow.svelte.ts).
	onMount(() => void siteContext.load());
	const leagueId = $derived(league ?? siteContext.league?.id ?? null);
	/** Off a league's page, an account with more than one league opens every league's Lineup. */
	const every = $derived(league === undefined && siteContext.leagues.length > 1);
	/** The phone bar's rows from the parts this page passes (bar-rows.ts): with none, the one row led by
	 * the site mark, the way home; the bottom bar keeps its five, so the mark takes no tab. */
	const rows = $derived(barRows({ stamp, tail, search }));
	/** The mark's side in the rail's 56 px slot and in the phone bar's 44 px cell (Lane 170). */
	const RAIL_MARK_SIZE = 36;
	const BAR_MARK_SIZE = 28;
</script>

{#snippet siteMark(cls: string, size: number)}
	<a class={cls} href={HOME_HREF} aria-label="Commish"><Mark {size} /></a>
{/snippet}

{#snippet railLink(item: RailItem, foot: boolean)}
	<a
		class="item"
		class:foot
		data-k={foot ? undefined : item.key}
		href={railHref(item, leagueId, every)}
		aria-current={item.section === current ? 'page' : undefined}
	>
		<RailIcon name={item.icon} />
		<!-- Held, the label keeps the room of the longest in-season form (nav.ts HELD_WEEK_LABEL), so
		     nothing below it moves when the season names it (Lane 143 fix round 1). -->
		<span class:held={held(item)}>{held(item) ? HELD_WEEK_LABEL : labelOf(item)}</span>
	</a>
{/snippet}

{#if head}<HeadTags title={head.title} markup={head.markup} fullTitle={head.fullTitle} />{/if}

<div class="app">
	<!-- The rail follows the season (spec 2026-10-16 §2): every item is drawn in one order every
	     rail follows, and the rail styles (rail-css.ts, in the head) show the rail the root's
	     data-rail names, set by
	     the boot script before the first paint and by the context after. So a prerendered page never
	     paints the wrong rail and then swaps it. -->
	<nav class="rail" aria-label="Sections" style="--phone-items: {PHONE_RAIL_ITEMS}">
		{@render siteMark('mark', RAIL_MARK_SIZE)}
		{#each RAIL_ITEMS as item (item.key)}
			{@render railLink(item, false)}
		{/each}
		<span class="spacer"></span>
		{@render railLink(RAIL_FOOT, true)}
	</nav>
	<div class="main">
		<header class="top" data-rows={rows}>
			{#if rows === 1}{@render siteMark('home', BAR_MARK_SIZE)}{/if}
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
			<div class="league"><LeagueSwitch page={league} /></div>
		</header>
		{@render children()}
		<SiteFooter />
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

	/* The week item's label while the season is read: its room kept, nothing painted (Lane 143). */
	.item span.held {
		visibility: hidden;
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

	/* The site mark in the phone bar of a page with no bar parts; the rail draws it at a desk. */
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

		/* The phone bar draws a row for each part its page passes and no other (bar-rows.ts): the league
		   switch, the bar's one menu, takes the first row with the account in its last cell; a stamp or a
		   verb adds the second, a verb's height whether or not the page has drawn its verb yet; a search
		   runs across the third. The rows come from the page's props, never its data, so the bar never
		   grows as a page loads, and no row stands empty under the switch (Lane 87). */
		.top {
			display: grid;
			/* The verb's cells take their width first; the stamp's cell takes what is left (Lane 132). */
			grid-template-columns: minmax(0, 1fr) auto auto;
			align-items: center;
			padding: var(--s-2) var(--s-4);
			gap: var(--s-2);
			min-height: 0;
		}

		.top[data-rows='3'] {
			grid-template-rows: auto var(--verb-h) auto;
			grid-template-areas:
				'league league account'
				'stamp tail tail'
				'find find find';
		}

		.top[data-rows='2'] {
			grid-template-rows: auto var(--verb-h);
			grid-template-areas:
				'league league account'
				'stamp tail tail';
		}

		/* No parts: the mark leads the one row, where the desk rail puts it, the account still its last
		   cell. The switch's cell is the bar's, so the switch's width never comes from the name or the
		   pending state. */
		.top[data-rows='1'] {
			grid-template-columns: 44px minmax(0, 1fr) auto;
			grid-template-rows: auto;
			grid-template-areas: 'home league account';
		}

		.top[data-rows='1'] .tail {
			display: none;
		}

		.league {
			grid-area: league;
		}

		.home {
			grid-area: home;
			display: grid;
			margin: -10px 0 -10px -10px;
		}

		h1 {
			display: none;
		}

		/* The stamp gives way to the verb beside it: on the narrowest phone it wraps within its row
		   rather than push the verb past the edge (Lane 132, rail-shots at 360). */
		.stamp {
			grid-area: stamp;
			margin-left: 0;
		}

		.stamp :global(.stamp) {
			white-space: normal;
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
