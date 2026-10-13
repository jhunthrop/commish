<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Search from '#lib/ui/Search.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { botNames, runAgain } from '#lib/room/actions.ts';
	import { type MockReport, type MockRoom, rooms } from '#lib/room/api.ts';
	import { type Board, boardOf } from '#lib/room/model.ts';
	import Report from '#lib/room/report/Report.svelte';
	import RoomNotice from '#lib/room/RoomNotice.svelte';
	import SoloRoom from '#lib/room/SoloRoom.svelte';

	/** A shared draft: the report when it is finished, the room as it stood otherwise. Anyone with the
	 * link reads it; running it again makes the reader's own mock. */
	const code = $derived(page.params.code ?? '');
	let room = $state<MockRoom | null>(null);
	let board = $state<Board | null>(null);
	let report = $state<MockReport | null>(null);
	let error = $state<unknown>(null);
	let starting = $state(false);
	let query = $state('');

	async function again(): Promise<void> {
		if (!room || starting) return;
		starting = true;
		try {
			await runAgain(room.settings, room.slot);
		} catch (e) {
			error = e;
			starting = false;
		}
	}

	onMount(async () => {
		try {
			const loaded = await rooms.shared(code);
			if (loaded.board) board = boardOf(loaded.board, loaded.teams);
			room = loaded;
			if (loaded.status === 'complete') report = await rooms.sharedReport(code);
		} catch (e) {
			error = e;
		}
	});
</script>

<svelte:head>
	<title>A shared mock draft · Commish</title>
</svelte:head>

<Shell title="Mock draft" active="mock">
	{#snippet search()}
		{#if !report}<Search
				placeholder="Search the pool"
				label="Search the pool"
				bind:value={query}
			/>{/if}
	{/snippet}
	{#snippet tail()}
		<Quiet href={resolve('/mock/new')}>New mock</Quiet>
	{/snippet}
	{#if error}
		<div class="notice"><RoomNotice {error} returnTo={page.url.pathname} /></div>
	{/if}
	{#if report && room}
		{@const r = report}
		<Report
			report={r}
			names={botNames(r.teams, r.slot)}
			field="bots drafting from where drafters take players"
		>
			{#snippet verbs()}
				<Verb onclick={again} disabled={starting}>Run it yourself from slot {r.slot}</Verb>
				<Quiet href={resolve('/mock/new')}>Set up your own</Quiet>
			{/snippet}
		</Report>
	{:else if room && board}
		<SoloRoom {room} {board} card={null} search={query} busy={false} readonly />
	{/if}
</Shell>

<style>
	.notice {
		padding: var(--s-4) var(--s-5) 0;
	}
</style>
