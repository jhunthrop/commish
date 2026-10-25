<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import LiveRegion from '#lib/ui/LiveRegion.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { type MockReport, rooms } from '#lib/room/api.ts';
	import Report from '#lib/room/report/Report.svelte';
	import RoomNotice from '#lib/room/RoomNotice.svelte';
	import { COPIED_MS, copyShareLink, runAgain } from '#lib/room/actions.ts';
	import { botNames } from '#lib/room/words.ts';
	import { Flash } from '#lib/room/flash.svelte.ts';
	import { MOCK, runAgainWords } from '#lib/room/mock-words.ts';

	const id = $derived(page.params.id ?? '');
	let report = $state<MockReport | null>(null);
	let error = $state<unknown>(null);
	let starting = $state(false);
	const copied = new Flash(COPIED_MS);

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

	async function copy(code: string): Promise<void> {
		await copyShareLink(code);
		copied.show();
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
		<Quiet href={resolve('/mock/new')}>{MOCK.newMock}</Quiet>
	{/snippet}
	{#if error}
		<div class="notice">
			<RoomNotice {error} subject="mock" returnTo={page.url.pathname} />
		</div>
	{/if}
	{#if report}
		{@const r = report}
		<Report report={r} names={botNames(r.teams, r.slot)} seats={MOCK.botsByAdp}>
			{#snippet verbs()}
				<Verb onclick={again} disabled={starting}>{runAgainWords(r.slot)}</Verb>
				<Quiet href="{resolve('/mock/new')}?from={id}">{MOCK.tryAnother}</Quiet>
				<Quiet href="/sheet?from_mock={id}">Save this draft as a sheet</Quiet>
				{#if r.share_code}
					{@const code = r.share_code}
					<Quiet onclick={() => copy(code)}>{copied.on ? MOCK.copied : MOCK.copyLink}</Quiet
					>
				{/if}
			{/snippet}
		</Report>
	{/if}
	<LiveRegion words={copied.on ? MOCK.copied : ''} />
</Shell>

<style>
	.notice {
		padding: var(--s-4) var(--s-5) 0;
	}
</style>
