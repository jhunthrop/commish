<script lang="ts">
	import type { LeagueHost } from '../api.ts';
	import { onMount } from 'svelte';
	import { memberZone } from '#lib/format/clock.ts';
	import { lazySheet } from '#lib/site/lazy-sheet.svelte.ts';
	import BoxBasis from '../box/BoxBasis.svelte';
	import LineupStrip from '../box/LineupStrip.svelte';
	import LineupTable from '../box/LineupTable.svelte';
	import { sheetTags } from '../sheet-tags.ts';
	import {
		copiedLine,
		heldLineup,
		LINEUP,
		lineupBox,
		lineupPageWords,
		lineupText,
		setOnWords,
		swapOf,
		swapWords,
		type CopyLine
	} from '../box/lineup.ts';
	import MovePanel from './MovePanel.svelte';
	import Screen from './Screen.svelte';
	import type { HostMoveInput, HostMovePlan, HostMoveResult, LineupAdvice } from './api.ts';
	import { lineupMove, setsOnHost } from './move.ts';
	import { LineupMover } from './lineup-mover.svelte.ts';
	import { LINES, lineupDecision, lineupTitle } from './words.ts';
	import { page } from '$app/state';
	import { markAsked } from '../box/asked.ts';
	import { backToLineupOffer, rowBySlug } from '#lib/player/shelf-state.ts';
	import { providePlayerShelf } from '#lib/player/shelf-host.ts';
	import PlayerShelfLayer from '#lib/player/PlayerShelfLayer.svelte';

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
		/** Plans the move in words with its confirm token; nothing is sent. Left out where a mover is
		 * given, which carries its own. */
		plan?: (move: HostMoveInput) => Promise<HostMovePlan>;
		/** Makes the planned move once with its token. */
		make?: (move: HostMoveInput, confirm: string) => Promise<HostMoveResult>;
		/** Reads the lineup again, once a move has been made. */
		reread?: () => void;
		/** Puts the lineup on the clipboard. */
		copy?: (text: string) => Promise<void>;
		/** The instant the answer was read, in ms: the page's clock the rows and the basis draw at. */
		now: number;
		/** The league, where the page names none (the every-league page, Lane 257); else the page's. */
		league?: string;
		/** The block this lineup is on a page of many (the every-league page): its ids and its player
		 * shelf are its own. Left out on the league's own Lineup. */
		scope?: string;
		/** The move, where the page drives it too (the every-league page's one verb). */
		mover?: LineupMover;
		/** The page's verb confirms the move: the panel shows the move with no verb of its own. */
		held?: boolean;
		/** Whether the verb pins above the tab bar on a phone (Screen's pin). */
		pin?: boolean;
	}

	let {
		advice: answer,
		host,
		plan,
		make,
		reread,
		copy = (text) => navigator.clipboard.writeText(text),
		now,
		league,
		scope,
		mover: given,
		held = false,
		pin = true
	}: Props = $props();
	/** The answer with no change on a row whose game has kicked off or is final (Lane 85): every word,
	 * the verb and the move read it. */
	const advice = $derived(heldLineup(answer, now));
	/** The API's sentence once every starter of the member's has played: no change and no verb is
	 * left. Its state says Locked while the matchup still plays, Final once it is (Lane 91). */
	const done = $derived(advice.week_done ?? null);
	const doneState = $derived(advice.week_done_state ?? null);
	const box = $derived(lineupBox(advice, memberZone(), now));
	/** A row's name opens his card over the lineup (Lane 113); its verb closes it onto his row, with his
	 * swap under it when the advice makes one. */
	// The block a page of many keys by its league, so its scope is fixed for the screen's life.
	// svelte-ignore state_referenced_locally
	const shelf = providePlayerShelf({
		screen: 'lineup',
		scope,
		now: () => now,
		league: () => ({ id: league ?? page.params.id ?? '', host }),
		offer: (row) => {
			const { boardId } = row;
			if (boardId === null) return null;
			const swap = swapOf(box.swaps, row);
			return backToLineupOffer(
				() => void markAsked(rows ?? document, boardId),
				swap === null ? null : swapWords(swap)
			);
		},
		rowOf: (slug) =>
			rowBySlug(
				[...box.starters.map((e) => e.row), ...box.bench.map((e) => e.row), ...box.reserve],
				slug
			)
	});
	// Your sheet's tags mark your rows once the sheet is in (review L7).
	onMount(() => void lazySheet.load());
	/** Every line on the screen, for the game facts' read said once under the rows. */
	const shown = $derived([
		...advice.slots.flatMap((s) => (s.host ? [s.ours, s.host] : [s.ours])),
		...advice.bench,
		...advice.reserve
	]);

	/** This lineup's rows: a back-to-his-row from his card marks his row here, not another block's. */
	let rows = $state<HTMLElement | null>(null);
	// The page's own mover when it gives one, fixed for the screen's life.
	// svelte-ignore state_referenced_locally
	const mover = given ?? ownMover();

	/** The screen's own mover, from its calls. */
	function ownMover(): LineupMover {
		if (plan === undefined || make === undefined || reread === undefined) {
			throw new Error('StartScreen needs plan, make and reread, or a mover.');
		}
		return new LineupMover({ plan, make, reread });
	}
	const step = $derived(mover.step);
	const MOVE_ID = $derived(scope === undefined ? 'lineup-move' : `lineup-move-${scope}`);
	const at = $derived({ host, href: advice.host_lineup_url });
	/** What the copy verb said, once pressed. */
	let copied = $state<CopyLine | null>(null);

	const onHost = $derived(setsOnHost(advice));
	/** Nothing to change: the strip says so and no verb shows (review M4). */
	const isSet = $derived(box.swaps.length === 0);
	const verb = $derived(isSet ? null : onHost ? LINEUP.make : LINEUP.copy);
	/** Whether the line under the verb says anything: a set lineup on a platform without our writes
	 * says nothing, and a phone shows no empty bar for it (review N3). */
	const footSays = $derived(
		done !== null ? false : isSet ? advice.moves.lineup === 'available' : !onHost
	);

	function open(): void {
		void mover.open(lineupMove(advice), at);
	}

	async function copyLineup(): Promise<void> {
		try {
			await copy(lineupText(box, advice.week));
			copied = copiedLine(host, true);
		} catch {
			copied = copiedLine(host, false);
		}
	}
</script>

<Screen
	decision={lineupDecision(advice)}
	{verb}
	{footSays}
	href={advice.host_lineup_url}
	basis={null}
	onverb={onHost ? open : () => void copyLineup()}
	{pin}
	controls={onHost ? MOVE_ID : undefined}
	expanded={onHost ? step.kind !== 'closed' : undefined}
>
	{#snippet summary()}
		<LineupStrip
			week={advice.week}
			{box}
			{host}
			missed={advice.missed ?? null}
			{done}
			{doneState}
		/>
	{/snippet}
	{#snippet verbFoot()}
		{#if done !== null}{:else if isSet}
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
				{held}
				onconfirm={() => void mover.confirm(at)}
				onclose={() => mover.close()}
			/>
		{/if}
	{/snippet}
	<div class="rows" bind:this={rows}>
		<LineupTable
			label={lineupTitle(advice.week)}
			{box}
			tagsOf={sheetTags}
			noBench={LINES.noBench}
			{scope}
		/>
	</div>
	<PlayerShelfLayer host={shelf} />
	<BoxBasis
		byPlayer={advice.player_points}
		teamTotal={false}
		{host}
		projection={{ readAt: advice.projection_read_at, scoring: advice.projection_scoring }}
		lineup={{
			previousReadAt: advice.projection_previous_read_at,
			note: advice
		}}
		lines={shown}
		noFinal={box.totals.live && box.totals.final === null}
		allFinal={box.totals.allFinal}
		{now}
	/>
</Screen>

<style>
	/* The rows' own box for the marking only: the table lays out as it would without it. */
	.rows {
		display: contents;
	}

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
