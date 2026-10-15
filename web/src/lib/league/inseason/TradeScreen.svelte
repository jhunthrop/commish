<script lang="ts">
	import Label from '#lib/ui/Label.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import ToneChip from '#lib/ui/ToneChip.svelte';
	import type { LeagueHost } from '../api.ts';
	import type { LeagueBoard } from '../board.ts';
	import LineRow from './LineRow.svelte';
	import Screen from './Screen.svelte';
	import type { PlayerLine, TradeAdvice, TradeRow, TradeTeam } from './api.ts';
	import { Narrowing, markedTrade, tradeKey } from './state.ts';
	import {
		CLOSE_FOR_THEM,
		EVERY_TRADE,
		LINES,
		NO_TRADES_WITH_TEAM,
		showMore,
		teamAside,
		tradeDecision,
		tradeGains,
		verbWords
	} from './words.ts';

	/** The trade finder (spec §6): for each other team, its name, owner and record and the trades
	 * that help both lineups, each a give and a get with both gains, best for you first. A player
	 * picked reads the trades holding him again, so no team's list is cut to its first trades.
	 * Propose marks a trade as the decision, by who is in it, so the minute's re-read never moves the
	 * mark to another trade; the one verb opens the host's trade page. We never send an offer. */
	interface Props {
		advice: TradeAdvice;
		board: LeagueBoard;
		host: LeagueHost;
		/** Reads the trades holding one player, by his board id. */
		narrow: (player: string) => Promise<TradeAdvice>;
	}

	let { advice, board, host, narrow }: Props = $props();

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

	/** Every player on our board the trades hold, yours first, each once. */
	const players = $derived.by(() => {
		const all = advice.teams.flatMap((t) => t.trades);
		const once = (lines: PlayerLine[]): PlayerLine[] => [
			...new Map(
				lines.flatMap((l) => (l.player.board_id === null ? [] : [[l.player.board_id, l] as const]))
			).values()
		];
		return {
			yours: once(all.flatMap((r) => r.give)),
			theirs: once(all.flatMap((r) => r.get))
		};
	});

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

	/** The marked trade while the answer still holds it, else the best trade shown. */
	const chosen = $derived.by((): { row: TradeRow; team: TradeTeam } | null => {
		const kept = markedTrade(shown.teams, marked);
		if (kept) return kept;
		const best = teams
			.flatMap(({ team, trades }) => trades.map((row) => ({ row, team })))
			.sort((a, b) => b.row.my_gain - a.row.my_gain)[0];
		return best ?? null;
	});

	async function pick(next: string | null): Promise<void> {
		player = next;
		narrowed = null;
		marked = null;
		problem = null;
		reading = next !== null;
		const outcome = await narrowing.choose(next);
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
	<div class="trade" class:on>
		{#each row.give as line (line.player.host_id)}<LineRow
				{line}
				{board}
				slot={LINES.give}
			/>{/each}
		{#each row.get as line (line.player.host_id)}<LineRow {line} {board} slot={LINES.get} />{/each}
		<div class="gains">
			<p>{tradeGains(row)}</p>
			{#if row.close_for_them}<ToneChip tone="even">{CLOSE_FOR_THEM}</ToneChip>{/if}
			<Quiet size="sm" onclick={() => (marked = on ? null : key)}
				>{on ? LINES.chosen : LINES.propose}</Quiet
			>
		</div>
	</div>
{/snippet}

<Screen
	decision={tradeDecision(chosen ? { row: chosen.row, team: chosen.team.name } : null)}
	reason={chosen?.row.close_for_them ? `${CLOSE_FOR_THEM}.` : null}
	verb={verbWords('trades', host)}
	href={shown.host_trades_url}
	basis={shown.basis}
>
	<div class="tools">
		<label class="pick">
			<span>{LINES.tradesHolding}</span>
			<select
				value={player ?? ''}
				onchange={(event) => void pick(event.currentTarget.value || null)}
			>
				<option value="">{EVERY_TRADE}</option>
				<optgroup label={LINES.yourPlayers}>
					{#each players.yours as line (line.player.host_id)}
						<option value={line.player.board_id}>{line.player.name}</option>
					{/each}
				</optgroup>
				<optgroup label={LINES.theirPlayers}>
					{#each players.theirs as line (line.player.host_id)}
						<option value={line.player.board_id}>{line.player.name}</option>
					{/each}
				</optgroup>
			</select>
		</label>
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

	.pick {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		min-width: 0;
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
