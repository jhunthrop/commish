<script lang="ts">
	import { clockLabel, pickLabel, snakeSlot } from '#lib/format/draft.ts';
	import { plural } from '#lib/format/number.ts';
	import Keys from '#lib/ui/Keys.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import ScoreBug from '#lib/ui/ScoreBug.svelte';
	import TeamPanel from '#lib/ui/TeamPanel.svelte';
	import type { LobbyRoom, RoomCard } from './api.ts';
	import { callView, draftWords, poolBasis } from './call.ts';
	import { lobbyKeys, roomKeys } from './keys.ts';
	import { type LobbyState, seatName, seatedPeople } from './lobby.ts';
	import LandingStrip from './LandingStrip.svelte';
	import {
		type Board,
		type PoolFilter,
		draftedSet,
		poolRows,
		seatAt,
		teamSlots,
		turnFrom,
		wallRows
	} from './model.ts';
	import Pool from './Pool.svelte';
	import RoomCall from './RoomCall.svelte';
	import RoomLayout from './RoomLayout.svelte';
	import SeatsStrip from './SeatsStrip.svelte';
	import Wall from './Wall.svelte';
	import { presetWords } from './words.ts';

	interface Props {
		room: LobbyRoom;
		board: Board;
		lobby: LobbyState;
		card: RoomCard | null;
		/** Milliseconds on the server's clock, ticking. */
		now: number;
		search: string;
		onpick: (playerId: string) => void;
		onqueue: (ids: string[]) => void;
	}

	let { room, board, lobby, card, now, search, onpick, onqueue }: Props = $props();

	const FILTERS: readonly PoolFilter[] = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DST', 'Queue'];

	let filter = $state<PoolFilter>('All');
	let marked = $state<string | null>(null);

	const teams = $derived(room.teams);
	const total = $derived(room.teams * room.rounds);
	const you = $derived(room.you);
	const drafted = $derived(draftedSet(lobby.picks));
	const mine = $derived(lobby.picks.filter((p) => p.seat === you));
	const onClock = $derived(
		lobby.drafting && lobby.pickNumber <= total ? seatAt(lobby.pickNumber, teams) : null
	);
	const yourTurn = $derived(onClock === you);
	const yourPick = $derived(lobby.drafting ? turnFrom(lobby.pickNumber, you, teams, total) : null);
	const queue = $derived(lobby.queue.filter((id) => !drafted.has(id)));
	const rows = $derived(poolRows(board, drafted, filter, queue, search));
	const call = $derived(card && lobby.drafting ? callView(card, board, drafted, teams) : null);
	const chance = $derived(card?.still_there ?? {});
	const landing = $derived(lobby.picks.slice(-teams).reverse());
	const round = $derived(snakeSlot(Math.min(lobby.pickNumber, total), teams).round);
	const secondsLeft = $derived(
		lobby.deadline === null ? 0 : Math.max(0, Math.ceil((lobby.deadline - now) / 1000))
	);
	const fillLeft = $derived(
		room.fill_deadline === null
			? 0
			: Math.max(0, Math.ceil((Date.parse(room.fill_deadline) - now) / 1000))
	);
	const started = $derived(lobby.drafting || lobby.complete);
	/** Everyone who holds a seat, here or gone with a stand-in drafting: counted from the start. */
	const people = $derived(seatedPeople(lobby.seats.values()));
	const selectedId = $derived(
		marked !== null && !drafted.has(marked) ? marked : (call?.player.id ?? null)
	);
	const names = $derived(
		Array.from({ length: teams }, (_, i) => {
			const seat = lobby.seats.get(i + 1);
			return seatName(
				{ seat: i + 1, handle: seat?.handle ?? null, kind: seat?.kind ?? 'open' },
				you
			);
		})
	);
	const onClockName = $derived(onClock === null ? '' : (names[onClock - 1] ?? ''));
	const chanceLabel = $derived.by(() => {
		if (!card) return '';
		if (card.conditional) return `reaches ${pickLabel(card.for_pick, teams)}`;
		return card.next_pick ? `still there at ${pickLabel(card.next_pick, teams)}` : 'your last pick';
	});

	function draft(id: string | null): void {
		if (!yourTurn || id === null) return;
		marked = null;
		onpick(id);
	}

	function toggleQueue(id: string | null): void {
		if (id === null) return;
		onqueue(queue.includes(id) ? queue.filter((q) => q !== id) : [...queue, id]);
	}

	/** "Queue him first": to the front of the queue. */
	function queueFirst(id: string): void {
		onqueue([id, ...queue.filter((q) => q !== id)]);
	}

	function move(step: -1 | 1): void {
		const at = rows.findIndex((p) => p.id === selectedId);
		const target = rows[Math.min(Math.max(at + step, 0), rows.length - 1)];
		if (target) marked = target.id;
	}

	const onkeydown = $derived(
		roomKeys({
			draftCall: () => draft(yourTurn ? (call?.player.id ?? null) : null),
			draftMarked: () => draft(selectedId),
			move,
			queue: () => toggleQueue(selectedId)
		})
	);
</script>

<svelte:window {onkeydown} />

<RoomLayout>
	{#if lobby.drafting && yourPick !== null}
		<ScoreBug now={lobby.pickNumber} onClock={onClockName} {secondsLeft} {yourPick} {teams} />
	{/if}
	<SeatsStrip seats={lobby.seats} {teams} {you} {onClock} />
	{#if !started}
		<Panel>
			<p class="wait">
				<b>{people} of {teams} in.</b> The draft starts when {teams} are in, or in {clockLabel(
					fillLeft
				)}
				with bots in the open seats.
			</p>
		</Panel>
	{/if}
	<LandingStrip picks={landing} {board} seats={lobby.seats} {you} {teams} />
	{#if call}
		<RoomCall
			view={call}
			action={yourTurn
				? {
						label: draftWords(call.player.position),
						key: 'Enter',
						onclick: () => draft(call.player.id)
					}
				: {
						label: `${draftWords(call.player.position, 'Queue')} first`,
						onclick: () => queueFirst(call.player.id)
					}}
		/>
	{/if}
	{#if !lobby.complete}
		<Pool
			{rows}
			left={board.players.length - drafted.size}
			{chance}
			{chanceLabel}
			chanceShown={card !== null}
			basis={poolBasis(board, card, teams)}
			callId={call?.player.id ?? null}
			{selectedId}
			queue={new Set(queue)}
			draftShown={yourTurn}
			canDraft={yourTurn}
			{filter}
			filters={FILTERS}
			{search}
			onfilter={(f: PoolFilter) => (filter = f)}
			ondraft={draft}
			onqueue={toggleQueue}
			onselect={(id: string) => (marked = id)}
		/>
	{/if}
	<Wall
		rows={wallRows(lobby.picks, board, teams, Math.min(room.rounds, round))}
		{names}
		{you}
		now={lobby.drafting ? lobby.pickNumber : null}
		{teams}
		rounds={room.rounds}
	/>
	{#snippet dock()}
		<Panel padding="sm">
			<p class="about">
				<b>{teams} {presetWords(room.settings.scoring.preset ?? 'ppr')} lobby</b>, {plural(
					people,
					'drafter'
				)}{started
					? ` and ${plural(teams - people, 'bot')}`
					: `, ${plural(teams - people, 'seat')} open`}. {room.clock_seconds} seconds a pick, your queue
				drafts if you step away, a bot takes any seat that closes the tab.
			</p>
		</Panel>
		<TeamPanel slots={teamSlots(room.settings, mine, board)} rosterSize={room.rounds} {teams} />
		<Keys bindings={lobbyKeys(yourTurn)} />
	{/snippet}
</RoomLayout>

<style>
	.wait,
	.about {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.wait b,
	.about b {
		color: var(--ink);
	}
</style>
