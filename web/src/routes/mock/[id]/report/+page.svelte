<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { type MockReport, rooms } from '#lib/room/api.ts';
	import Report from '#lib/room/report/Report.svelte';
	import RoomNotice from '#lib/room/RoomNotice.svelte';
	import { COPIED_MS, botNames, copyShareLink, runAgain } from '#lib/room/actions.ts';

	const id = $derived(page.params.id ?? '');
	let report = $state<MockReport | null>(null);
	let error = $state<unknown>(null);
	let copied = $state(false);
	let starting = $state(false);

	async function again(): Promise<void> {
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
			report = await rooms.report(id);
		} catch (e) {
			error = e;
		}
	});
</script>

<svelte:head>
	<title>Mock draft report · Commish</title>
</svelte:head>

<Shell title="Mock draft" active="mock">
	{#snippet tail()}
		<Quiet href={resolve('/mock/new')}>New mock</Quiet>
	{/snippet}
	{#if error}
		<div class="notice"><RoomNotice {error} returnTo={page.url.pathname} /></div>
	{/if}
	{#if report}
		{@const r = report}
		<Report
			report={r}
			names={botNames(r.teams, r.slot)}
			field="bots drafting from where drafters take players"
		>
			{#snippet verbs()}
				<Verb onclick={again} disabled={starting}>Run it again from slot {r.slot}</Verb>
				<Quiet href="{resolve('/mock/new')}?from={id}">Try another slot</Quiet>
				<Quiet href="/sheet?from_mock={id}">Save this draft as a sheet</Quiet>
				{#if r.share_code}
					{@const code = r.share_code}
					<Quiet
						onclick={async () => {
							copied = await copyShareLink(code);
							setTimeout(() => (copied = false), COPIED_MS);
						}}>{copied ? 'Link copied' : 'Copy a share link'}</Quiet
					>
				{/if}
			{/snippet}
		</Report>
	{/if}
</Shell>

<style>
	.notice {
		padding: var(--s-4) var(--s-5) 0;
	}
</style>
