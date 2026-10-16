<script lang="ts">
	import Label from '#lib/ui/Label.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import type { LeagueHost } from '../api.ts';
	import LineRow from './LineRow.svelte';
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
	import {
		LINES,
		carriesPerGame,
		figureHead,
		lineupDecision,
		lineupTitle,
		satIds,
		slotLabels,
		verbWords
	} from './words.ts';

	/** Start and sit (spec §4): this week's lineup slot by slot, ours, and where it differs from the
	 * lineup the host holds, the player it sits with the fact that tipped it; below it the bench, the
	 * players a change sits marked. One column at every width, as §4.1 lays it out. Where the API
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
	/** The head over the lineup and the bench names the number their rows end on. */
	const shown = $derived([
		...advice.slots.flatMap((s) => (s.host ? [s.ours, s.host] : [s.ours])),
		...advice.bench
	]);
	const head = $derived(figureHead(shown));
	/** Whether the rows end on points a game: a row without them then says so. */
	const perGameScreen = $derived(carriesPerGame(shown));

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

	const labels = $derived(slotLabels(advice.slots.map((s) => s.slot)));
	/** The host's starters our lineup sits, marked on the bench. */
	const sat = $derived(satIds(advice.slots));
</script>

<Screen
	decision={lineupDecision(advice)}
	verb={verbWords('start', host)}
	href={advice.host_lineup_url}
	hostNote={advice.host_note ?? advice.moves.note}
	basis={advice.basis}
	basisNote={advice.basis_note}
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
	<Panel as="section" label={lineupTitle(advice.week)} padding="none">
		<div class="head">
			<PanelHead title={lineupTitle(advice.week)} aside={head} level={2} />
		</div>
		{#each advice.slots as slot, i (`${slot.slot}-${String(i)}`)}
			{#if slot.changed}
				<div class="change">
					<LineRow line={slot.ours} slot={labels[i]} {perGameScreen} />
					{#if slot.host}<LineRow line={slot.host} slot={LINES.sit} {perGameScreen} />{/if}
					{#if slot.sentence}<p class="why">{slot.sentence}</p>{/if}
				</div>
			{:else}
				<LineRow line={slot.ours} slot={labels[i]} {perGameScreen} />
			{/if}
		{/each}
	</Panel>
	<Panel as="section" label={LINES.bench} padding="none">
		<div class="head">
			<PanelHead title={LINES.bench} aside={head} level={2} />
		</div>
		{#each advice.bench as line (line.player.host_id)}
			{@const sits = sat.has(line.player.host_id)}
			<!-- A starter a change sits is on the change's wash here too, so the two read as one move. -->
			<div class:change={sits}>
				<LineRow {line} slot={sits ? LINES.sit : LINES.bench} {perGameScreen} />
			</div>
		{:else}
			<p class="none"><Label>{LINES.noBench}</Label></p>
		{/each}
	</Panel>
</Screen>

<style>
	.head {
		padding: var(--s-3) var(--s-3) var(--s-2);
	}

	/* A change is ours over the host's, on our wash, with the fact that tipped it. */
	.change {
		background: var(--accent-wash);
		border-left: 4px solid var(--accent);
	}

	.why {
		margin: 0;
		padding: var(--s-2) var(--s-3) var(--s-3);
		font-size: var(--t-sm);
		color: var(--ink);
		border-bottom: 1px solid var(--line);
	}

	.none {
		margin: 0;
		padding: var(--s-3);
		color: var(--ink-3);
		font-size: var(--t-sm);
	}
</style>
