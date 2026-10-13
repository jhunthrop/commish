<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ActionBar from '#lib/ui/ActionBar.svelte';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import DisplayTitle from '#lib/ui/DisplayTitle.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Stepper from '#lib/ui/Stepper.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { ApiError, companions, isSignedOut, type CompanionCreate } from './api.ts';
	import { has } from './model.ts';

	/** Start following a draft: paste the Sleeper link, say which seat is yours, one verb. Without the
	 * live draft feature (answered by Can through /me) the page says where it comes from. */

	/** Slots a Sleeper draft can have; the API checks the draft's own count. */
	const MAX_SLOT = 14;
	/** The recorded draft a development replay follows (COMPANION_REPLAY on the API). */
	const REPLAY_DRAFT = '1382163311050645504';

	type View = 'loading' | 'signed-out' | 'no-pass' | 'form' | 'unreachable';

	let view = $state<View>('loading');
	let link = $state('');
	let by = $state<'slot' | 'username'>('slot');
	let slot = $state(1);
	let username = $state('');
	let replay = $state(false);
	let busy = $state(false);
	let problem = $state<string | null>(null);

	onMount(() => {
		replay = page.url.searchParams.get('replay') === '1';
		if (replay) link = `https://sleeper.com/draft/nfl/${REPLAY_DRAFT}`;
		companions
			.me()
			.then((me) => (view = has(me.features, 'live_draft_advisor') ? 'form' : 'no-pass'))
			.catch((error: unknown) => (view = isSignedOut(error) ? 'signed-out' : 'unreachable'));
	});

	const ready = $derived(link.trim() !== '' && (by === 'slot' || username.trim() !== '') && !busy);

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
				title="Sign in to follow your draft"
				line="Our call beside your Sleeper draft comes with the Draft Pass."
			>
				{#snippet actions()}
					<Verb href={companions.signInUrl('/companion/new')}>Sign in</Verb>
				{/snippet}
			</EmptyState>
		{:else if view === 'no-pass'}
			<EmptyState
				title="Our call beside your real draft comes with the Draft Pass"
				line="Paste your Sleeper draft link and get our pick at each of your turns, against the picks your league makes."
			>
				{#snippet actions()}<Verb href={resolve('/pass')}>See the Draft Pass</Verb>{/snippet}
			</EmptyState>
		{:else if view === 'unreachable'}
			<EmptyState title="This page can't reach Commish right now" line="Reload in a moment." />
		{:else}
			<DisplayTitle size="page">Follow your draft</DisplayTitle>
			<p class="lede">
				Paste the link to your Sleeper draft. At each of your picks you get our call, against the
				picks your league actually makes.
			</p>
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
						<Stepper
							label="Slot"
							value={slot}
							min={1}
							max={MAX_SLOT}
							onchange={(n: number) => (slot = n)}
						/>
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
