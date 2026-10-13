<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Search from '#lib/ui/Search.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import { type MockRoom, type RoomCard, rooms } from '#lib/room/api.ts';
	import { type Board, boardOf } from '#lib/room/model.ts';
	import RoomNotice from '#lib/room/RoomNotice.svelte';
	import SoloRoom from '#lib/room/SoloRoom.svelte';
	import { COPIED_MS, copyShareLink } from '#lib/room/actions.ts';

	const id = $derived(page.params.id ?? '');
	let room = $state<MockRoom | null>(null);
	let board = $state<Board | null>(null);
	let card = $state<RoomCard | null>(null);
	let error = $state<unknown>(null);
	let busy = $state(false);
	let query = $state('');
	let shared = $state(false);

	async function loadCard(current: MockRoom): Promise<void> {
		card = null;
		if (!current.waiting) return;
		try {
			const next = await rooms.card(id);
			if (room?.pick_number === next.pick_number) card = next;
		} catch {
			// The room drafts without a card; the call lands with the next one.
			card = null;
		}
	}

	async function settle(next: MockRoom): Promise<void> {
		const samePick = room?.pick_number === next.pick_number;
		room = { ...next, board: room?.board ?? next.board };
		if (next.status === 'complete') {
			await goto(resolve('/mock/[id]/report', { id }));
			return;
		}
		// A queue change keeps the turn, and the turn keeps its card.
		if (!samePick) await loadCard(next);
	}

	async function act(run: () => Promise<MockRoom>): Promise<void> {
		if (busy) return;
		busy = true;
		error = null;
		try {
			await settle(await run());
		} catch (e) {
			error = e;
		} finally {
			busy = false;
		}
	}

	async function share(): Promise<void> {
		if (!room) return;
		shared = await copyShareLink(room.share_code);
		setTimeout(() => (shared = false), COPIED_MS);
	}

	onMount(async () => {
		try {
			const loaded = await rooms.mock(id);
			if (!loaded.board) throw new Error('The room came back without its board.');
			board = boardOf(loaded.board, loaded.teams);
			room = loaded;
			if (loaded.status === 'complete') {
				await goto(resolve('/mock/[id]/report', { id }), { replaceState: true });
				return;
			}
			await loadCard(loaded);
		} catch (e) {
			error = e;
		}
	});
</script>

<svelte:head>
	<title>Mock draft · Commish</title>
</svelte:head>

<Shell title="Mock draft" active="mock">
	{#snippet search()}
		<Search placeholder="Search the pool" label="Search the pool" bind:value={query} />
	{/snippet}
	{#snippet tail()}
		<Quiet href={resolve('/mock/new')}>New mock</Quiet>
	{/snippet}
	{#if error}
		<div class="notice"><RoomNotice {error} returnTo={page.url.pathname} /></div>
	{/if}
	{#if room && board}
		<SoloRoom
			{room}
			{board}
			{card}
			search={query}
			{busy}
			{shared}
			onpick={(player: string) => act(() => rooms.pick(id, player, room?.pick_number ?? 0))}
			onundo={(pick: number) => act(() => rooms.undo(id, pick))}
			onautopick={(round: number) => act(() => rooms.autopick(id, round))}
			onfinish={() => act(() => rooms.finish(id))}
			onqueue={(ids: string[]) => act(() => rooms.queue(id, ids))}
			onshare={share}
		/>
	{/if}
</Shell>

<style>
	.notice {
		padding: var(--s-4) var(--s-5) 0;
	}
</style>
