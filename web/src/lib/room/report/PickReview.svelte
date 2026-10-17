<script lang="ts">
	import { fixed } from '#lib/format/number.ts';
	import { pickLabel } from '#lib/format/draft.ts';
	import Face from '#lib/ui/Face.svelte';
	import PositionPill from '#lib/ui/PositionPill.svelte';
	import type { MockReport } from '../api.ts';
	import type { Board } from '../model.ts';
	import { slotLabel } from '../words.ts';
	import { adpLater, boardLater, byWords, pickFigure, stillThereCell } from './headline.ts';

	/** Pick by pick as a box score (Lane 66o): each pick's slot, his points over replacement (or his
	 * place in draft order), where drafters and our board place him with how many picks later than
	 * the pick, whether he was still there at the next turn, and who made it. The basis is the
	 * report's, said once above. */
	interface Props {
		picks: MockReport['picks'];
		starters: MockReport['starters'];
		board: Board;
		teams: number;
		/** Still there is tinted from here. */
		couldWaitFrom: number;
		/** Whose picks: your own, or a shared draft's drafter. */
		whose?: 'your' | 'their';
	}

	let { picks, starters, board, teams, couldWaitFrom, whose = 'your' }: Props = $props();

	const BENCH = 'Bench';

	const slotOf = $derived(
		new Map(
			starters.flatMap((s) =>
				s.player_id === null ? [] : [[s.player_id, slotLabel(s.slot)] as const]
			)
		)
	);
	const lastPick = $derived(picks.filter((p) => p.chip !== 'kept').at(-1)?.pick ?? null);
</script>

<table class="picks">
	<thead>
		<tr class="groups">
			<th colspan="4"></th>
			<th colspan="2" class="grp"><span>Drafters</span></th>
			<th colspan="2" class="grp"><span>Our board</span></th>
			<th colspan="2"></th>
		</tr>
		<tr>
			<th scope="col" class="l">Pick</th>
			<th scope="col" class="l">Player</th>
			<th scope="col" class="wide">Slot</th>
			<th scope="col">Over repl</th>
			<th scope="col" class="wide">ADP</th>
			<th scope="col"><span class="ph">ADP </span>Picks later</th>
			<th scope="col" class="wide">Rank</th>
			<th scope="col"><span class="ph">Ours </span>Picks later</th>
			<th scope="col">Still there</th>
			<th scope="col" class="wide">By</th>
		</tr>
	</thead>
	<tbody>
		{#each picks as pick (pick.pick)}
			{@const player = board.byId.get(pick.player_id)}
			{@const figure = pickFigure(pick.over_replacement, player)}
			{@const adp = adpLater(pick)}
			{@const ours = boardLater(pick)}
			{@const still = stillThereCell(pick, lastPick, couldWaitFrom)}
			{@const slot = slotOf.get(pick.player_id) ?? BENCH}
			<tr class:made={pick.made_by !== 'you'}>
				<td class="l n no">{pickLabel(pick.pick, teams)}</td>
				<td class="l">
					<span class="who">
						{#if player}<Face src={player.headshot} name={player.name} size={34} />{/if}
						<span class="nm">
							<b>{player?.name ?? pick.player_id}</b>
							{#if player}<small
									><PositionPill position={player.position} rank={player.positionRank} />
									{player.team}</small
								>{/if}
						</span>
					</span>
				</td>
				<td class="wide"><span class="slot" class:bench={slot === BENCH}>{slot}</span></td>
				<td class="n" class:muted={figure.muted}>{figure.text}</td>
				<td class="n wide"
					>{player?.adp === null || player === undefined ? '' : fixed(player.adp)}</td
				>
				<td class="n {adp?.tone ?? ''}">{adp?.text ?? ''}</td>
				<td class="n wide">{pick.board_rank ?? ''}</td>
				<td class="n {ours?.tone ?? ''}">{ours?.text ?? ''}</td>
				<td class="n" class:wait={still.wait} class:muted={still.muted}>{still.text}</td>
				<td class="by wide">{byWords(pick, whose)}</td>
			</tr>
		{/each}
	</tbody>
</table>

<style>
	.picks {
		width: 100%;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
	}

	th {
		font-size: var(--t-xs);
		font-weight: 500;
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--ink-3);
		text-align: right;
		padding: 0 var(--s-3) var(--s-2);
		white-space: nowrap;
		border-bottom: 1px solid var(--line-strong);
	}

	.groups th {
		border-bottom: 0;
		padding-bottom: 0;
	}

	th.grp {
		text-align: center;
		color: var(--ink-2);
	}

	th.grp span {
		display: block;
		padding-bottom: 4px;
		border-bottom: 1px solid var(--line-strong);
	}

	.l {
		text-align: left;
	}

	td {
		padding: 0 var(--s-3);
		height: var(--row-h);
		border-bottom: 1px solid var(--line);
		text-align: right;
		white-space: nowrap;
	}

	td.n {
		font-family: var(--font-num);
		font-weight: 700;
		font-size: var(--t-lg);
	}

	td.no {
		color: var(--ink-2);
	}

	td.muted {
		font-family: var(--font-ui);
		font-weight: 500;
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	td.loss,
	td.wait {
		color: var(--loss-ink);
	}

	td.gain {
		color: var(--gain-ink);
	}

	.who {
		display: flex;
		align-items: center;
		gap: var(--s-3);
		min-width: 0;
	}

	.nm {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.nm b {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.nm small {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--t-sm);
		color: var(--ink-3);
	}

	.slot {
		display: inline-flex;
		align-items: center;
		height: 20px;
		padding: 0 6px;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-sm);
		font-size: var(--t-xs);
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--ink-2);
	}

	.slot.bench {
		border-color: transparent;
		font-weight: 500;
		color: var(--ink-3);
	}

	td.by {
		font-size: var(--t-sm);
		color: var(--ink-3);
	}

	/* A pick nobody chose reads quieter than the ones you made. */
	.made .no,
	.made .nm b {
		color: var(--ink-3);
	}

	.ph {
		display: none;
	}

	/* In a hand: the signed figures stay, the slot, the raw ADP and rank and who made it go. */
	@media (max-width: 760px) {
		.picks {
			table-layout: fixed;
		}

		.wide,
		.groups {
			display: none;
		}

		.ph {
			display: inline;
		}

		th,
		td {
			padding-inline: 4px;
		}

		th {
			font-size: 10px;
			letter-spacing: 0.02em;
			white-space: normal;
			vertical-align: bottom;
		}

		th:nth-child(1) {
			width: 40px;
		}

		th:nth-child(4) {
			width: 60px;
		}

		th:nth-child(6),
		th:nth-child(8) {
			width: 50px;
		}

		th:nth-child(9) {
			width: 50px;
		}

		td.n {
			font-size: var(--t-md);
		}

		td.muted {
			white-space: normal;
			line-height: 1.2;
		}

		.who :global(.face) {
			display: none;
		}

		.nm b {
			font-size: var(--t-sm);
			white-space: normal;
			line-height: 1.15;
		}

		.nm small {
			font-size: var(--t-xs);
		}
	}
</style>
