<script lang="ts">
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import ToneChip from '#lib/ui/ToneChip.svelte';
	import type { LeagueHost } from '../api.ts';
	import type { LeagueBoard } from '../board.ts';
	import LineRow from './LineRow.svelte';
	import Screen from './Screen.svelte';
	import type { PlayerLine, TradeAdvice, TradeRow, TradeTeam } from './api.ts';
	import {
		CLOSE_FOR_THEM,
		EVERY_TRADE,
		NO_TRADES_WITH_TEAM,
		teamAside,
		tradeDecision,
		tradeGains,
		verbWords
	} from './words.ts';

	/** The trade finder (spec §6): for each other team, the trades that help both lineups, each a
	 * give and a get with both gains, best for you first. A player picked reads the trades holding
	 * him again, so no team's list is cut to its first trades. Propose marks a trade as the decision, and the one verb opens the host's
	 * trade page. We never send an offer. */
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

	/** The player the trades are narrowed to, by board id; null for every trade. */
	let player = $state<string | null>(null);
	/** The answer for the chosen player, null for every trade or until it is read. */
	let narrowed = $state<TradeAdvice | null>(null);
	let reading = $state(false);
	let problem = $state<string | null>(null);
	/** The trade the member marked; null keeps the best one as the decision. */
	let marked = $state<{ team: number; index: number } | null>(null);
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
				trades: team.trades
					.map((row, index) => ({ row, index }))
					.filter(({ row }) => player === null || holds(row, player))
			}))
			.filter(({ trades }) => player === null || trades.length > 0)
	);

	/** The best trade for you across the league, or the one marked. */
	const chosen = $derived.by((): { row: TradeRow; team: TradeTeam } | null => {
		if (marked !== null) {
			const team = shown.teams.find((t) => t.roster_id === marked?.team);
			const row = team?.trades[marked.index];
			if (team && row) return { row, team };
		}
		// The best of the trades shown: narrowed to a player, the decision holds him too.
		const best = teams
			.flatMap(({ team, trades }) => trades.map(({ row }) => ({ row, team })))
			.sort((a, b) => b.row.my_gain - a.row.my_gain)[0];
		return best ?? null;
	});

	async function pick(next: string | null): Promise<void> {
		player = next;
		narrowed = null;
		marked = null;
		problem = null;
		if (next === null) return;
		reading = true;
		try {
			const answer = await narrow(next);
			if (player === next) narrowed = answer;
		} catch {
			if (player === next)
				problem = 'These trades could not be read just now. They show from the last read.';
		} finally {
			if (player === next) reading = false;
		}
	}

	function open(team: number): void {
		opened = new Set([...opened, team]);
	}
</script>

{#snippet trade(team: TradeTeam, row: TradeRow, index: number)}
	{@const on = marked?.team === team.roster_id && marked.index === index}
	<div class="trade" class:on>
		<div class="sides">
			<div class="side">
				{#each row.give as line (line.player.host_id)}<LineRow {line} {board} slot="Give" />{/each}
			</div>
			<div class="side">
				{#each row.get as line (line.player.host_id)}<LineRow {line} {board} slot="Get" />{/each}
			</div>
		</div>
		<div class="gains">
			<p>{tradeGains(row)}</p>
			{#if row.close_for_them}<ToneChip tone="even">{CLOSE_FOR_THEM}</ToneChip>{/if}
			<Quiet size="sm" onclick={() => (marked = on ? null : { team: team.roster_id, index })}
				>{on ? 'Chosen' : 'Propose'}</Quiet
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
	<label class="pick">
		<span>Trades holding</span>
		<select value={player ?? ''} onchange={(event) => void pick(event.currentTarget.value || null)}>
			<option value="">{EVERY_TRADE}</option>
			<optgroup label="Your players">
				{#each players.yours as line (line.player.host_id)}
					<option value={line.player.board_id}>{line.player.name}</option>
				{/each}
			</optgroup>
			<optgroup label="Their players">
				{#each players.theirs as line (line.player.host_id)}
					<option value={line.player.board_id}>{line.player.name}</option>
				{/each}
			</optgroup>
		</select>
	</label>
	{#if problem}<ProblemLine>{problem}</ProblemLine>{/if}
	<div class="teams" class:reading aria-busy={reading}>
		{#each teams as { team, trades } (team.roster_id)}
			{@const first = opened.has(team.roster_id) ? trades : trades.slice(0, FIRST_TRADES)}
			<Panel as="section" label={team.name} padding="none">
				<div class="head"><PanelHead title={team.name} aside={teamAside(team)} level={2} /></div>
				{#each first as { row, index } (index)}{@render trade(team, row, index)}{/each}
				{#if trades.length === 0}<p class="none">{NO_TRADES_WITH_TEAM}</p>{/if}
				{#if trades.length > first.length}
					<div class="more">
						<Quiet size="sm" onclick={() => open(team.roster_id)}
							>Show {trades.length - first.length} more</Quiet
						>
					</div>
				{/if}
			</Panel>
		{/each}
	</div>
</Screen>

<style>
	.pick {
		display: flex;
		align-items: center;
		gap: var(--s-2);
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

	.teams {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--s-4);
		align-items: start;
	}

	.head {
		padding: var(--s-3) var(--s-3) var(--s-2);
	}

	.trade {
		border-bottom: 2px solid var(--line-strong);
	}

	.trade.on {
		background: var(--accent-wash);
	}

	.sides {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
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

	@media (max-width: 1100px) {
		/* While a player's trades are read, the last answer's stay, quieter. */
		.reading {
			opacity: 0.6;
		}

		.teams {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
