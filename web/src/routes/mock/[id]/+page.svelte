<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { lastName, pickLabel } from '#lib/format/draft.ts';
	import LiveRegion from '#lib/ui/LiveRegion.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Search from '#lib/ui/Search.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import { type MockRoom, type RoomCard, rooms } from '#lib/room/api.ts';
	import { COPIED_MS, copyShareLink } from '#lib/room/actions.ts';
	import { Flash } from '#lib/room/flash.svelte.ts';
	import { type Board, boardOf } from '#lib/room/model.ts';
	import RoomNotice from '#lib/room/RoomNotice.svelte';
	import SoloRoom from '#lib/room/SoloRoom.svelte';

	const id = $derived(page.params.id ?? '');
	let room = $state<MockRoom | null>(null);
	let board = $state<Board | null>(null);
	let card = $state<RoomCard | null>(null);
	let error = $state<unknown>(null);
	let busy = $state(false);
	let query = $state('');
	/** The line after an undo, until the next pick moves the room on. */
	let branch = $state<string | null>(null);
	const copied = new Flash(COPIED_MS);

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

	async function act(run: () => Promise<MockRoom>, after: string | null = null): Promise<void> {
		if (busy) return;
		busy = true;
		error = null;
		try {
			await settle(await run());
			branch = after;
		} catch (e) {
			error = e;
		} finally {
			busy = false;
		}
	}

	/** The undo's line: the pick it went back to, who is back in the pool, and that the room branched. */
	function undoneWords(pick: number): string | null {
		if (!room || !board) return null;
		const made = room.picks.find((p) => p.pick === pick);
		const player = made ? board.byId.get(made.player_id) : undefined;
		const at = pickLabel(pick, room.teams);
		const back = player ? ` ${lastName(player.name)} is in the pool again.` : '';
		return `Back to ${at}.${back} Same bots, same seed, so the room drafts the same until your pick goes another way.`;
	}

	async function share(): Promise<void> {
		if (!room) return;
		await copyShareLink(room.share_code);
		copied.show();
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
		{#if room}<Search
				placeholder="Search the pool"
				label="Search the pool"
				bind:value={query}
			/>{/if}
	{/snippet}
	{#snippet tail()}
		<Quiet href={resolve('/mock/new')}>New mock</Quiet>
	{/snippet}
	{#if error}
		<div class="notice">
			<RoomNotice {error} subject="mock" returnTo={page.url.pathname} />
		</div>
	{/if}
	{#if room && board}
		<SoloRoom
			{room}
			{board}
			{card}
			search={query}
			{busy}
			notice={branch}
			copied={copied.on}
			onpick={(player: string) => act(() => rooms.pick(id, player, room?.pick_number ?? 0))}
			onundo={(pick: number) => act(() => rooms.undo(id, pick), undoneWords(pick))}
			onautopick={(round: number) => act(() => rooms.autopick(id, round))}
			onfinish={() => act(() => rooms.finish(id))}
			onqueue={(ids: string[]) => act(() => rooms.queue(id, ids), branch)}
			onshare={share}
		/>
	{/if}
	<LiveRegion words={copied.on ? 'Link copied' : ''} />
</Shell>

<style>
	.notice {
		padding: var(--s-4) var(--s-5) 0;
	}
</style>
