<script lang="ts">
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import ToneChip from '#lib/ui/ToneChip.svelte';
	import type { LeagueHost } from '../api.ts';
	import type { LeagueBoard } from '../board.ts';
	import LineRow from './LineRow.svelte';
	import Screen from './Screen.svelte';
	import type { PlayerLine, TradeAdvice, TradeRow, TradeTeam } from './types.ts';
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
	 * give and a get with both gains, best for you first. A player picked narrows every team to the
	 * trades holding him. Propose marks a trade as the decision, and the one verb opens the host's
	 * trade page. We never send an offer. */
	interface Props {
		advice: TradeAdvice;
		board: LeagueBoard;
		host: LeagueHost;
	}

	let { advice, board, host }: Props = $props();

	/** Trades a team shows before its Show more. */
	const FIRST_TRADES = 2;

	/** The player the trades are narrowed to, by host id; null for every trade. */
	let player = $state<string | null>(null);
	/** The trade the member marked; null keeps the best one as the decision. */
	let marked = $state<{ team: number; index: number } | null>(null);
	/** The teams opened past their first trades. */
	let opened = $state<ReadonlySet<number>>(new Set());

	const holds = (row: TradeRow, id: string): boolean =>
		[...row.give, ...row.get].some((line) => line.player.host_id === id);

	/** Every player the trades hold, yours first, each once. */
	const players = $derived.by(() => {
		const all = advice.teams.flatMap((t) => t.trades);
		const once = (lines: PlayerLine[]): PlayerLine[] => [
			...new Map(lines.map((l) => [l.player.host_id, l] as const)).values()
		];
		return {
			yours: once(all.flatMap((r) => r.give)),
			theirs: once(all.flatMap((r) => r.get))
		};
	});

	/** Every team, or narrowed to a player, only the teams with a trade holding him. */
	const teams = $derived(
		advice.teams
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
			const team = advice.teams.find((t) => t.roster_id === marked?.team);
			const row = team?.trades[marked.index];
			if (team && row) return { row, team };
		}
		// The best of the trades shown: narrowed to a player, the decision holds him too.
		const best = teams
			.flatMap(({ team, trades }) => trades.map(({ row }) => ({ row, team })))
			.sort((a, b) => b.row.my_gain - a.row.my_gain)[0];
		return best ?? null;
	});

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
	href={advice.host_trades_url}
	basis={advice.basis}
>
	<label class="pick">
		<span>Trades holding</span>
		<select bind:value={player}>
			<option value={null}>{EVERY_TRADE}</option>
			<optgroup label="Your players">
				{#each players.yours as line (line.player.host_id)}
					<option value={line.player.host_id}>{line.player.name}</option>
				{/each}
			</optgroup>
			<optgroup label="Their players">
				{#each players.theirs as line (line.player.host_id)}
					<option value={line.player.host_id}>{line.player.name}</option>
				{/each}
			</optgroup>
		</select>
	</label>
	<div class="teams">
		{#each teams as { team, trades } (team.roster_id)}
			{@const shown = opened.has(team.roster_id) ? trades : trades.slice(0, FIRST_TRADES)}
			<Panel as="section" label={team.name} padding="none">
				<div class="head"><PanelHead title={team.name} aside={teamAside(team)} level={2} /></div>
				{#each shown as { row, index } (index)}{@render trade(team, row, index)}{/each}
				{#if trades.length === 0}<p class="none">{NO_TRADES_WITH_TEAM}</p>{/if}
				{#if trades.length > shown.length}
					<div class="more">
						<Quiet size="sm" onclick={() => open(team.roster_id)}
							>Show {trades.length - shown.length} more</Quiet
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
		.teams {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
