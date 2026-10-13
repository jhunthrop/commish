<script lang="ts">
	import { onMount } from 'svelte';
	import { boardOf, type Board } from '#lib/room/model.ts';
	import Report from '#lib/room/report/Report.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import {
		ApiError,
		HTTP,
		companions,
		isSignedOut,
		type Companion,
		type CompanionPick,
		type Feature,
		type MockReport
	} from './api.ts';
	import CompanionRoom from './CompanionRoom.svelte';
	import { POLL_MS, mergePicks } from './model.ts';

	/** One followed draft: read every three seconds while it runs, the report once Sleeper says it
	 * is over. Everything is read in the browser; the shell paints first. */
	interface Props {
		id: string;
	}

	let { id }: Props = $props();

	const NEW_HREF = '/companion/new';

	let companion = $state<Companion | null>(null);
	let picks = $state<CompanionPick[]>([]);
	let board = $state<Board | null>(null);
	let features = $state<Feature[]>([]);
	let report = $state<MockReport | null>(null);
	let failure = $state<'signed-out' | 'missing' | 'unreachable' | null>(null);
	/** Set while a read failed and the page is trying again; the last answer stays on screen. */
	let retrying = $state(false);

	async function read(): Promise<void> {
		const since = companion ? companion.pick_count : 0;
		try {
			const answer = await companions.read(id, since);
			if (answer.board) board = boardOf(answer.board, answer.teams);
			picks = mergePicks(picks, answer);
			companion = answer;
			retrying = false;
			if (answer.status === 'complete' && answer.lost_at === null && report === null) {
				report = await companions.report(id);
			}
		} catch (error) {
			if (isSignedOut(error)) failure = 'signed-out';
			else if (error instanceof ApiError && error.status === HTTP.notFound) failure = 'missing';
			else if (companion === null) failure = 'unreachable';
			else retrying = true;
		}
	}

	onMount(() => {
		let timer: ReturnType<typeof setTimeout> | null = null;
		let stopped = false;
		const loop = async (): Promise<void> => {
			await read();
			if (stopped || failure !== null || companion?.status === 'complete') return;
			timer = setTimeout(() => void loop(), POLL_MS);
		};
		void companions
			.me()
			.then((me) => (features = me.features))
			.catch(() => undefined);
		void loop();
		return () => {
			stopped = true;
			if (timer !== null) clearTimeout(timer);
		};
	});

	const names = $derived(
		companion
			? Array.from({ length: companion.teams }, (_, i) =>
					i + 1 === companion?.slot ? 'You' : `Slot ${String(i + 1)}`
				)
			: []
	);
	const here = $derived(`/companion/${id}`);
</script>

<svelte:head>
	<title>Live draft · Commish</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<Shell title="Live draft" active="advisor">
	{#snippet tail()}
		<Quiet href={NEW_HREF}>Follow another draft</Quiet>
	{/snippet}
	{#if failure === 'signed-out'}
		<div class="pad">
			<EmptyState
				title="Sign in to follow your draft"
				line="A followed draft lives on your account."
			>
				{#snippet actions()}<Verb href={companions.signInUrl(here)}>Sign in</Verb>{/snippet}
			</EmptyState>
		</div>
	{:else if failure === 'missing'}
		<div class="pad">
			<EmptyState
				title="This draft is not on your account"
				line="Paste the draft link again to follow it."
			>
				{#snippet actions()}<Verb href={NEW_HREF}>Follow a draft</Verb>{/snippet}
			</EmptyState>
		</div>
	{:else if failure === 'unreachable'}
		<div class="pad">
			<EmptyState title="Your draft can't be read right now" line="Reload in a moment." />
		</div>
	{:else if companion && board}
		{#if retrying}
			<div class="pad">
				<Panel edge="quiet" padding="sm">
					<p class="note" role="status">Reconnecting. The picks below are the last ones we read.</p>
				</Panel>
			</div>
		{/if}
		{#if report}
			<Report
				{report}
				{names}
				field="your league drafting on Sleeper, read pick by pick as it happened"
			>
				{#snippet verbs()}
					<Verb href={NEW_HREF}>Follow another draft</Verb>
				{/snippet}
			</Report>
		{:else}
			<CompanionRoom {companion} {picks} {board} {features} search="" />
		{/if}
	{:else}
		<div class="reserve"></div>
	{/if}
</Shell>

<style>
	.pad {
		padding: var(--s-4) var(--s-5) 0;
	}

	.note {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.reserve {
		min-height: 70vh;
	}
</style>
