<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import LiveRegion from '#lib/ui/LiveRegion.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Search from '#lib/ui/Search.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import { type MockRoom, type RoomCard, rooms } from '#lib/room/api.ts';
	import { COPIED_MS, copyShareLink } from '#lib/room/actions.ts';
	import { Flash } from '#lib/room/flash.svelte.ts';
	import { type Board, boardOf } from '#lib/room/model.ts';
	import { MOCK, undoneWords } from '#lib/room/mock-words.ts';
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

	/** The turn's call could not be made: the room says so and drafts from the pool. */
	let cardMissing = $state(false);

	async function loadCard(current: MockRoom): Promise<void> {
		card = null;
		cardMissing = false;
		if (!current.waiting) return;
		const stillHere = (): boolean => room?.pick_number === current.pick_number;
		try {
			const next = await rooms.card(id);
			if (!stillHere()) return;
			if (next.pick_number === current.pick_number) card = next;
			else cardMissing = true;
		} catch {
			// The room never waits on a call that is not coming: it drafts from the pool.
			if (stillHere()) cardMissing = true;
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
		if (samePick) return;
		// The turn brings its card, so the call paints with it. Without one, the room asks.
		if (next.card?.pick_number === next.pick_number) {
			card = next.card;
			cardMissing = false;
		} else await loadCard(next);
	}

	/** Every write to the room runs one after another, so a key pressed while another write is on
	 * its way acts when that write lands instead of being lost or racing it. */
	let writes: Promise<void> = Promise.resolve();

	function write(job: () => Promise<void>): Promise<void> {
		const next = writes.then(job);
		writes = next;
		return next;
	}

	/** A pick, an undo or a stand-in run: one at a time, the room busy until its turn has its call. */
	async function act(run: () => Promise<MockRoom>, after: string | null = null): Promise<void> {
		if (busy) return;
		busy = true;
		error = null;
		await write(async () => {
			try {
				await settle(await run());
				branch = after;
			} catch (e) {
				error = e;
			} finally {
				busy = false;
			}
		});
	}

	/** The queue as the drafter last set it, shown at once, until its writes land. A queue write never
	 * holds the room busy, so D or Enter right after Q still acts. */
	let queued = $state<string[] | null>(null);
	let queueWrites = 0;

	function setQueue(ids: string[]): void {
		queued = ids;
		queueWrites += 1;
		void write(async () => {
			try {
				await settle(await rooms.queue(id, ids));
			} catch (e) {
				error = e;
			} finally {
				queueWrites -= 1;
				if (queueWrites === 0) queued = null;
			}
		});
	}

	/** The undo's line: the pick it went back to, who is back in the pool, and that the room branched. */
	function undone(pick: number): string | null {
		if (!room || !board) return null;
		const made = room.picks.find((p) => p.pick === pick);
		const player = made ? board.byId.get(made.player_id) : undefined;
		return undoneWords(pick, room.teams, player?.name ?? null);
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
			if (loaded.card?.pick_number === loaded.pick_number) card = loaded.card;
			else await loadCard(loaded);
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
		<!-- A room that never loaded shows its notice with New mock, so the bar leaves it out. -->
		{#if room !== null || !error}<Quiet href={resolve('/mock/new')}>{MOCK.newMock}</Quiet>{/if}
	{/snippet}
	{#if error}
		<div class="notice">
			<RoomNotice {error} subject="mock" returnTo={page.url.pathname} />
		</div>
	{/if}
	{#if room && board}
		<SoloRoom
			room={queued === null ? room : { ...room, queue: queued }}
			{board}
			{card}
			search={query}
			{busy}
			notice={branch}
			callMissing={cardMissing}
			copied={copied.on}
			onpick={(player: string) => act(() => rooms.pick(id, player, room?.pick_number ?? 0))}
			onundo={(pick: number) => act(() => rooms.undo(id, pick), undone(pick))}
			onautopick={(round: number) => act(() => rooms.autopick(id, round))}
			onfinish={() => act(() => rooms.finish(id))}
			onqueue={setQueue}
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
