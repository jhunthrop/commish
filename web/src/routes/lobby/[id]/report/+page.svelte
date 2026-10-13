<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { runAgain } from '#lib/room/actions.ts';
	import { type LobbyRoom, type MockReport, rooms } from '#lib/room/api.ts';
	import Report from '#lib/room/report/Report.svelte';
	import RoomNotice from '#lib/room/RoomNotice.svelte';

	const id = $derived(page.params.id ?? '');
	let report = $state<MockReport | null>(null);
	let room = $state<LobbyRoom | null>(null);
	let error = $state<unknown>(null);
	let starting = $state(false);

	const names = $derived(
		room
			? room.seats.map((s) =>
					s.seat === room?.you ? 'You' : s.kind === 'bot' || s.handle === null ? 'Bot' : s.handle
				)
			: []
	);
	const people = $derived(room ? room.seats.filter((s) => s.kind !== 'bot').length : 0);

	async function solo(): Promise<void> {
		if (!report || starting) return;
		starting = true;
		try {
			await runAgain(report.settings, report.slot);
		} catch (e) {
			error = e;
			starting = false;
		}
	}

	onMount(async () => {
		try {
			[room, report] = await Promise.all([rooms.lobby(id), rooms.lobbyReport(id)]);
		} catch (e) {
			error = e;
		}
	});
</script>

<svelte:head>
	<title>Lobby report · Commish</title>
</svelte:head>

<Shell title="Mock draft" active="mock">
	{#if error}
		<div class="notice"><RoomNotice {error} returnTo={page.url.pathname} /></div>
	{/if}
	{#if report}
		{@const r = report}
		<Report report={r} {names} field="{people} drafters and {r.teams - people} bots">
			{#snippet verbs()}
				<Verb href={resolve('/mock/new')}>Join another lobby</Verb>
				<Quiet onclick={solo} disabled={starting}>Run it against bots from slot {r.slot}</Quiet>
			{/snippet}
		</Report>
	{/if}
</Shell>

<style>
	.notice {
		padding: var(--s-4) var(--s-5) 0;
	}
</style>
