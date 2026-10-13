<script lang="ts">
	import { lastName, pickLabel, snakeSlot } from '#lib/format/draft.ts';
	import Keys from '#lib/ui/Keys.svelte';
	import LiveRegion from '#lib/ui/LiveRegion.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import SinceStrip from '#lib/ui/SinceStrip.svelte';
	import TeamPanel from '#lib/ui/TeamPanel.svelte';
	import type { MockRoom, RoomCard } from './api.ts';
	import { type CallView, callView, frameView, poolBasis } from './call.ts';
	import { roomKeys, soloKeys } from './keys.ts';
	import {
		type Board,
		type PoolFilter,
		draftedSet,
		poolRows,
		teamSlots,
		turnAfter,
		turnBefore,
		wallRows,
		wentSince
	} from './model.ts';
	import Pool from './Pool.svelte';
	import RoomCall from './RoomCall.svelte';
	import RoomLayout from './RoomLayout.svelte';
	import SharedHead from './SharedHead.svelte';
	import SoloBar from './SoloBar.svelte';
	import Wall from './Wall.svelte';
	import { botNames, leagueLine } from './words.ts';

	/** A shared draft: read by someone else, never drafted in, with one verb that runs it as theirs. */
	interface Shared {
		starting: boolean;
		onrun: () => void;
	}

	interface Props {
		room: MockRoom;
		board: Board;
		card: RoomCard | null;
		/** The pool search, from the top bar. */
		search: string;
		busy: boolean;
		/** Set when the draft is someone else's, read through its link. */
		shared?: Shared;
		/** A line over the strip after an undo: what was taken back and that the room branched. */
		notice?: string | null;
		/** "Link copied" shows in place of Save and share for a moment. */
		copied?: boolean;
		/** The call for this turn could not be made: the room says so and drafts from the pool. */
		callMissing?: boolean;
		onpick?: (playerId: string) => void;
		onundo?: (pick: number) => void;
		onautopick?: (round: number) => void;
		onfinish?: () => void;
		onqueue?: (ids: string[]) => void;
		onshare?: () => void;
	}

	let {
		room,
		board,
		card,
		search,
		busy,
		shared,
		notice = null,
		copied = false,
		callMissing = false,
		onpick,
		onundo,
		onautopick,
		onfinish,
		onqueue,
		onshare
	}: Props = $props();

	const FILTERS: readonly PoolFilter[] = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DST', 'Queue'];
	/** "Pick for me" drafts this many rounds past the one on the clock. */
	const AUTOPICK_ROUNDS = 3;

	let filter = $state<PoolFilter>('All');
	let marked = $state<string | null>(null);

	const readonly = $derived(shared !== undefined);
	const whose = $derived(readonly ? 'their' : 'your');
	const teams = $derived(room.teams);
	const total = $derived(room.teams * room.rounds);
	const drafted = $derived(draftedSet(room.picks));
	const mine = $derived(room.picks.filter((p) => p.seat === room.slot));
	const round = $derived(snakeSlot(Math.min(room.pick_number, total), teams).round);
	const next = $derived(turnAfter(room.pick_number, room.slot, teams, total));
	const prev = $derived(turnBefore(room.pick_number, room.slot, teams));
	const queue = $derived(room.queue.filter((id) => !drafted.has(id)));
	const queueAll = $derived(new Set(room.queue));
	const rows = $derived(poolRows(board, drafted, filter, queue, search));
	const left = $derived(board.players.length - drafted.size);
	const call = $derived(
		!readonly && card && room.waiting ? callView(card, board, drafted, teams) : null
	);
	/** The call's frame while the next one is on its way: the last call, or before any, the best
	 * player left. The panel draws it as a skeleton, so it holds its place and nothing below moves. */
	let lastCall = $state<CallView | null>(null);
	$effect(() => {
		if (call) lastCall = call;
	});
	/** The pick the drafter just drafted at, until the room moves past it. */
	let draftedAt = $state<number | null>(null);
	const inFlight = $derived(busy && draftedAt === room.pick_number);
	/** No call is coming for this turn: the room never waits on it, Enter drafts from the pool. */
	const noCall = $derived(
		callMissing && !readonly && room.status === 'active' && room.waiting && !call && !inFlight
	);
	/** The pick whose call is on its way: the next turn while a pick is in flight, else this one. */
	const readingFor = $derived(
		readonly || room.status !== 'active' || !room.waiting || noCall
			? null
			: inFlight
				? next
				: call
					? null
					: room.pick_number
	);
	const frame = $derived(
		call ??
			(readingFor === null
				? null
				: (lastCall ?? frameView(board, drafted, teams, room.pick_number)))
	);
	/** The pick whose call has painted. Enter drafts our call only once the reader has seen it, so a
	 * second Enter pressed before the next call paints is dropped on purpose. */
	let paintedFor = $state<number | null>(null);
	$effect(() => {
		const pick = call ? room.pick_number : null;
		if (pick === null) return;
		// The first frame runs before the paint, the second after it.
		let frameId = requestAnimationFrame(() => {
			frameId = requestAnimationFrame(() => (paintedFor = pick));
		});
		return () => cancelAnimationFrame(frameId);
	});
	const callReady = $derived(call !== null && paintedFor === room.pick_number);
	const odds = $derived(card?.still_there ?? {});
	const oddsLabel = $derived(
		card?.next_pick ? `still there at ${pickLabel(card.next_pick, teams)}` : 'your last pick'
	);
	/** The marked player, else our call, else with no call coming the pool's top row. */
	const selectedId = $derived(
		marked !== null && !drafted.has(marked)
			? marked
			: (call?.player.id ?? (noCall ? (rows[0]?.id ?? null) : null))
	);
	const selectedName = $derived(
		selectedId === null ? null : (board.byId.get(selectedId)?.name ?? null)
	);
	const wallRounds = $derived(Math.min(room.rounds, round));
	/** The drafter's seat on the wall: you, or in a shared draft the drafter by handle. */
	const names = $derived(
		botNames(teams, room.slot).map((n, i) =>
			readonly && i + 1 === room.slot ? (room.shared_by ?? 'Drafter') : n
		)
	);
	const lastMine = $derived(mine.at(-1)?.pick ?? null);
	const went = $derived(wentSince(room.picks, prev ?? 0, queueAll, board));

	function draft(id: string | null): void {
		if (readonly || busy || !room.waiting || id === null) return;
		marked = null;
		draftedAt = room.pick_number;
		onpick?.(id);
	}

	/** Undo, Pick for me and Finish are not a pick: the panel must not read as one in flight. */
	function notAPick(run: () => void): void {
		draftedAt = null;
		run();
	}

	function toggleQueue(id: string | null): void {
		if (readonly || id === null) return;
		onqueue?.(queue.includes(id) ? queue.filter((q) => q !== id) : [...queue, id]);
	}

	function move(step: -1 | 1): void {
		const at = rows.findIndex((p) => p.id === selectedId);
		const target = rows[Math.min(Math.max(at + step, 0), rows.length - 1)];
		if (!target) return;
		marked = target.id;
		document.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
	}

	const onkeydown = $derived(
		roomKeys({
			draftCall: () => {
				if (callReady) draft(call?.player.id ?? null);
				else if (noCall) draft(selectedId);
			},
			draftMarked: () => {
				// Unmarked, D drafts the call, so it waits on the call as Enter does.
				if (marked !== null || callReady || noCall) draft(selectedId);
			},
			move,
			queue: () => toggleQueue(selectedId),
			undo: () => {
				const pick = lastMine;
				if (pick !== null && !busy) notAPick(() => onundo?.(pick));
			}
		})
	);
</script>

<svelte:window onkeydown={readonly ? undefined : onkeydown} />

<RoomLayout>
	{#if shared}
		<SharedHead {room} starting={shared.starting} onrun={shared.onrun} />
	{:else if room.status === 'active'}
		<SoloBar
			now={room.pick_number}
			{round}
			league={leagueLine(room.settings, room.slot)}
			{next}
			{teams}
			autopickTo={Math.min(room.rounds, round + AUTOPICK_ROUNDS)}
			canUndo={lastMine !== null}
			{busy}
			{copied}
			onundo={() => {
				const pick = lastMine;
				if (pick !== null) notAPick(() => onundo?.(pick));
			}}
			onautopick={() =>
				notAPick(() => onautopick?.(Math.min(room.rounds, round + AUTOPICK_ROUNDS)))}
			onfinish={() => notAPick(() => onfinish?.())}
			onshare={() => onshare?.()}
		/>
	{/if}
	{#if notice}
		<Panel padding="sm" edge="quiet"><p class="notice">{notice}</p></Panel>
	{/if}
	<LiveRegion words={notice ?? ''} />
	{#if lastMine !== null || inFlight}
		<!-- Once the first turn has passed, the strip's place is held, so its arrival after a pick never
		     pushes the call down. -->
		<div class="since">
			{#if room.waiting && went.length > 0}
				<SinceStrip since={prev} {went} {teams} {whose} />
			{/if}
		</div>
	{:else if room.waiting && went.length > 0}
		<SinceStrip since={prev} {went} {teams} {whose} />
	{/if}
	{#if noCall}
		<Panel as="section" label="No call for this pick" padding="md" edge="quiet">
			<div class="nocall" role="status">
				<p>No call for this pick. Draft from the pool.</p>
				{#if selectedId !== null && selectedName !== null}
					<Verb key="Enter" disabled={busy} onclick={() => draft(selectedId)}
						>Draft {lastName(selectedName)}</Verb
					>
				{/if}
			</div>
		</Panel>
	{:else if frame}
		<RoomCall
			view={frame}
			pickNumber={room.pick_number}
			reading={readingFor === null
				? undefined
				: `Reading the room for ${pickLabel(readingFor, teams)}`}
			action={{
				label: `Draft ${lastName(frame.player.name)}`,
				key: 'Enter',
				onclick: () => {
					if (call) draft(call.player.id);
				}
			}}
		/>
	{/if}
	{#if room.status === 'active'}
		<Pool
			{rows}
			{left}
			{odds}
			{oddsLabel}
			oddsShown={!readonly}
			basis={readonly ? board.basis : poolBasis(board, card, teams, noCall)}
			oddsGone={noCall}
			pickNumber={room.pick_number}
			callId={call?.player.id ?? null}
			{selectedId}
			queue={new Set(queue)}
			draftShown={room.waiting}
			canDraft={!readonly && room.waiting && !busy}
			{readonly}
			{filter}
			filters={readonly ? FILTERS.filter((f) => f !== 'Queue') : FILTERS}
			{search}
			onfilter={(f: PoolFilter) => (filter = f)}
			ondraft={draft}
			onqueue={toggleQueue}
			onselect={(id: string) => (marked = id)}
		/>
	{/if}
	<Wall
		rows={wallRows(room.picks, board, teams, wallRounds)}
		{names}
		you={room.slot}
		now={room.status === 'active' ? room.pick_number : null}
		{teams}
		rounds={room.rounds}
		{whose}
	/>
	{#snippet dock()}
		<TeamPanel
			title={readonly ? 'Their team' : 'Your team'}
			slots={teamSlots(room.settings, mine, board)}
			rosterSize={room.rounds}
			{teams}
			withCall={!readonly}
		/>
		{#if !readonly}<Keys bindings={soloKeys(noCall)} />{/if}
	{/snippet}
</RoomLayout>

<style>
	.nocall {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--s-3);
	}

	.nocall p {
		margin: 0;
		font-size: var(--t-md);
		color: var(--ink-2);
	}

	/* The strip's panel: its strip and the panel's two borders. */
	.since {
		min-block-size: calc(var(--pick-strip-h) + 2px);
	}

	.notice {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}
</style>
