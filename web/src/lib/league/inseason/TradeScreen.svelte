<script lang="ts">
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import { links } from '#lib/site/links.ts';
	import type { LeagueHost } from '../api.ts';
	import TradeFinder from '../box/TradeFinder.svelte';
	import TradeStrip from '../box/TradeStrip.svelte';
	import {
		copiedTrade,
		finderRows,
		offerText,
		proposeVerb,
		sortRows,
		TRADES,
		tradeBasis,
		worthProposing,
		type CopiedTrade,
		type FinderRow,
		type SortKey
	} from '../box/trades.ts';
	import Screen from './Screen.svelte';
	import PickSelect, { type PickGroup, type PickOption } from './PickSelect.svelte';
	import TradeBuilder from './TradeBuilder.svelte';
	import type {
		PlayerLine,
		TradeAdvice,
		TradeCheck,
		TradeCheckInput,
		TradeRow,
		TradeTeam
	} from './api.ts';
	import { BUILDER_LINES, builtFrom, type Picks } from './builder.ts';
	import { Narrowing, pickKey, pickerPlayers, tradeHolding } from './state.ts';
	import { EVERY_TRADE, LINES, noTradeWith, tradeDecision } from './words.ts';

	/** The Trades screen as a trade table (spec §6, Lane 66g): a strip naming the trades worth
	 * proposing, each with both sides, both gains and its one verb; the picker that narrows to the
	 * trades holding one player, best with each team or every trade, and Build a trade; the finder, one
	 * trade a row, sortable by each side's gain and change in this week's Proj, a tap opening its
	 * players in the box score's columns; the builder under the strip, two box scores under a
	 * scoreboard; and the basis said once under the rows in five lines. The verb follows the moves
	 * rule: Propose on the platform where it takes a proposal from here (none today), else Open the
	 * platform's trades, which copies the offer and opens its page. We never send one. */
	interface Props {
		advice: TradeAdvice;
		host: LeagueHost;
		/** The member's team, as the switch names it, over the builder's box and the opened rows. */
		me: { name: string; aside: string };
		/** Reads the trades holding one player, by his board id. */
		narrow: (player: string) => Promise<TradeAdvice>;
		/** Checks one trade the member built. */
		check: (trade: TradeCheckInput) => Promise<TradeCheck>;
		/** Puts the offer on the clipboard. */
		copy?: (text: string) => Promise<void>;
	}

	let {
		advice,
		host,
		me,
		narrow,
		check,
		copy = (text) => navigator.clipboard.writeText(text)
	}: Props = $props();

	/** The builder's id, for the verbs that open it. */
	const BUILDER_ID = 'trade-builder';
	/** The space before the basis's link, an expression so the template's own breaks add none. */
	const SPACE = ' ';

	/** The trade the builder opened with, and a count that makes it again for each opening; null
	 * while it is closed. */
	let building = $state<{ picks: Picks; opening: number } | null>(null);
	let openings = 0;

	function build(picks: Picks): void {
		openings += 1;
		building = { picks, opening: openings };
	}

	/** Build a trade with the first team that has a trade found, else the first team. */
	function buildNew(): void {
		const first = shown.teams.find((t) => t.trades.length > 0) ?? shown.teams[0];
		build({ team: first?.roster_id ?? null, give: [], get: [] });
	}

	// The route's reader is fixed for the page's life.
	// svelte-ignore state_referenced_locally
	const narrowing = new Narrowing(narrow);

	/** The player the trades are narrowed to, by board id; null for every trade. */
	let player = $state<string | null>(null);
	let narrowed = $state<TradeAdvice | null>(null);
	let reading = $state(false);
	let problem = $state<string | null>(null);
	/** Every trade, or each team's best. */
	let every = $state(false);
	let sort = $state<SortKey>('mine');

	const pickOption = (line: PlayerLine): PickOption => ({
		value: pickKey(line),
		label: line.player.name
	});

	const players = $derived(pickerPlayers(advice.roster, advice.teams));
	const pickGroups = $derived<PickGroup[]>([
		{ label: null, options: [{ value: '', label: EVERY_TRADE }] },
		{ label: LINES.yourPlayers, options: players.yours.map(pickOption) },
		{ label: LINES.theirPlayers, options: players.theirs.map(pickOption) }
	]);
	const pickedName = $derived(
		[...players.yours, ...players.theirs].find((l) => pickKey(l) === player)?.player.name ?? ''
	);

	const shown = $derived(narrowed ?? advice);
	const holds = (row: TradeRow, id: string): boolean =>
		[...row.give, ...row.get].some((line) => line.player.board_id === id);
	/** The teams' trades shown: narrowed to a player's while his are read, his own once they are. */
	const teams = $derived(
		shown.teams.map((team) => ({
			...team,
			trades: team.trades.filter((row) => player === null || holds(row, player))
		}))
	);
	const rows = $derived(sortRows(finderRows(teams, every), sort));
	const worth = $derived(worthProposing(advice.teams));
	const none = $derived(!reading && !tradeHolding(shown.teams, player));
	const verb = $derived(proposeVerb(advice.moves, host));
	const decision = $derived(
		none
			? noTradeWith(pickedName)
			: tradeDecision(worth[0] ? { row: worth[0].row, team: worth[0].team.name } : null)
	);
	/** Every line the table and the builder can show, for the Game cell's read said once. */
	const lines = $derived([
		...advice.roster,
		...advice.teams.flatMap((t) => [...t.roster, ...t.trades.flatMap((r) => [...r.give, ...r.get])])
	]);
	const basisLines = $derived(tradeBasis(advice, host, lines));
	const everyCount = $derived(advice.teams.reduce((n, t) => n + t.trades.length, 0));
	const bestCount = $derived(advice.teams.filter((t) => t.trades.length > 0).length);

	async function pick(next: string | null): Promise<void> {
		player = next;
		narrowed = null;
		problem = null;
		reading = next !== null;
		// A player our board does not place is in no trade: nothing to read.
		const outcome = await narrowing.choose(next?.startsWith('host:') ? null : next);
		if (outcome.kind === 'overtaken') return;
		reading = false;
		if (outcome.kind === 'answer') narrowed = outcome.answer;
		if (outcome.kind === 'failed') problem = outcome.sentence;
	}

	/** Copies a trade's offer for the member to propose on the platform: the line under the verb. */
	async function propose(
		team: TradeTeam,
		row: Pick<TradeRow, 'give' | 'get'>
	): Promise<CopiedTrade> {
		try {
			await copy(offerText(team, row));
			return copiedTrade(host, true);
		} catch {
			return copiedTrade(host, false);
		}
	}

	const proposeRow = (entry: FinderRow): Promise<CopiedTrade> => propose(entry.team, entry.row);

	function buildFrom(entry: FinderRow): (() => void) | null {
		const filled = builtFrom(entry.team, entry.row);
		return filled ? () => build(filled) : null;
	}
</script>

<Screen
	{decision}
	verb={null}
	href={shown.host_trades_url}
	basis={null}
	basisNote={null}
	panelVerb={building !== null}
>
	{#snippet summary()}
		{#if !none && worth.length > 0}
			<TradeStrip
				week={advice.week}
				rows={worth}
				{host}
				moves={advice.moves}
				href={advice.host_trades_url}
				propose={proposeRow}
			/>
		{:else}<p class="none-line">{decision}</p>{/if}
	{/snippet}
	{#snippet move()}
		{#if building}
			{#key building.opening}
				<TradeBuilder
					id={BUILDER_ID}
					teams={advice.teams}
					roster={advice.roster}
					{me}
					{host}
					moves={advice.moves}
					start={building.picks}
					basis={advice.check_basis}
					href={advice.host_trades_url}
					hostNote={advice.host_note}
					{check}
					{propose}
					onclose={() => (building = null)}
				/>
			{/key}
		{/if}
	{/snippet}
	<div class="tools">
		<PickSelect
			label={LINES.tradesHolding}
			value={player ?? ''}
			groups={pickGroups}
			onchange={(value: string) => void pick(value === '' ? null : value)}
		/>
		<ChipGroup label={TRADES.every}>
			<Chip size="sm" pressed={!every} onclick={() => (every = false)}
				>{TRADES.best}, {bestCount}</Chip
			>
			<Chip size="sm" pressed={every} onclick={() => (every = true)}
				>{TRADES.every}, {everyCount}</Chip
			>
		</ChipGroup>
		<span class="build"
			><Quiet size="sm" controls={BUILDER_ID} expanded={building !== null} onclick={buildNew}
				>{BUILDER_LINES.open}</Quiet
			></span
		>
	</div>
	{#if problem}<ProblemLine>{problem}</ProblemLine>{/if}
	<div class="finder-wrap" class:reading aria-busy={reading}>
		<TradeFinder
			{rows}
			{sort}
			onsort={(by: SortKey) => (sort = by)}
			me={me.name}
			href={advice.host_trades_url}
			{verb}
			propose={proposeRow}
			build={buildFrom}
			builderId={BUILDER_ID}
		/>
	</div>
	<div class="basis">
		{#each basisLines as said, i (i)}
			<p class:first={i === 0}>
				{said}{#if i === 0}{SPACE}<a href={links.record()}>{LINES.orderRecord}</a>{/if}
			</p>
		{/each}
	</div>
</Screen>

<style>
	.tools {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--s-2) var(--s-3);
	}

	.build {
		margin-left: auto;
	}

	/* While a player's trades are read, the last answer's stay, quieter. */
	.reading {
		opacity: 0.6;
	}

	.none-line {
		margin: 0;
		font-size: var(--t-lg);
		font-weight: 600;
	}

	.basis {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-width: 100ch;
	}

	.basis p {
		margin: 0;
		font-size: var(--t-sm);
		line-height: 1.45;
		color: var(--ink-3);
	}

	.basis .first {
		color: var(--ink-2);
	}

	.basis a {
		color: var(--accent-text);
		white-space: nowrap;
	}

	@media (max-width: 760px) {
		.basis p {
			font-size: var(--t-xs);
		}
	}
</style>
