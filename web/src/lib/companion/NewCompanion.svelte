<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { links } from '#lib/site/links.ts';
	import ActionBar from '#lib/ui/ActionBar.svelte';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import DisplayTitle from '#lib/ui/DisplayTitle.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import LineList from '#lib/ui/LineList.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { isSignedOut } from '#lib/api/status.ts';
	import { MAX_TEAMS } from '#lib/room/setup/setup.ts';
	import { ApiError, companions, type CompanionCreate, type CompanionSummary } from './api.ts';
	import { has, recentLine } from './model.ts';
	import FFPCLeagues from '#lib/hosts/FFPCLeagues.svelte';
	import { ffpcOpen, hostsApi, type HostLeague } from '#lib/hosts/api.ts';

	/** Start following a draft: paste the Sleeper link, say which seat is yours, one verb. Without the
	 * live draft feature (answered by Can through /me) the page says where it comes from. */

	/** The words in the link field for a development replay (COMPANION_REPLAY on the API), which
	 * always follows the recorded draft. */
	const REPLAY_WORDS = 'The recorded draft (development replay)';

	type View = 'loading' | 'signed-out' | 'no-pass' | 'form' | 'unreachable';

	let view = $state<View>('loading');
	/** Where the draft runs: Sleeper by its link, or FFPC read as you. */
	let way = $state<'sleeper' | 'ffpc'>('sleeper');
	/** FFPC is offered only where it is open (HOST_FFPC_ENABLED). */
	let ffpcOn = $state(false);
	let link = $state('');
	let by = $state<'slot' | 'username'>('slot');
	let slot = $state(1);
	let username = $state('');
	let replay = $state(false);
	let busy = $state(false);
	let problem = $state<string | null>(null);
	let recent = $state<CompanionSummary[]>([]);
	let recentFailed = $state(false);
	/** Every slot a league can have, one tap each (the setup page's slot chips). */
	const SLOTS = Array.from({ length: MAX_TEAMS }, (_, i) => i + 1);

	onMount(() => {
		replay = page.url.searchParams.get('replay') === '1';
		hostsApi
			.connections()
			.then((hosts) => (ffpcOn = ffpcOpen(hosts)))
			.catch(() => (ffpcOn = false));
		if (replay) link = REPLAY_WORDS;
		companions
			.me()
			.then(async (me) => {
				if (!has(me.features, 'live_draft_advisor')) {
					view = 'no-pass';
					return;
				}
				try {
					recent = await companions.recent();
				} catch {
					// The list is a convenience: the form works without it, and the page says it is missing.
					recentFailed = true;
				}
				// The username used last comes first: one tap instead of choosing a slot.
				const used = recent.find((r) => r.host_username !== null)?.host_username;
				if (used) {
					by = 'username';
					username = used;
				}
				view = 'form';
			})
			.catch((error: unknown) => (view = isSignedOut(error) ? 'signed-out' : 'unreachable'));
	});

	const ready = $derived(link.trim() !== '' && (by === 'slot' || username.trim() !== '') && !busy);

	async function followFFPC(league: HostLeague): Promise<void> {
		const made = await companions.create({ host: 'ffpc', draft: league.league_id, seat: {} });
		await goto(resolve('/companion/[id]', { id: made.id }));
	}

	async function follow(): Promise<void> {
		if (!ready) return;
		busy = true;
		problem = null;
		const body: CompanionCreate = {
			host: 'sleeper',
			draft: link.trim(),
			seat: by === 'slot' ? { slot } : { username: username.trim() },
			...(replay ? { replay: true } : {})
		};
		try {
			const made = await companions.create(body);
			await goto(resolve('/companion/[id]', { id: made.id }));
		} catch (error) {
			const fields = error instanceof ApiError ? Object.values(error.fields) : [];
			problem =
				fields[0] ??
				(error instanceof ApiError ? error.message : 'That did not go through. Try again.');
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Follow your draft · Commish</title>
</svelte:head>

<Shell title="Live draft" active="advisor">
	<main class="new">
		{#if view === 'loading'}
			<div class="reserve"></div>
		{:else if view === 'signed-out'}
			<EmptyState
				title="Our call beside your real draft comes with the Draft Pass"
				line="Paste your Sleeper draft link and get our pick at each of your turns, against the picks your league makes."
			>
				{#snippet actions()}
					<Verb href={links.pass()}>See the Draft Pass</Verb>
					<Quiet href={companions.signInUrl(links.companionNew())}>I have a pass, sign in</Quiet>
				{/snippet}
			</EmptyState>
		{:else if view === 'no-pass'}
			<EmptyState
				title="Our call beside your real draft comes with the Draft Pass"
				line="Paste your Sleeper draft link and get our pick at each of your turns, against the picks your league makes."
			>
				{#snippet actions()}<Verb href={links.pass()}>See the Draft Pass</Verb>{/snippet}
			</EmptyState>
		{:else if view === 'unreachable'}
			<EmptyState title="This page can't reach Commish right now" line="Reload in a moment." />
		{:else}
			<DisplayTitle size="page">Follow your draft</DisplayTitle>
			<p class="lede">
				At each of your picks you get our call, against the picks your league actually makes.
			</p>
			{#if ffpcOn}
				<ChipGroup label="Your draft is on">
					<Chip pressed={way === 'sleeper'} onclick={() => (way = 'sleeper')}>Sleeper</Chip>
					<Chip pressed={way === 'ffpc'} onclick={() => (way = 'ffpc')}>FFPC</Chip>
				</ChipGroup>
			{/if}
			{#if ffpcOn && way === 'ffpc'}
				<FFPCLeagues verb="Follow my draft" onpick={followFFPC} typed />
			{:else}
				<div class="form">
					<Field
						label="Your Sleeper draft link"
						bind:value={link}
						placeholder="sleeper.com/draft/nfl/1234567890"
						maxlength={300}
						onenter={() => void follow()}
					/>
					<div class="seat">
						<ChipGroup label="Find your seat by">
							<Chip pressed={by === 'slot'} onclick={() => (by = 'slot')}>My draft slot</Chip>
							<Chip pressed={by === 'username'} onclick={() => (by = 'username')}
								>My Sleeper username</Chip
							>
						</ChipGroup>
						{#if by === 'slot'}
							<ChipGroup label="Your draft slot" variant="loose">
								{#each SLOTS as n (n)}
									<Chip size="sm" pressed={slot === n} onclick={() => (slot = n)}>{n}</Chip>
								{/each}
							</ChipGroup>
						{:else}
							<Field
								label="Sleeper username"
								bind:value={username}
								maxlength={40}
								onenter={() => void follow()}
							/>
						{/if}
					</div>
				</div>
				<ActionBar alert={problem ? alert : undefined}>
					<Verb disabled={!ready} onclick={() => void follow()}>Follow my draft</Verb>
				</ActionBar>
			{/if}
			{#if recentFailed}
				<p class="lede">The drafts you followed can't be read right now.</p>
			{:else if recent.length > 0}
				<section aria-label="Drafts you followed">
					<PanelHead title="Drafts you followed" level={2} />
					<LineList label="Drafts you followed" lines={recent.map(recentLine)} />
				</section>
			{/if}
		{/if}
	</main>
</Shell>

{#snippet alert()}
	<p class="problem" role="alert">{problem}</p>
{/snippet}

<style>
	.new {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		padding: var(--s-5);
		max-width: 720px;
	}

	.lede {
		margin: 0;
		color: var(--ink-2);
		max-width: 60ch;
	}

	.form,
	.seat {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
	}

	.seat {
		gap: var(--s-3);
		align-items: flex-start;
	}

	.problem {
		margin: 0;
		color: var(--loss-ink);
		font-size: var(--t-sm);
	}

	.reserve {
		min-height: 60vh;
	}

	@media (max-width: 760px) {
		.new {
			padding: var(--s-4);
		}
	}
</style>
