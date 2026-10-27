<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Search from '#lib/ui/Search.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { type LobbyRoom, type RoomCard, isFinalRefusal, rooms } from '#lib/room/api.ts';
	import { canTryAgain, readLobby } from '#lib/room/lobby-read.ts';
	import { type LobbyState, applyActions, initialLobby } from '#lib/room/lobby.ts';
	import { LobbySocket, type SocketStatus } from '#lib/room/lobby-socket.ts';
	import LobbyRoomView from '#lib/room/LobbyRoomView.svelte';
	import { type Board, boardOf } from '#lib/room/model.ts';
	import RoomNotice from '#lib/room/RoomNotice.svelte';
	import { rememberLeft } from '#lib/room/setup/left.ts';
	import { LOBBY } from '#lib/room/lobby-words.ts';

	/** The clock's redraw: a second clock read four times a second never shows a stale second. */
	const TICK_MS = 250;

	const id = $derived(page.params.id ?? '');
	let room = $state<LobbyRoom | null>(null);
	let board = $state<Board | null>(null);
	let lobby = $state<LobbyState | null>(null);
	let card = $state<RoomCard | null>(null);
	let error = $state<unknown>(null);
	/** The room's read did not go (no signal, the API's own fault): Try again reads it again in place. */
	let retryable = $state(false);
	/** The error on show is the room's read (the page did not load), not a failed Leave or join. */
	let readFailed = $state(false);
	/** The page has gone: a read that answers after it opens no socket. */
	let destroyed = false;
	let refused = $state<string | null>(null);
	let status = $state<SocketStatus>('connecting');
	let offset = $state(0);
	let now = $state(Date.now());
	let query = $state('');
	let socket: LobbySocket | null = null;
	let cardFor = -1;

	/** The lobby is still drafting or filling: it has a pool to search and a seat to leave. */
	const open = $derived(lobby !== null && !lobby.complete && !lobby.abandoned && error === null);
	/** The lobby no longer takes people: closed unattended, drafted to the end, or answered with an
	 * error. Each is a final state the server reports, so the bar passes no parts only then, never
	 * while the lobby loads. */
	const closed = $derived(error !== null || lobby?.complete === true || lobby?.abandoned === true);

	async function loadCard(state: LobbyState): Promise<void> {
		if (!state.drafting || state.complete || cardFor === state.pickNumber) return;
		cardFor = state.pickNumber;
		try {
			const next = await rooms.lobbyCard(id);
			if (lobby?.pickNumber === state.pickNumber) card = next;
		} catch {
			// The room drafts without a card; the next pick brings one.
			card = null;
		}
	}

	/** A closed lobby's verb: a seat in the next one filling in the same format. A full page load,
	 * since this page's socket and state belong to the room it was opened on. */
	async function joinAnother(format: LobbyRoom['format']): Promise<void> {
		try {
			const seat = await rooms.join(format);
			socket?.close();
			location.assign(resolve('/lobby/[id]', { id: seat.room_id }));
		} catch (e) {
			error = e;
		}
	}

	/** Leave asks once: what happens to the seat, then the way back from setup. */
	let leaving = $state(false);
	let confirmLeave = $state<HTMLElement | null>(null);

	$effect(() => {
		if (leaving) confirmLeave?.focus();
	});

	async function leave(): Promise<void> {
		try {
			await rooms.leave(id);
		} catch (e) {
			error = e;
			leaving = false;
			return;
		}
		socket?.close();
		rememberLeft(id);
		await goto(resolve('/mock/new'));
	}

	/** The room's socket, once its read is in: the log's replay from the welcome, every update after. */
	function connect(loaded: LobbyRoom): void {
		board = boardOf(loaded.board, loaded.teams);
		room = loaded;
		lobby = initialLobby(loaded);
		socket = new LobbySocket(loaded.socket_url, {
			onactions: (actions) => {
				if (!lobby) return;
				lobby = applyActions(lobby, actions, loaded.you);
				if (card && card.pick_number !== lobby.pickNumber) card = null;
				void loadCard(lobby);
			},
			onclock: (ms) => (offset = ms),
			onstatus: (s) => (status = s),
			onrefused: (message) => (refused = message),
			probe: () =>
				rooms.lobby(id).then(
					() => null,
					(e: unknown) => (isFinalRefusal(e) ? e : null)
				),
			onstopped: (reason) => (error = reason)
		});
		socket.connect();
	}

	/** The room's read, and Try again's: a read that did not go offers Try again beside the way out,
	 * a refusal for good keeps only the way out. */
	async function read(): Promise<void> {
		error = null;
		retryable = false;
		readFailed = false;
		const answer = await readLobby(
			() => rooms.lobby(id),
			() => !destroyed
		);
		if (answer.kind === 'left') return;
		if (answer.kind === 'failed') {
			error = answer.error;
			retryable = canTryAgain(answer);
			readFailed = true;
			return;
		}
		try {
			connect(answer.room);
		} catch (e) {
			error = e;
		}
	}

	onMount(() => {
		const ticker = setInterval(() => (now = Date.now() + offset), TICK_MS);
		void read();
		return () => {
			destroyed = true;
			clearInterval(ticker);
			socket?.close();
		};
	});
</script>

<svelte:head>
	<title>Mock lobby · Commish</title>
</svelte:head>

{#snippet poolSearch()}
	{#if open}<Search
			placeholder={LOBBY.searchPool}
			label={LOBBY.searchPool}
			bind:value={query}
		/>{/if}
{/snippet}

{#snippet leaveAction()}
	{#if open && !leaving}<Quiet onclick={() => (leaving = true)}>{LOBBY.leave}</Quiet>{/if}
{/snippet}

<!-- A closed lobby has no pool to search and no seat to leave, so it passes neither and its bar is
     the one row. The bar shrinks only when the server says so, with the page under it replaced by
     the closed notice, never while the lobby loads. -->
<Shell
	title="Mock draft"
	active="mock"
	search={closed ? undefined : poolSearch}
	tail={closed ? undefined : leaveAction}
>
	{#if error}
		<div class="notice">
			<RoomNotice
				{error}
				subject="lobby"
				returnTo={page.url.pathname}
				retry={retryable ? { label: LOBBY.tryAgain, run: () => void read() } : undefined}
				read={readFailed}
			/>
		</div>
	{/if}
	{#if leaving && lobby}
		<!-- One quiet step: the room's own verb (Draft on your clock) stays the only solid one, and focus
		     moves here so a keyboard or a screen reader lands on the question. -->
		<div
			class="notice"
			role="group"
			aria-labelledby="leave-question"
			tabindex="-1"
			bind:this={confirmLeave}
		>
			<Panel padding="sm" edge="quiet">
				<div class="done">
					<p class="line" id="leave-question">
						{lobby.drafting ? LOBBY.leaveDrafting : LOBBY.leaveFilling}
					</p>
					<Quiet onclick={leave}>{LOBBY.leaveVerb}</Quiet>
					<Quiet onclick={() => (leaving = false)}>{LOBBY.stay}</Quiet>
				</div>
			</Panel>
		</div>
	{/if}
	{#if status === 'reconnecting' || refused}
		<div class="notice">
			<Panel padding="sm">
				<p class="line">
					{status === 'reconnecting' ? LOBBY.reconnecting : refused}
				</p>
			</Panel>
		</div>
	{/if}
	{#if lobby?.complete}
		<div class="notice">
			<Panel padding="sm">
				<div class="done">
					<p class="line">{LOBBY.over}</p>
					<Verb href={resolve('/lobby/[id]/report', { id })}>{LOBBY.readReport}</Verb>
				</div>
			</Panel>
		</div>
	{/if}
	{#if room && lobby?.abandoned}
		{@const format = room.format}
		<div class="notice">
			<Panel padding="sm">
				<div class="done">
					<p class="line">{LOBBY.abandoned}</p>
					<Verb onclick={() => joinAnother(format)}>{LOBBY.joinAnother}</Verb>
				</div>
			</Panel>
		</div>
	{:else if room && board && lobby}
		<LobbyRoomView
			{room}
			{board}
			{lobby}
			{card}
			{now}
			search={query}
			onpick={(player: string) => {
				refused = null;
				socket?.send({ type: 'pick', player_id: player, pick: lobby?.pickNumber });
			}}
			onqueue={(ids: string[]) => socket?.send({ type: 'queue', player_ids: ids })}
		/>
	{/if}
</Shell>

<style>
	.notice {
		padding: var(--s-4) var(--s-5) 0;
	}

	.line {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.done {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-3);
		align-items: center;
	}
</style>
