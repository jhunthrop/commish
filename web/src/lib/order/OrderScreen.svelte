<script lang="ts">
	import BasisBlock from '#lib/ui/BasisBlock.svelte';
	import { onMount, untrack } from 'svelte';
	import { hitsWords } from '#lib/format/pool-words.ts';
	import { memberZone } from '#lib/format/clock.ts';
	import { ApiError } from '#lib/api/client.ts';
	import type { LeagueHost } from '#lib/league/api.ts';
	import { positionWord } from '#lib/league/box/box.ts';
	import { sheetTags } from '#lib/league/sheet-tags.ts';
	import RowSheetMark from '#lib/site/RowSheetMark.svelte';
	import type { SheetPlayer } from '#lib/sheet/model.ts';
	import type { Position } from '#lib/types/player.ts';
	import { orderApi, type OrderAdvice, type OrderPosition } from './api.ts';
	import { MIN_SEARCH } from './path.ts';
	import {
		ORDER,
		ORDER_POSITIONS,
		orderBasis,
		moveHref,
		moveWords,
		orderView,
		rosterFilter,
		type OrderView,
		type RosterView
	} from './order.ts';
	import OrderTable from './OrderTable.svelte';
	import type { BoxRow } from '#lib/league/box/box.ts';
	import { tabHref } from '#lib/league/inseason/tabs.ts';
	import { links } from '#lib/site/links.ts';
	import { compareOffer, rowBySlug, type ScreenOffer } from '#lib/player/shelf-state.ts';
	import { providePlayerShelf } from '#lib/player/shelf-host.ts';
	import PlayerShelfLayer from '#lib/player/PlayerShelfLayer.svelte';

	/** The Rest of season and Players screens' table, its filters and its basis (Lane 66j), read from
	 * the API: for the selected league with its rosters and moves on Rest of season, for a 12-team PPR
	 * league on Players and with no league. Every figure is the API's. */
	interface Props {
		/** rest: the board's page in season, its position chips its own links; players: the search
		 * first and the position chips here, never a league. */
		mode: 'rest' | 'players';
		/** The position the page is on (rest), or the one the Players screen opens on. */
		position?: OrderPosition | null;
		/** The selected league on Rest of season: its id and platform; null without one. */
		league?: { id: string; host: LeagueHost } | null;
		label: string;
		/** The rank's head over #: the Players page's "Week 7 rank" in season (Lane 142), else our
		 * rest-of-season order's. */
		rankHead?: string;
	}

	let { mode, position: opened = null, league = null, label, rankHead }: Props = $props();

	/** The rows one read asks for, and how many more Show more adds, up to the API's limit. */
	const PAGE_ROWS = 100;
	const MAX_ROWS = 400;
	/** How long a search waits after the last key before it reads. */
	const SEARCH_PAUSE_MS = 250;

	// svelte-ignore state_referenced_locally
	let position = $state<OrderPosition | null>(opened);
	// The page's position chips are links on the same route: when the page moves to another position
	// the table reads it (review 66j H1).
	$effect(() => {
		const next = opened;
		untrack(() => {
			if (next === position) return;
			position = next;
			limit = PAGE_ROWS;
			void read();
		});
	});
	let q = $state('');
	let limit = $state(PAGE_ROWS);
	let roster = $state<RosterView>('everyone');
	let advice = $state<OrderAdvice | null>(null);
	/** The instant the answer is drawn at, in ms, set with each answer (the page's one clock). */
	let now = $state(0);
	let problem = $state<string | null>(null);
	let reading = $state(true);
	let latest = 0;
	let pause: ReturnType<typeof setTimeout> | undefined;

	const leagueId = $derived(mode === 'rest' ? (league?.id ?? null) : null);
	const views = $derived(
		advice?.rows.map((row) => orderView(row, memberZone(), position === null, now)) ?? []
	);
	const basis = $derived(
		advice === null
			? []
			: orderBasis(
					advice,
					mode === 'rest' && league !== null ? { host: league.host } : null,
					memberZone(),
					now
				)
	);
	/** A search, a position or a roster filter: the hits are matches, no longer the pool. */
	const filtered = $derived(
		q.trim().length >= MIN_SEARCH || position !== null || roster !== 'everyone'
	);
	const more = $derived(advice !== null && advice.total > advice.rows.length && limit < MAX_ROWS);
	const tableLeague = $derived(
		leagueId === null || league === null || advice === null
			? null
			: { id: leagueId, host: league.host, moves: advice.moves }
	);

	/** The player shelf's verb (Lane 113): Compare on Players; on Rest of season the row's own move
	 * (Trade for him, or the add), none on a row with no move. */
	function shelfOffer(tapped: BoxRow): ScreenOffer | null {
		if (mode === 'players')
			return tapped.slug === null ? null : compareOffer(links.compare(tapped.slug));
		const view = views.find((v) => v.box.key === tapped.key);
		const href = view === undefined ? null : moveHref(view, tableLeague?.id ?? null, tabHref);
		if (view === undefined || href === null || tableLeague === null) return null;
		return {
			label: moveWords(view, tableLeague.moves, tableLeague.host),
			line: null,
			href,
			run: null,
			focus: null
		};
	}

	// The screen's mode is fixed for its life.
	// svelte-ignore state_referenced_locally
	const shelf = providePlayerShelf({
		screen: mode,
		now: () => now,
		league: () => (mode === 'rest' ? league : null),
		offer: shelfOffer,
		rowOf: (slug) =>
			rowBySlug(
				views.map((v) => v.box),
				slug
			)
	});

	async function read(): Promise<void> {
		const mine = (latest += 1);
		reading = true;
		try {
			const answer = await orderApi.read(leagueId, {
				position,
				q: q.trim().length >= MIN_SEARCH ? q : null,
				roster: rosterFilter(roster),
				limit
			});
			if (mine !== latest) return;
			now = Date.now();
			advice = answer;
			problem = null;
		} catch (error) {
			if (mine !== latest) return;
			problem = error instanceof ApiError ? error.message : ORDER.unread;
		} finally {
			if (mine === latest) reading = false;
		}
	}

	onMount(() => {
		void read();
		return () => clearTimeout(pause);
	});

	function search(next: string): void {
		q = next;
		limit = PAGE_ROWS;
		clearTimeout(pause);
		pause = setTimeout(() => void read(), SEARCH_PAUSE_MS);
	}

	function choose(next: OrderPosition | null): void {
		position = next;
		limit = PAGE_ROWS;
		void read();
	}

	/** The roster chips read the API's filter, so the limit and Show more count after it (review 66j H5). */
	function filter(next: RosterView): void {
		roster = next;
		limit = PAGE_ROWS;
		void read();
	}

	function showMore(): void {
		limit = Math.min(MAX_ROWS, limit + PAGE_ROWS);
		void read();
	}

	/** The sheet's player for a row: his board id; the order's positions are the sheet's own. */
	function sheetPlayer(row: OrderView): SheetPlayer {
		return {
			id: row.key,
			name: row.box.name,
			position: row.box.position as Position,
			team: row.box.club,
			headshot: row.box.face.src
		};
	}
</script>

{#snippet sheetMark(row: OrderView)}
	<RowSheetMark player={sheetPlayer(row)} />
{/snippet}

<div class="order-screen" class:players={mode === 'players'}>
	{#if mode === 'players'}
		<label class="search big">
			<span class="vh">{ORDER.search}</span>
			<input
				type="search"
				placeholder={ORDER.search}
				value={q}
				oninput={(event) => search(event.currentTarget.value)}
			/>
			{#if advice}<span class="hits">{hitsWords(advice.total, filtered)}</span>{/if}
		</label>
	{/if}
	<div class="filters">
		{#if mode === 'players'}
			<div class="chips" role="group" aria-label="Position">
				<button type="button" aria-pressed={position === null} onclick={() => choose(null)}
					>{ORDER.every}</button
				>
				{#each ORDER_POSITIONS as p (p)}
					<button type="button" aria-pressed={position === p} onclick={() => choose(p)}
						>{positionWord(p)}</button
					>
				{/each}
			</div>
		{:else}
			{#if leagueId !== null}
				<div class="chips" role="group" aria-label={ORDER.roster}>
					{#each [['everyone', ORDER.everyone], ['free', ORDER.free], ['yours', ORDER.yours]] as const as [view, words] (view)}
						<button type="button" aria-pressed={roster === view} onclick={() => filter(view)}
							>{words}</button
						>
					{/each}
				</div>
			{/if}
			<label class="search">
				<span class="vh">{ORDER.search}</span>
				<input
					type="search"
					placeholder={ORDER.search}
					value={q}
					oninput={(event) => search(event.currentTarget.value)}
				/>
			</label>
		{/if}
	</div>

	{#if problem}
		<p class="problem" role="alert">{problem}</p>
	{/if}
	{#if advice === null}
		<p class="reading" aria-live="polite">{reading ? ORDER.reading : ''}</p>
	{:else if advice.total === 0}
		<p class="reading">{ORDER.none}</p>
	{:else}
		<div class:dim={reading}>
			<OrderTable
				{label}
				{rankHead}
				rows={views}
				rankBy={advice.rank_by}
				week={advice.week}
				league={tableLeague}
				tagsOf={sheetTags}
				end={mode === 'players' ? sheetMark : undefined}
			/>
		</div>
	{/if}
	{#if more}
		<button type="button" class="more" onclick={showMore}>{ORDER.moreRows}</button>
	{/if}

	<!-- One paragraph; a sentence about a column the phone does not draw is not said there. -->
	<BasisBlock parts={basis} />
	<PlayerShelfLayer host={shelf} />
</div>

<style>
	.order-screen {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
		min-width: 0;
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-2) var(--s-3);
	}

	.chips {
		display: inline-flex;
		gap: 2px;
		padding: 3px;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-pill);
		background: var(--surface);
	}

	.chips button {
		height: 30px;
		padding: 0 var(--s-3);
		border: 0;
		border-radius: var(--r-pill);
		background: transparent;
		color: var(--ink-2);
		font: inherit;
		font-size: var(--t-sm);
		font-weight: 600;
		cursor: pointer;
	}

	.chips button[aria-pressed='true'] {
		background: var(--ink);
		color: var(--bg);
	}

	.search {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		height: 38px;
		min-width: 220px;
		padding: 0 var(--s-3);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: var(--surface);
	}

	.search input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: var(--t-md);
		outline: 0;
	}

	.search:focus-within {
		outline: 2px solid var(--focus);
		outline-offset: 1px;
	}

	.search.big {
		max-width: 640px;
		height: 48px;
	}

	.search.big input {
		font-size: var(--t-lg);
	}

	.hits {
		font-size: var(--t-sm);
		color: var(--ink-3);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.reading,
	.problem {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-3);
	}

	.problem {
		color: var(--loss-ink);
	}

	.dim {
		opacity: 0.6;
		transition: opacity 120ms;
	}

	.more {
		align-self: center;
		height: 36px;
		padding: 0 var(--s-4);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.vh {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	@media (max-width: 760px) {
		.chips {
			max-width: 100%;
			overflow-x: auto;
			scrollbar-width: none;
		}

		.chips button {
			flex: none;
			padding: 0 10px;
		}

		.search {
			flex: 1;
			min-width: 0;
		}
	}
</style>
