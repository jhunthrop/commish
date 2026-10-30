<script lang="ts">
	import { memberZone } from '#lib/format/clock.ts';
	import BasisBlock from '#lib/ui/BasisBlock.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import StripAction from '#lib/ui/StripAction.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import type { LeagueHost } from '../api.ts';
	import { positionWord } from '../box/box.ts';
	import PickupStrip from '../box/PickupStrip.svelte';
	import PositionNav from '../box/PositionNav.svelte';
	import { PANEL, panelHasWeek, type PanelMode } from '../box/positions.ts';
	import {
		ALL,
		atPosition,
		NAV,
		navCards,
		navCounts,
		navLead,
		navSort,
		openingKey,
		withoutRostered,
		yoursRows,
		type NavKey
	} from '../box/position-nav.ts';
	import { addressedWeek, arrivesPart, weekProjected } from '../box/next-week.ts';
	import WaiverTable from '../box/WaiverTable.svelte';
	import {
		addVerbWords,
		cardGains,
		cardName,
		copiedWords,
		countWords,
		dropRows,
		findRows,
		headBasis,
		moveWords,
		namesOnScreen,
		nextSort,
		pickupCards,
		poolRows,
		sortRows,
		stashBasis,
		stashRows,
		STASH,
		stripDecision,
		WAIVERS,
		waiverBasis,
		withDrop,
		type CopiedLine,
		type DropRow,
		type PickupCard,
		type PoolRow,
		type Sort,
		type SortKey
	} from '../box/waivers.ts';
	import MovePanel from './MovePanel.svelte';
	import Screen from './Screen.svelte';
	import type {
		HostMoveInput,
		HostMovePlan,
		HostMoveResult,
		WaiverAdvice,
		WaiverPosition,
		WaiverRow
	} from './api.ts';
	import {
		bidProblem,
		claimMove,
		claimsAdd,
		claimsOnHost,
		failedStep,
		planStep,
		resultStep,
		type MoveStep
	} from './move.ts';
	import { Narrowing } from './state.ts';
	import { NOT_FREE, POSITION_PARAM, askedPlayer, markAsked } from '../box/asked.ts';
	import { onMount, tick, untrack } from 'svelte';
	import { LINES } from './words.ts';
	import { page } from '$app/state';
	import type { BoxRow } from '../box/box.ts';
	import { rowBySlug, type ScreenOffer } from '#lib/player/shelf-state.ts';
	import { providePlayerShelf } from '#lib/player/shelf-host.ts';
	import PlayerShelfLayer from '#lib/player/PlayerShelfLayer.svelte';

	/** Waivers (spec §5) as a pickup table (Lane 66f): a strip with a card for each pickup worth
	 * making (it starts this week, the lineup's Proj rises and the rest of the season does not fall),
	 * then the players free to add in the Lineup's columns with Rest of season and Beats, sorted by
	 * any head, a position at a time or by name. Add opens the players he could replace in the same
	 * columns, the advice's drop first. One rule for every verb, read from the API's moves fields as
	 * the Lineup reads its own: where the claim is made from here it reads "Add on ESPN" and opens
	 * the confirmation (spec §10.2); elsewhere "Open ESPN waivers" copies his name and opens the
	 * platform's waiver page, the API's line under it saying why. */
	interface Props {
		advice: WaiverAdvice;
		host: LeagueHost;
		/** Reads the adds at one position. */
		narrow: (position: WaiverPosition) => Promise<WaiverAdvice>;
		/** Plans the claim in words with its confirm token; nothing is sent. */
		plan: (move: HostMoveInput) => Promise<HostMovePlan>;
		/** Makes the planned claim once with its token. */
		make: (move: HostMoveInput, confirm: string) => Promise<HostMoveResult>;
		/** Reads the adds again, once a claim has been made. */
		reread: () => void;
		/** Puts a name on the clipboard. */
		copy?: (text: string) => Promise<void>;
		/** Opens the platform's page in a new tab. */
		openPage?: (href: string) => void;
		/** The instant the answer was read, in ms: the page's clock the rows and the basis draw at. */
		now: number;
	}

	let {
		advice,
		host,
		narrow,
		plan,
		make,
		reread,
		copy = (text) => navigator.clipboard.writeText(text),
		openPage = (href) => void window.open(href, '_blank', 'noopener'),
		now: pageNow
	}: Props = $props();

	const MOVE_ID = 'claim-move';
	/** How long a typed bid rests before the claim is planned again for it: long enough that a
	 * member still typing costs no plan (each plan reads ESPN twice). */
	const BID_PAUSE_MS = 600;
	/** The positions the route narrows to, in the board's order. */
	const POSITIONS: readonly WaiverPosition[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
	const COMPARE_ID = 'waiver-compare';

	let step = $state<MoveStep>({ kind: 'closed' });
	/** The claim as last planned: the one the token makes, whatever is typed meanwhile. */
	let planned: HostMoveInput | null = null;
	/** The row the confirmation is for. */
	let claiming = $state<WaiverRow | null>(null);
	/** The bid as typed; the plan's own bid until the member types one. */
	let typed = $state('');
	let replanning = $state(false);
	let pause: ReturnType<typeof setTimeout> | undefined;

	/** The card chosen (Lane 305): the screen opens on the weakest Need, All where none. */
	// svelte-ignore state_referenced_locally
	const opening = openingKey(advice);
	let position = $state<WaiverPosition | null>(opening === ALL ? null : opening);
	/** The toggle: the cards and the list read for the rest of the season or this week. */
	let mode = $state<PanelMode>('season');
	/** The answer for the chosen position, null for every position or until it is read. */
	let narrowed = $state<WaiverAdvice | null>(null);
	/** When the narrowed answer was read, in ms: a narrowed read is a read of its own, so its rows
	 * and basis draw at its instant, the page's clock otherwise (review 77 finding 1). */
	let narrowedAt = $state<number | null>(null);
	const now = $derived(narrowed !== null && narrowedAt !== null ? narrowedAt : pageNow);
	let reading = $state(false);
	let problem = $state<string | null>(null);
	let query = $state('');
	let sort = $state<Sort>(navSort('season'));
	/** The row whose drops are open, and the drop chosen there. */
	let open = $state<string | null>(null);
	let chosenDrop = $state<string | null>(null);
	/** The card the pinned verb acts on. */
	let chosenCard = $state<string | null>(null);
	/** What the platform verb said, once pressed. */
	let copied = $state<CopiedLine | null>(null);

	/** The chosen position's rows from the first answer until its own read lands; its own read kept
	 * while the next lands, less anyone the fresher answer has on the member's roster (review 305 H2). */
	const shown = $derived(
		narrowed ? withoutRostered(narrowed, advice.roster) : atPosition(advice, position ?? ALL)
	);
	/** "Week 7 projections expected Thursday.", over the table while the week has no Proj (Lane 95). */
	const arrives = $derived(arrivesPart(shown, addressedWeek(shown), memberZone()));
	/** Every free agent of the first answer, the All card's counts. */
	const allPool = $derived(
		poolRows(
			{ rows: advice.rows, pickups: advice.pickups, roster: advice.roster },
			memberZone(),
			pageNow
		)
	);
	const navKey = $derived<NavKey>(position ?? ALL);
	const cardsNav = $derived(
		navCards(
			advice,
			mode,
			navCounts(allPool),
			new Map(
				POSITIONS.map(
					(p) => [p, navCounts(allPool.filter((r) => r.source.add.player.position === p))] as const
				).filter(([, c]) => c.free > 0)
			)
		)
	);
	const lead = $derived(navLead(advice, navKey, mode));
	/** The member's players at the chosen position over its free agents, one comparison. */
	const compare = $derived(
		position === null || !advice.positions?.some((c) => c.position === position)
			? null
			: {
					yours: NAV.yours(positionWord(position)),
					free: NAV.freeAt(positionWord(position)),
					rows: yoursRows(advice, position, mode, memberZone(), pageNow)
				}
	);
	const pool = $derived(
		poolRows({ rows: shown.rows, pickups: advice.pickups, roster: shown.roster }, memberZone(), now)
	);
	/** The line under the column heads (Lane 98, B35). */
	const heads = $derived(
		headBasis(shown.projection_previous_read_at, weekProjected(shown), {
			zone: memberZone(),
			zoned: false
		})
	);
	const rows = $derived(findRows(sortRows(pool, sort), query));
	/** The Stash group (Lane 118, B79): its rows, sorted and found as the table's, and its line. */
	const stashPool = $derived(
		stashRows(
			{
				rows: shown.rows,
				pickups: advice.pickups,
				roster: shown.roster,
				stash: shown.stash,
				week: shown.week,
				for_week: shown.for_week
			},
			memberZone(),
			now
		)
	);
	const stash = $derived(findRows(sortRows(stashPool, sort), query));
	const stashLine = $derived(stashBasis(shown));
	const cards = $derived(pickupCards(advice));
	const card = $derived(cards.find((c) => c.key === chosenCard) ?? cards[0] ?? null);
	const openRow = $derived([...pool, ...stashPool].find((r) => r.key === open) ?? null);
	const drops = $derived(openRow ? dropRows(openRow.source, shown.roster, memberZone(), now) : []);
	const drop = $derived(drops.find((d) => d.key === chosenDrop) ?? drops[0] ?? null);
	const onHost = $derived(claimsOnHost(shown));
	/** Every line on the screen, for the game facts' read said once under the rows. */
	const lines = $derived([...shown.rows.map((r) => r.add), ...shown.roster]);

	// The route's reader is fixed for the page's life.
	// svelte-ignore state_referenced_locally
	const narrowing = new Narrowing(narrow);

	/** The verb for a row: the claim from here where the API opens it and names him, else the page. */
	function claimsHere(row: WaiverRow): boolean {
		return claimsAdd(shown.moves, row.add.player.host_id);
	}

	function verbWords(row: WaiverRow): string {
		return addVerbWords(shown.moves, row.add.player.host_id, host);
	}

	/** The platform verb: his name on the clipboard, started while this page has the focus, and the
	 * platform's waiver page in a new tab. */
	function openPlatform(row: WaiverRow): void {
		const name = row.add.player.name;
		const said = copy(name);
		if (shown.host_waivers_url !== '') openPage(shown.host_waivers_url);
		const saidAs = cardName(name, namesOnScreen(shown));
		said.then(
			() => (copied = copiedWords(host, saidAs, true)),
			() => (copied = copiedWords(host, saidAs, false))
		);
	}

	function act(row: WaiverRow): void {
		if (claimsHere(row)) openClaim(row);
		else openPlatform(row);
	}

	/** Plans the claim for the row with the bid (null: none typed yet, the plan says the league's
	 * least where it bids). Only the latest plan is kept. */
	async function planFor(row: WaiverRow, bid: number | null): Promise<void> {
		const move = claimMove(shown.week, row, bid);
		planned = move;
		if (bid === null) step = { kind: 'planning' };
		else replanning = true;
		try {
			const answer = await plan(move);
			if (planned !== move) return;
			step = planStep(answer);
			// The first plan says the league's least bid: planned again as that number, so the token
			// makes the bid the member sees, never one the API derives again at send time.
			if (bid === null && answer.bid) {
				typed = String(answer.bid.amount);
				void planFor(row, answer.bid.amount);
			}
		} catch (error) {
			if (planned === move) {
				step = failedStep(error, host, 'plan', shown.host_waivers_url, 'claim');
			}
		} finally {
			if (planned === move) replanning = false;
		}
	}

	function openClaim(row: WaiverRow): void {
		// One claim at a time: while one is on its way, its answer stays on screen.
		if (step.kind === 'sending') return;
		claiming = row;
		typed = '';
		void planFor(row, null);
	}

	/** A typed bid: planned again once it rests, when the league takes it. */
	function onbid(value: string): void {
		typed = value;
		clearTimeout(pause);
		const row = claiming;
		if (row === null || step.kind !== 'confirm' || step.plan.bid === null) return;
		if (bidProblem(host, value, step.plan.bid) !== null) return;
		pause = setTimeout(() => void planFor(row, Number(value)), BID_PAUSE_MS);
	}

	async function confirm(): Promise<void> {
		if (step.kind !== 'confirm' || planned === null) return;
		const { plan: ready } = step;
		step = { kind: 'sending', plan: ready };
		try {
			step = resultStep(await make(planned, ready.confirm));
			reread();
		} catch (error) {
			step = failedStep(error, host, 'make', shown.host_waivers_url, 'claim');
		}
	}

	function close(): void {
		clearTimeout(pause);
		step = { kind: 'closed' };
		planned = null;
		claiming = null;
	}

	/** A card: All, or a position the league starts. */
	function chooseKey(key: NavKey): void {
		void choose(key === ALL ? null : key);
	}

	/** The toggle: the cards' figures and the list's order together (ruling 4). */
	function chooseMode(next: PanelMode): void {
		mode = next;
		sort = navSort(next);
	}

	async function choose(next: WaiverPosition | null): Promise<void> {
		position = next;
		narrowed = null;
		problem = null;
		open = null;
		reading = next !== null;
		const outcome = await narrowing.choose(next);
		if (outcome.kind === 'overtaken') return;
		reading = false;
		if (outcome.kind === 'answer') land(outcome.answer);
		if (outcome.kind === 'failed') problem = outcome.sentence;
	}

	/** A position's own answer on screen, drawn at the instant it was read. */
	function land(answer: WaiverAdvice): void {
		narrowedAt = Date.now();
		narrowed = answer;
	}

	/** The line a failed top-up leaves, so a later top-up that lands takes only its own line away. */
	let toppedProblem: string | null = null;

	/** The chosen position read again without dimming its rows or closing an open Add: on landing,
	 * its rows from the first answer already listed (review 305 M6), and whenever the page's answer is
	 * replaced, after a claim and on the minute's read, so the list is never older than the cards and
	 * the member's players (H2). A failed top-up keeps the first answer's rows and says so briefly. */
	async function topUp(key: WaiverPosition, base: WaiverAdvice): Promise<void> {
		const outcome = await narrowing.choose(key);
		// Overtaken by a tap, a later answer's own top-up, or the card moved on: theirs to draw.
		if (outcome.kind === 'overtaken' || position !== key || advice !== base) return;
		// It may have overtaken a tapped read of the same position: it answers for that one too.
		reading = false;
		if (outcome.kind === 'answer') {
			land(outcome.answer);
			if (problem !== null && problem === toppedProblem) problem = null;
			toppedProblem = null;
			return;
		}
		if (outcome.kind === 'failed') {
			narrowed = null;
			toppedProblem = NAV.firstRead(positionWord(key));
			problem = toppedProblem;
		}
	}

	/** Each answer the page reads (the first one too) tops the chosen position's list up. A player page's
	 * named player (?player=) takes the landing over in onMount, overtaking the first top-up. */
	$effect(() => {
		const answer = advice;
		untrack(() => {
			if (position !== null) void topUp(position, answer);
		});
	});

	/** Another row's drops or another card: the last copy's confirm is for neither (review 66f L6). */
	function toggle(row: PoolRow): void {
		open = open === row.key ? null : row.key;
		chosenDrop = null;
		copied = null;
	}

	function chooseCard(c: PickupCard): void {
		chosenCard = c.key;
		copied = null;
	}

	function onsort(key: SortKey): void {
		sort = nextSort(sort, key);
	}

	/** A player page's verb names him (?player=, and his position, Lane 66h): the adds narrow to his
	 * position when the first answer does not hold him, his row opens on its drops, the claim's way
	 * in, and is marked and brought into view. */
	onMount(async () => {
		const asked = askedPlayer(window.location.href);
		// The opening card's own read is the first top-up's (the effect above).
		if (asked === null) return;
		// A named player: every position first, his own where the first answer does not hold him.
		await choose(null);
		const his = (): PoolRow | undefined => pool.find((r) => r.source.add.player.board_id === asked);
		const at = new URL(window.location.href).searchParams.get(POSITION_PARAM);
		const narrowTo = POSITIONS.find((p) => p === at);
		if (his() === undefined && narrowTo !== undefined) await choose(narrowTo);
		const row = his();
		// Claimed since, or not free in this league: the screen says so rather than nothing.
		if (row === undefined) {
			problem = NOT_FREE;
			return;
		}
		open = row.key;
		chosenDrop = null;
		await tick();
		markAsked(document, asked);
	});

	/** The advice's drop for an add: the first the drop panel lists. */
	function advisedDrop(source: WaiverRow): DropRow | null {
		return dropRows(source, shown.roster, memberZone(), now)[0] ?? null;
	}

	/** The player shelf's verb on an add's row (Lane 113): the screen's own, for the add with the
	 * advice's drop, its pair said under it; none on a player of the member's. */
	function shelfOffer(tapped: BoxRow): ScreenOffer | null {
		const entry = [...pool, ...stashPool].find((r) => r.row.key === tapped.key);
		if (entry === undefined) return null;
		const { stash: stashed } = entry;
		// A stash an open IR slot takes: the platform's page with his name, his week said under it.
		if (stashed?.verb === 'stash' && !stashed.drops) {
			return {
				label: STASH.verb,
				line: stashed.back,
				href: null,
				run: () => openPlatform(entry.source),
				focus: null
			};
		}
		const advised = advisedDrop(entry.source);
		const paired = withDrop(entry.source, advised);
		const names = namesOnScreen(shown);
		const move = moveWords({
			add: cardName(paired.add.player.name, names),
			drop: advised ? cardName(advised.row.name, names) : null
		});
		return {
			label: verbWords(paired),
			// The pair and its gain, as the strip's card says them (fix round 1, LOW-8); a stash's week
			// in place of a gain he cannot make before it (Lane 118, B79).
			line: `${move}, ${stashed ? stashed.back : cardGains({ weekGain: paired.week_gain, gain: paired.gain })}`,
			href: null,
			run: () => act(paired),
			// The claim made here opens its confirmation; the platform's page opens in a new tab.
			focus: claimsHere(paired) ? MOVE_ID : null
		};
	}

	const shelf = providePlayerShelf({
		screen: 'waivers',
		now: () => now,
		league: () => ({ id: page.params.id ?? '', host }),
		offer: shelfOffer,
		rowOf: (slug) =>
			rowBySlug(
				[...pool, ...stashPool].map((r) => r.row),
				slug
			)
	});

	/** The pair the drop panel's verb acts on: the open add with the drop chosen. */
	const pair = $derived(openRow ? withDrop(openRow.source, drop) : null);
	/** The basis, one paragraph within five lines at a desk and eight on a phone (Lane 66t). The page
	 * names the zone in its head. */
	const basis = $derived(
		waiverBasis(
			{ ...shown, pickups: advice.pickups },
			lines,
			{ zone: memberZone(), zoned: false },
			now
		)
	);
</script>

{#snippet why()}
	<span class="why" role="status"
		>{#if copied}{copied.said}
			{#if shown.host_waivers_url !== ''}<a
					href={shown.host_waivers_url}
					target="_blank"
					rel="noopener">{copied.page}</a
				>{:else}{copied.page}{/if}.{:else}{shown.moves.reason ??
				shown.host_note ??
				shown.moves.note ??
				''}{/if}</span
	>
{/snippet}

{#snippet strip()}
	<PickupStrip
		week={addressedWeek(advice)}
		{cards}
		sum={advice}
		chosen={card?.key ?? null}
		onchoose={chooseCard}
		verb={cardVerb}
		foot={cards.length > 0 ? why : undefined}
	/>
{/snippet}

<!-- The search: in the filters row at a desk, in the cards' head on a phone (one drawn at a time). -->
{#snippet search()}
	<label class="search"
		><Icon name="search" size={16} /><input
			type="search"
			placeholder={WAIVERS.find}
			aria-label={WAIVERS.find}
			bind:value={query}
		/></label
	>
{/snippet}

{#snippet cardVerb(c: PickupCard, lead: boolean)}
	<StripAction {lead} size="sm" onclick={() => act(c.source)}>{verbWords(c.source)}</StripAction>
{/snippet}

{#snippet go()}
	{#if pair}
		<div class="go">
			<span class="pair"
				><b
					>{moveWords({
						add: cardName(pair.add.player.name, namesOnScreen(shown)),
						drop: drop ? cardName(drop.row.name, namesOnScreen(shown)) : null
					})}</b
				></span
			>
			<span class="go-act">
				{@render why()}
				<Verb size="sm" onclick={() => act(pair)}>{verbWords(pair)}</Verb>
			</span>
		</div>
	{/if}
{/snippet}

<Screen
	decision={stripDecision(cards)}
	verb={card ? verbWords(card.source) : null}
	href={shown.host_waivers_url}
	basis={null}
	deskVerb={false}
	onverb={card ? () => act(card.source) : null}
	controls={onHost ? MOVE_ID : undefined}
	expanded={onHost ? step.kind !== 'closed' : undefined}
	footSays={card !== null}
>
	{#snippet summary()}{@render strip()}{/snippet}
	{#snippet verbFoot()}{@render why()}{/snippet}
	{#snippet move()}
		{#if step.kind !== 'closed'}
			<MovePanel
				id={MOVE_ID}
				kind="claim"
				{step}
				{host}
				{typed}
				{onbid}
				{replanning}
				onconfirm={() => void confirm()}
				onclose={close}
			/>
		{/if}
	{/snippet}
	<PositionNav
		cards={cardsNav}
		chosen={navKey}
		onchoose={chooseKey}
		{mode}
		week={panelHasWeek(advice)}
		onmode={chooseMode}
		controls={COMPARE_ID}
		phoneTools={search}
	/>
	<p class="lead" class:all={navKey === ALL} data-lead>
		<b>{lead.head}</b>{#if lead.words}
			<span>{lead.words}</span>{/if}
	</p>
	<div class="filters">
		{@render search()}
		<span class="count">{countWords(pool, host)}</span>
	</div>
	{#if problem}<ProblemLine>{problem}</ProblemLine>{/if}
	{#if arrives}<p class="arrives">{arrives}</p>{/if}
	<div class="rows" id={COMPARE_ID} class:reading aria-busy={reading}>
		<WaiverTable
			projected={weekProjected(shown)}
			label={LINES.waiverAdds}
			{rows}
			{heads}
			{sort}
			{onsort}
			{open}
			ontoggle={toggle}
			{drops}
			chosen={drop?.key ?? null}
			onchoose={(d: DropRow) => (chosenDrop = d.key)}
			{go}
			empty={compare && query === '' ? PANEL.noneFree : WAIVERS.noneFound}
			{stash}
			{stashLine}
			onstash={(entry: PoolRow) => openPlatform(entry.source)}
			{compare}
		/>
	</div>
	<PlayerShelfLayer host={shelf} />
	<BasisBlock parts={basis} />
</Screen>

<style>
	/* While a position is read, its rows from the last answer stay, quieter. */
	.reading {
		opacity: 0.6;
	}

	/* The chosen card's rank and what it is, over the comparison. */
	.lead {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 2px var(--s-3);
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.lead b {
		font-size: var(--t-md);
		color: var(--ink);
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-3);
	}

	.search {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		flex: 0 1 320px;
		height: 36px;
		padding: 0 var(--s-3);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--ink-3);
	}

	.search input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: transparent;
		font: inherit;
		color: var(--ink);
		outline: none;
	}

	/* Where the Proj columns would be, before the week's projection is read (Lane 95). */
	.arrives {
		margin: 0 0 var(--s-2);
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.count {
		margin-left: auto;
		font-size: var(--t-sm);
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}

	.why {
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.go {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s-4);
	}

	.pair b {
		color: var(--ink);
	}

	.go-act {
		display: flex;
		align-items: center;
		gap: var(--s-3);
		text-align: right;
	}

	@media (max-width: 760px) {
		/* The chosen card says its rank, figure, median and Need, drawn solid over the comparison: on
		   a phone the line repeating it gives way to the comparison (review 305 M5). All keeps its
		   head, the one card whose list is not a comparison. */
		.lead:not(.all) {
			display: none;
		}

		.lead span {
			display: none;
		}

		.search {
			flex: 1 1 auto;
			min-width: 0;
			gap: 6px;
			padding: 0 var(--s-2);
		}

		/* The search sits in the cards' head on a phone, the count is a desk's: the row gives way. */
		.filters {
			display: none;
		}

		.go {
			flex-direction: column;
			align-items: stretch;
			gap: var(--s-2);
		}

		.go-act {
			flex-direction: column-reverse;
			align-items: stretch;
			text-align: left;
		}

		.why {
			display: block;
			text-align: center;
		}
	}
</style>
