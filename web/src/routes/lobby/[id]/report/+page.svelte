<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { plural } from '#lib/format/number.ts';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { runAgain } from '#lib/room/actions.ts';
	import { botName } from '#lib/room/words.ts';
	import { type LobbyRoom, type MockReport, rooms } from '#lib/room/api.ts';
	import { seatName, seatedPeople } from '#lib/room/lobby.ts';
	import Report from '#lib/room/report/Report.svelte';
	import RoomNotice from '#lib/room/RoomNotice.svelte';

	const id = $derived(page.params.id ?? '');
	let report = $state<MockReport | null>(null);
	let room = $state<LobbyRoom | null>(null);
	let error = $state<unknown>(null);
	let starting = $state(false);

	const names = $derived(
		room
			? Array.from({ length: room.teams }, (_, i) => {
					const seat = room?.seats.find((s) => s.seat === i + 1);
					return seat ? seatName(seat, room?.you ?? 0) : botName(i + 1);
				})
			: []
	);
	const people = $derived(room ? seatedPeople(room.seats) : 0);

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
		<div class="notice">
			<RoomNotice {error} subject="lobby" returnTo={page.url.pathname} />
		</div>
	{/if}
	{#if report}
		{@const r = report}
		<Report
			report={r}
			{names}
			seats="{plural(people, 'drafter')}, {plural(r.teams - people, 'bot')}"
		>
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
