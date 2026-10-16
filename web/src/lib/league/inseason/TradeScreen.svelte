<script lang="ts">
	import Label from '#lib/ui/Label.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import ToneChip from '#lib/ui/ToneChip.svelte';
	import type { LeagueHost } from '../api.ts';
	import LineRow from './LineRow.svelte';
	import Screen from './Screen.svelte';
	import TradeBuilder from './TradeBuilder.svelte';
	import type { TradeAdvice, TradeCheck, TradeCheckInput, TradeRow, TradeTeam } from './api.ts';
	import { BUILDER_LINES, builtFrom, type Picks } from './builder.ts';
	import {
		Narrowing,
		bestTrade,
		markedTrade,
		pickKey,
		pickerPlayers,
		tradeHolding,
		tradeKey
	} from './state.ts';
	import {
		CLOSE_FOR_THEM,
		EVERY_TRADE,
		LINES,
		NO_TRADES_WITH_TEAM,
		noTradeWith,
		showMore,
		teamAside,
		tradeDecision,
		tradeGains,
		verbWords
	} from './words.ts';

	/** The trade finder (spec §6): for each other team, its name, owner and record and the trades
	 * that help both lineups, each a give and a get (and the drop a full roster makes for two in)
	 * with both gains: those the other team gains from first, best for you first, then the close
	 * calls for them, as the API orders them; a team with only close calls says so. A player
	 * picked reads the trades holding him again, so no team's list is cut to its first trades.
	 * Propose marks a trade as the decision, by who is in it, so the minute's re-read never moves the
	 * mark to another trade; the one verb opens the host's trade page. We never send an offer.
	 * Build a trade, over the rows, opens the builder for a trade the member has in mind; a row's
	 * Build from this opens it with that trade filled. While it is open its verb is the screen's. */
	interface Props {
		advice: TradeAdvice;
		host: LeagueHost;
		/** Reads the trades holding one player, by his board id. */
		narrow: (player: string) => Promise<TradeAdvice>;
		/** Checks one trade the member built. */
		check: (trade: TradeCheckInput) => Promise<TradeCheck>;
	}

	let { advice, host, narrow, check }: Props = $props();

	/** The builder's id, for the verb that opens it. */
	const BUILDER_ID = 'trade-builder';

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

	/** Trades a team shows before its Show more. */
	const FIRST_TRADES = 2;

	// The route's reader is fixed for the page's life.
	// svelte-ignore state_referenced_locally
	const narrowing = new Narrowing(narrow);

	/** The player the trades are narrowed to, by board id; null for every trade. */
	let player = $state<string | null>(null);
	/** The answer for the chosen player, null for every trade or until it is read. */
	let narrowed = $state<TradeAdvice | null>(null);
	let reading = $state(false);
	let problem = $state<string | null>(null);
	/** The trade the member marked (tradeKey); null keeps the best one as the decision. */
	let marked = $state<string | null>(null);
	/** The teams opened past their first trades. */
	let opened = $state<ReadonlySet<number>>(new Set());

	const holds = (row: TradeRow, id: string): boolean =>
		[...row.give, ...row.get].some((line) => line.player.board_id === id);

	/** Every player on your roster (a trade found or not), then theirs from the trades, each once. */
	const players = $derived(pickerPlayers(advice.roster, advice.teams));
	/** The picked player's name, for the sentence when no trade holds him. */
	const pickedName = $derived(
		[...players.yours, ...players.theirs].find((l) => pickKey(l) === player)?.player.name ?? ''
	);

	const shown = $derived(narrowed ?? advice);
	/** Every team, or narrowed to a player, only the teams with a trade holding him: the narrowed
	 * answer's, or this answer's own while it is read. */
	const teams = $derived(
		shown.teams
			.map((team) => ({
				team,
				trades: team.trades.filter((row) => player === null || holds(row, player))
			}))
			.filter(({ trades }) => player === null || trades.length > 0)
	);

	/** A picked player no trade found holds, once his trades are read: the screen says so. */
	const none = $derived(!reading && !tradeHolding(shown.teams, player));

	/** The marked trade while the answer still holds it, else the best trade shown that the other
	 * team gains from (a close call for them only when there is no other). */
	const chosen = $derived.by(
		(): { row: TradeRow; team: TradeTeam } | null =>
			markedTrade(shown.teams, marked) ??
			bestTrade(teams.map(({ team, trades }) => ({ ...team, trades })))
	);

	async function pick(next: string | null): Promise<void> {
		player = next;
		narrowed = null;
		marked = null;
		problem = null;
		reading = next !== null;
		// A player our board does not place is in no trade: nothing to read.
		const outcome = await narrowing.choose(next?.startsWith('host:') ? null : next);
		if (outcome.kind === 'overtaken') return;
		reading = false;
		if (outcome.kind === 'answer') narrowed = outcome.answer;
		if (outcome.kind === 'failed') problem = outcome.sentence;
	}

	function open(team: number): void {
		opened = new Set([...opened, team]);
	}
</script>

{#snippet trade(team: TradeTeam, row: TradeRow)}
	{@const key = tradeKey(team.roster_id, row)}
	{@const on = marked === key}
	{@const filled = builtFrom(team, row)}
	<div class="trade" class:on>
		{#each row.give as line (line.player.host_id)}<LineRow {line} slot={LINES.give} />{/each}
		{#each row.get as line (line.player.host_id)}<LineRow {line} slot={LINES.get} />{/each}
		{#if row.drop}<LineRow line={row.drop} slot={LINES.drop} />{/if}
		<div class="gains">
			<p>{tradeGains(row)}</p>
			{#if row.close_for_them}<ToneChip tone="even">{CLOSE_FOR_THEM}</ToneChip>{/if}
			{#if filled}
				<Quiet size="sm" controls={BUILDER_ID} onclick={() => build(filled)}
					>{BUILDER_LINES.fromThis}</Quiet
				>
			{/if}
			<Quiet size="sm" onclick={() => (marked = on ? null : key)}
				>{on ? LINES.chosen : LINES.propose}</Quiet
			>
		</div>
	</div>
{/snippet}

<Screen
	decision={none
		? noTradeWith(pickedName)
		: tradeDecision(chosen ? { row: chosen.row, team: chosen.team.name } : null)}
	reason={chosen?.row.close_for_them ? `${CLOSE_FOR_THEM}.` : null}
	verb={verbWords('trades', host)}
	href={shown.host_trades_url}
	hostNote={shown.host_note}
	basis={shown.basis}
	basisNote={shown.basis_note}
	panelVerb={building !== null}
>
	{#snippet move()}
		{#if building}
			{#key building.opening}
				<TradeBuilder
					id={BUILDER_ID}
					teams={advice.teams}
					roster={advice.roster}
					{host}
					start={building.picks}
					basis={advice.basis}
					href={advice.host_trades_url}
					hostNote={advice.host_note}
					{check}
					onclose={() => (building = null)}
				/>
			{/key}
		{/if}
	{/snippet}
	<div class="tools">
		<div class="lead">
			<label class="pick">
				<span>{LINES.tradesHolding}</span>
				<select
					value={player ?? ''}
					onchange={(event) => void pick(event.currentTarget.value || null)}
				>
					<option value="">{EVERY_TRADE}</option>
					<optgroup label={LINES.yourPlayers}>
						{#each players.yours as line (line.player.host_id)}
							<option value={pickKey(line)}>{line.player.name}</option>
						{/each}
					</optgroup>
					<optgroup label={LINES.theirPlayers}>
						{#each players.theirs as line (line.player.host_id)}
							<option value={pickKey(line)}>{line.player.name}</option>
						{/each}
					</optgroup>
				</select>
			</label>
			<Quiet size="sm" controls={BUILDER_ID} expanded={building !== null} onclick={buildNew}
				>{BUILDER_LINES.open}</Quiet
			>
		</div>
		<Label>{LINES.perWeek}</Label>
	</div>
	{#if problem}<ProblemLine>{problem}</ProblemLine>{/if}
	<div class="teams" class:reading aria-busy={reading}>
		{#each teams as { team, trades } (team.roster_id)}
			{@const first = opened.has(team.roster_id) ? trades : trades.slice(0, FIRST_TRADES)}
			<Panel as="section" label={team.name} padding="none">
				<header class="head">
					<h2>{team.name}</h2>
					<p>{teamAside(team)}</p>
				</header>
				{#if team.note && trades.length > 0}<p class="none">{team.note}</p>{/if}
				{#each first as row (tradeKey(team.roster_id, row))}{@render trade(team, row)}{/each}
				{#if trades.length === 0}<p class="none">{NO_TRADES_WITH_TEAM}</p>{/if}
				{#if trades.length > first.length}
					<div class="more">
						<Quiet size="sm" onclick={() => open(team.roster_id)}
							>{showMore(trades.length - first.length)}</Quiet
						>
					</div>
				{/if}
			</Panel>
		{/each}
	</div>
</Screen>

<style>
	.tools {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--s-2) var(--s-4);
	}

	/* The picker and Build a trade share one line down to a phone's width: the picker gives way. */
	.lead {
		display: flex;
		align-items: center;
		gap: var(--s-3);
		min-width: 0;
		max-width: 100%;
	}

	.lead > :global(*:last-child) {
		flex: none;
	}

	.pick {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		min-width: 0;
		white-space: nowrap;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	select {
		height: 36px;
		max-width: 100%;
		min-width: 0;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--ink);
		padding: 0 var(--s-2);
		font: inherit;
	}

	/* While a player's trades are read, the last answer's stay, quieter. */
	.reading {
		opacity: 0.6;
	}

	/* One team a row, so every player row keeps its one line at a desk's width. */
	.teams {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
	}

	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--s-1) var(--s-3);
		padding: var(--s-3) var(--s-3) var(--s-2);
	}

	/* The team as the host names it, and its owner in the case the host gives, never upper-cased. */
	.head h2 {
		margin: 0;
		font-size: var(--t-md);
		font-weight: 700;
		overflow-wrap: anywhere;
	}

	.head p {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
		overflow-wrap: anywhere;
	}

	.trade {
		border-bottom: 2px solid var(--line-strong);
	}

	.trade.on {
		background: var(--accent-wash);
	}

	.gains {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--s-2) var(--s-3);
		padding: var(--s-2) var(--s-3) var(--s-3);
	}

	.gains p {
		margin: 0;
		flex: 1 1 16em;
		font-size: var(--t-sm);
		color: var(--ink);
	}

	.none {
		margin: 0;
		padding: 0 var(--s-3) var(--s-3);
		color: var(--ink-2);
		font-size: var(--t-sm);
	}

	.more {
		padding: var(--s-3);
	}
</style>
