<script lang="ts">
	import type { LeagueHost } from '../api.ts';
	import BoxTable from '../box/BoxTable.svelte';
	import { PTS_BASIS, factsReadLine, projBasis } from '../box/box.ts';
	import { lineupBox } from '../box/lineup.ts';
	import MovePanel from './MovePanel.svelte';
	import Screen from './Screen.svelte';
	import type { HostMoveInput, HostMovePlan, HostMoveResult, LineupAdvice } from './api.ts';
	import {
		failedStep,
		lineupMove,
		planStep,
		resultStep,
		setsOnHost,
		type MoveStep
	} from './move.ts';
	import { LINES, lineupDecision, lineupTitle, verbWords } from './words.ts';

	/** Start and sit (spec §4) as a box score (Lane 66d): this week's lineup slot by slot, ours, and
	 * where it differs from the lineup the host holds, the player it sits with the fact that tipped it;
	 * the totals; below it the bench, the players a change sits marked. Each row is columns: the slot,
	 * the player, his game with its facts, this week's projection and his points so far. Where the API
	 * opens the move (spec §10.2), the verb opens a confirmation on this screen naming the exact
	 * changes, and its one verb sets them on the host; otherwise the verb is the host's page. */
	interface Props {
		advice: LineupAdvice;
		host: LeagueHost;
		/** Plans the move in words with its confirm token; nothing is sent. */
		plan: (move: HostMoveInput) => Promise<HostMovePlan>;
		/** Makes the planned move once with its token. */
		make: (move: HostMoveInput, confirm: string) => Promise<HostMoveResult>;
		/** Reads the lineup again, once a move has been made. */
		reread: () => void;
	}

	let { advice, host, plan, make, reread }: Props = $props();
	const box = $derived(lineupBox(advice));
	/** Every line on the screen, for the game facts' read said once under the rows. */
	const shown = $derived([
		...advice.slots.flatMap((s) => (s.host ? [s.ours, s.host] : [s.ours])),
		...advice.bench
	]);
	/** Under the rows, once: the league the figures are for, what Proj and Pts are, the facts' read. */
	const note = $derived(
		[advice.basis_note, projBasis(advice.projection_read_at), PTS_BASIS, factsReadLine(shown)]
			.filter((s): s is string => s !== null && s !== '')
			.join(' ')
	);

	const MOVE_ID = 'lineup-move';
	let step = $state<MoveStep>({ kind: 'closed' });
	/** The move as it was planned: the one the token makes, whatever the page reads meanwhile. */
	let planned: HostMoveInput | null = null;

	const onHost = $derived(setsOnHost(advice));

	async function open(): Promise<void> {
		const move = lineupMove(advice);
		planned = move;
		step = { kind: 'planning' };
		try {
			step = planStep(await plan(move));
		} catch (error) {
			step = failedStep(error, host, 'plan', advice.host_lineup_url);
		}
	}

	async function confirm(): Promise<void> {
		if (step.kind !== 'confirm' || planned === null) return;
		const { plan: ready } = step;
		step = { kind: 'sending', plan: ready };
		try {
			step = resultStep(await make(planned, ready.confirm));
			reread();
		} catch (error) {
			step = failedStep(error, host, 'make', advice.host_lineup_url);
		}
	}

	function close(): void {
		step = { kind: 'closed' };
		planned = null;
	}
</script>

<Screen
	decision={lineupDecision(advice)}
	verb={verbWords('start', host)}
	href={advice.host_lineup_url}
	hostNote={advice.host_note ?? advice.moves.note}
	basis={advice.basis}
	basisNote={note}
	onverb={onHost ? () => void open() : null}
	controls={onHost ? MOVE_ID : undefined}
	expanded={onHost ? step.kind !== 'closed' : undefined}
>
	{#snippet move()}
		{#if step.kind !== 'closed'}
			<MovePanel
				id={MOVE_ID}
				kind="lineup"
				{step}
				{host}
				onconfirm={() => void confirm()}
				onclose={close}
			/>
		{/if}
	{/snippet}
	<div class="box">
		<BoxTable
			team={lineupTitle(advice.week)}
			mine
			avatar={false}
			starters={box.starters}
			bench={box.bench}
			benchSat={box.benchSat}
			totals={box.totals}
			noBench={LINES.noBench}
		/>
	</div>
</Screen>

<style>
	/* One team's box reads best at a box's width: past it the game sits far from the name. */
	.box {
		max-width: 920px;
	}
</style>
