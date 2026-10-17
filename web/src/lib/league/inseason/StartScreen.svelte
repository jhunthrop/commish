<script lang="ts">
	import type { LeagueHost } from '../api.ts';
	import { onMount } from 'svelte';
	import { lazySheet } from '#lib/site/lazy-sheet.svelte.ts';
	import BoxBasis from '../box/BoxBasis.svelte';
	import LineupStrip from '../box/LineupStrip.svelte';
	import LineupTable from '../box/LineupTable.svelte';
	import { sheetTags } from '../sheet-tags.ts';
	import { copiedWords, copyFailedWords, LINEUP, lineupBox, lineupText } from '../box/lineup.ts';
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
	 * confirmation on this screen; elsewhere it copies the lineup, the API's one line under it saying
	 * why. A platform that gains writes changes the API's answer, never this screen. */
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
	}

	let {
		advice,
		host,
		plan,
		make,
		reread,
		copy = (text) => navigator.clipboard.writeText(text)
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
	let copied = $state<string | null>(null);

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

	async function copyLineup(): Promise<void> {
		try {
			await copy(lineupText(box, advice.week));
			copied = copiedWords(host);
		} catch {
			copied = copyFailedWords(host);
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
	verb={onHost ? LINEUP.make : LINEUP.copy}
	href={advice.host_lineup_url}
	hostNote={onHost ? null : (copied ?? advice.moves.reason ?? advice.host_note)}
	basis={advice.basis}
	basisNote={advice.basis_note}
	onverb={onHost ? () => void open() : () => void copyLineup()}
	controls={onHost ? MOVE_ID : undefined}
	expanded={onHost ? step.kind !== 'closed' : undefined}
>
	{#snippet summary()}
		<LineupStrip week={advice.week} {box} />
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
		{host}
		projection={{ readAt: advice.projection_read_at, scoring: advice.projection_scoring }}
		evidence={{ previousReadAt: advice.projection_previous_read_at }}
		lines={shown}
	/>
</Screen>
