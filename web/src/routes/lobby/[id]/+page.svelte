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
	import { type LobbyState, applyActions, initialLobby } from '#lib/room/lobby.ts';
	import { LobbySocket, type SocketStatus } from '#lib/room/lobby-socket.ts';
	import LobbyRoomView from '#lib/room/LobbyRoomView.svelte';
	import { type Board, boardOf } from '#lib/room/model.ts';
	import RoomNotice from '#lib/room/RoomNotice.svelte';

	/** The clock's redraw: a second clock read four times a second never shows a stale second. */
	const TICK_MS = 250;

	const id = $derived(page.params.id ?? '');
	let room = $state<LobbyRoom | null>(null);
	let board = $state<Board | null>(null);
	let lobby = $state<LobbyState | null>(null);
	let card = $state<RoomCard | null>(null);
	let error = $state<unknown>(null);
	let refused = $state<string | null>(null);
	let status = $state<SocketStatus>('connecting');
	let offset = $state(0);
	let now = $state(Date.now());
	let query = $state('');
	let socket: LobbySocket | null = null;
	let cardFor = -1;

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

	async function leave(): Promise<void> {
		socket?.close();
		await rooms.leave(id).catch(() => undefined);
		await goto(resolve('/mock/new'));
	}

	onMount(() => {
		const ticker = setInterval(() => (now = Date.now() + offset), TICK_MS);
		void (async () => {
			try {
				const loaded = await rooms.lobby(id);
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
			} catch (e) {
				error = e;
			}
		})();
		return () => {
			clearInterval(ticker);
			socket?.close();
		};
	});
</script>

<svelte:head>
	<title>Mock lobby · Commish</title>
</svelte:head>

<Shell title="Mock draft" active="mock">
	{#snippet search()}
		<Search placeholder="Search the pool" label="Search the pool" bind:value={query} />
	{/snippet}
	{#snippet tail()}
		{#if lobby && !lobby.complete}<Quiet onclick={leave}>Leave</Quiet>{/if}
	{/snippet}
	{#if error}
		<div class="notice"><RoomNotice {error} returnTo={page.url.pathname} /></div>
	{/if}
	{#if status === 'reconnecting' || refused}
		<div class="notice">
			<Panel padding="sm">
				<p class="line">
					{status === 'reconnecting' ? 'Reconnecting to the room.' : refused}
				</p>
			</Panel>
		</div>
	{/if}
	{#if lobby?.complete}
		<div class="notice">
			<Panel padding="sm">
				<div class="done">
					<p class="line">The draft is over.</p>
					<Verb href={resolve('/lobby/[id]/report', { id })}>Read the report</Verb>
				</div>
			</Panel>
		</div>
	{/if}
	{#if room && board && lobby}
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
