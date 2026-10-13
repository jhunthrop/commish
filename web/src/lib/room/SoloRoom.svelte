<script lang="ts">
	import { lastName, pickLabel, snakeSlot } from '#lib/format/draft.ts';
	import Keys from '#lib/ui/Keys.svelte';
	import SinceStrip from '#lib/ui/SinceStrip.svelte';
	import TeamPanel from '#lib/ui/TeamPanel.svelte';
	import { botNames } from './actions.ts';
	import type { MockRoom, RoomCard } from './api.ts';
	import { callView, oddsBasis } from './call.ts';
	import { SOLO_KEYS, roomKeys } from './keys.ts';
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
	import SoloBar from './SoloBar.svelte';
	import Wall from './Wall.svelte';
	import { leagueLine } from './words.ts';

	interface Props {
		room: MockRoom;
		board: Board;
		card: RoomCard | null;
		/** The pool search, from the top bar. */
		search: string;
		busy: boolean;
		/** A shared draft: read, never drafted in. */
		readonly?: boolean;
		shared?: boolean;
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
		readonly = false,
		shared = false,
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
	const call = $derived(card && room.waiting ? callView(card, board, drafted, teams) : null);
	const odds = $derived(card?.still_there ?? {});
	const oddsLabel = $derived(
		card?.next_pick ? `still there at ${pickLabel(card.next_pick, teams)}` : 'your last pick'
	);
	const selectedId = $derived(
		marked !== null && !drafted.has(marked) ? marked : (call?.player.id ?? null)
	);
	const wallRounds = $derived(Math.min(room.rounds, round));
	const names = $derived(botNames(teams, room.slot));
	const lastMine = $derived(mine.at(-1)?.pick ?? null);

	function draft(id: string | null): void {
		if (readonly || busy || !room.waiting || id === null) return;
		marked = null;
		onpick?.(id);
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
			draft: () => draft(selectedId),
			move,
			queue: () => toggleQueue(selectedId),
			undo: () => {
				if (lastMine !== null && !busy) onundo?.(lastMine);
			}
		})
	);
</script>

<svelte:window onkeydown={readonly ? undefined : onkeydown} />

<RoomLayout>
	{#if !readonly && room.status === 'active'}
		<SoloBar
			now={room.pick_number}
			{round}
			league={leagueLine(room.settings, room.slot)}
			{next}
			{teams}
			autopickTo={Math.min(room.rounds, round + AUTOPICK_ROUNDS)}
			canUndo={lastMine !== null}
			{busy}
			{shared}
			onundo={() => lastMine !== null && onundo?.(lastMine)}
			onautopick={() => onautopick?.(Math.min(room.rounds, round + AUTOPICK_ROUNDS))}
			onfinish={() => onfinish?.()}
			onshare={() => onshare?.()}
		/>
	{/if}
	{#if prev !== null && room.waiting}
		<SinceStrip since={prev} went={wentSince(room.picks, prev, queueAll, board)} {teams} />
	{/if}
	{#if call}
		<RoomCall
			view={call}
			pickNumber={room.pick_number}
			action={{
				label: `Draft ${lastName(call.player.name)}`,
				key: 'Enter',
				onclick: () => draft(call.player.id)
			}}
		/>
	{/if}
	{#if room.status === 'active'}
		<Pool
			{rows}
			{left}
			{odds}
			{oddsLabel}
			oddsBasis={oddsBasis(card, teams)}
			pickNumber={room.pick_number}
			callId={call?.player.id ?? null}
			{selectedId}
			queue={new Set(queue)}
			canDraft={!readonly && room.waiting && !busy}
			{filter}
			filters={FILTERS}
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
	/>
	{#snippet dock()}
		<TeamPanel slots={teamSlots(room.settings, mine, board)} rosterSize={room.rounds} {teams} />
		{#if !readonly}<Keys bindings={SOLO_KEYS} />{/if}
		<span class="seed">Seed {room.seed} · the same seed replays the same bots</span>
	{/snippet}
</RoomLayout>

<style>
	.seed {
		padding: 0 var(--s-1);
		font-size: var(--t-xs);
		color: var(--ink-3);
	}
</style>
