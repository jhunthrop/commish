<script lang="ts">
	import type { LeagueHost } from '../api.ts';
	import { onMount } from 'svelte';
	import { lazySheet } from '#lib/site/lazy-sheet.svelte.ts';
	import BoxBasis from '../box/BoxBasis.svelte';
	import LineupStrip from '../box/LineupStrip.svelte';
	import LineupTable from '../box/LineupTable.svelte';
	import { sheetTags } from '../sheet-tags.ts';
	import {
		copiedLine,
		LINEUP,
		lineupBox,
		lineupPageWords,
		lineupText,
		setOnWords,
		type CopyLine
	} from '../box/lineup.ts';
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
	import { LINES, lineupDecision, lineupTitle } from './words.ts';

	/** Start and sit (spec §4) as one lineup table (Lane 66e): a strip with the week, the count of
	 * changes, each swap as a chip and what they add to the lineup as the platform has it set now,
	 * with one verb; then the lineup the advice sets, Totals, the bench and the injured reserve, each
	 * row in the same columns with the season's evidence beside this week's projection. The verb
	 * makes the changes on the platform where the API opens the move (spec §10.2), through the
	 * confirmation on this screen; elsewhere it copies the lineup with the platform's lineup page as
	 * its second half, the API's one line (moves.reason) under it saying why. A lineup already set has
	 * no verb. A platform that gains writes changes the API's answer, never this screen. */
	interface Props {
		advice: LineupAdvice;
		host: LeagueHost;
		/** Plans the move in words with its confirm token; nothing is sent. */
		plan: (move: HostMoveInput) => Promise<HostMovePlan>;
		/** Makes the planned move once with its token. */
		make: (move: HostMoveInput, confirm: string) => Promise<HostMoveResult>;
		/** Reads the lineup again, once a move has been made. */
		reread: () => void;
		/** Puts the lineup on the clipboard. */
		copy?: (text: string) => Promise<void>;
		/** The league's Settings at the scoring rules our stats lack. */
		rulesHref: string;
	}

	let {
		advice,
		host,
		plan,
		make,
		reread,
		copy = (text) => navigator.clipboard.writeText(text),
		rulesHref
	}: Props = $props();
	const box = $derived(lineupBox(advice));
	// Your sheet's tags mark your rows once the sheet is in (review L7).
	onMount(() => void lazySheet.load());
	/** Every line on the screen, for the game facts' read said once under the rows. */
	const shown = $derived([
		...advice.slots.flatMap((s) => (s.host ? [s.ours, s.host] : [s.ours])),
		...advice.bench,
		...advice.reserve
	]);

	const MOVE_ID = 'lineup-move';
	let step = $state<MoveStep>({ kind: 'closed' });
	/** The move as it was planned: the one the token makes, whatever the page reads meanwhile. */
	let planned: HostMoveInput | null = null;
	/** What the copy verb said, once pressed. */
	let copied = $state<CopyLine | null>(null);

	const onHost = $derived(setsOnHost(advice));
	/** Nothing to change: the strip says so and no verb shows (review M4). */
	const isSet = $derived(box.swaps.length === 0);
	const verb = $derived(isSet ? null : onHost ? LINEUP.make : LINEUP.copy);
	/** Whether the line under the verb says anything: a set lineup on a platform without our writes
	 * says nothing, and a phone shows no empty bar for it (review N3). */
	const footSays = $derived(isSet ? advice.moves.lineup === 'available' : !onHost);

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

	async function copyLineup(): Promise<void> {
		try {
			await copy(lineupText(box, advice.week));
			copied = copiedLine(host, true);
		} catch {
			copied = copiedLine(host, false);
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
	{verb}
	{footSays}
	href={advice.host_lineup_url}
	basis={advice.basis}
	onverb={onHost ? () => void open() : () => void copyLineup()}
	controls={onHost ? MOVE_ID : undefined}
	expanded={onHost ? step.kind !== 'closed' : undefined}
>
	{#snippet summary()}
		<LineupStrip week={advice.week} {box} />
	{/snippet}
	{#snippet verbFoot()}
		{#if isSet}
			{#if advice.moves.lineup === 'available'}<span class="verb-line">{setOnWords(host)}</span
				>{/if}
		{:else if !onHost}
			{#if copied === null && advice.host_lineup_url !== ''}<a
					class="second"
					href={advice.host_lineup_url}
					target="_blank"
					rel="noopener">{lineupPageWords(host)}</a
				>{/if}
			<span class="verb-line" role="status"
				>{#if copied}{copied.said}
					{LINEUP.setItOn}
					{#if advice.host_lineup_url !== ''}<a
							href={advice.host_lineup_url}
							target="_blank"
							rel="noopener">{copied.page}</a
						>{:else}{copied.page}{/if}.{:else}{advice.moves.reason ??
						advice.host_note ??
						''}{/if}</span
			>
		{/if}
	{/snippet}
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
	<LineupTable label={lineupTitle(advice.week)} {box} tagsOf={sheetTags} noBench={LINES.noBench} />
	<BoxBasis
		byPlayer={advice.player_points}
		teamTotal={false}
		{host}
		projection={{ readAt: advice.projection_read_at, scoring: advice.projection_scoring }}
		lineup={{ previousReadAt: advice.projection_previous_read_at, note: advice, rulesHref }}
		lines={shown}
	/>
</Screen>

<style>
	.verb-line {
		color: var(--ink-2);
		font-size: var(--t-sm);
		text-align: right;
	}

	.second {
		font-size: var(--t-sm);
		font-weight: 600;
		color: var(--ink);
	}

	@media (max-width: 760px) {
		/* The pin stays short so the first row clears it: the page link and the line share one small
		   block under the verb. */
		.verb-line,
		.second {
			display: block;
			margin-top: 2px;
			font-size: var(--t-xs);
			line-height: 1.35;
			text-align: center;
		}
	}
</style>
