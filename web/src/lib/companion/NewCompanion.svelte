<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { siteContext } from '#lib/context/context.svelte.ts';
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
	import Verb from '#lib/ui/Verb.svelte';
	import { isSignedOut } from '#lib/api/status.ts';
	import { MAX_TEAMS } from '#lib/room/setup/setup.ts';
	import { ApiError, companions, type CompanionCreate, type CompanionSummary } from './api.ts';
	import { recentLine } from './model.ts';
	import { SIGNED_OUT_WORDS } from './new-words.ts';
	import { COMPANION, COMPANION_NEW as WORDS } from './words.ts';
	import FFPCLeagues from '#lib/hosts/FFPCLeagues.svelte';
	import { ffpcOpen, hostsApi, type HostLeague } from '#lib/hosts/api.ts';

	/** Start following a draft: paste the Sleeper link, say which seat is yours, one verb. Signed out,
	 * what it does and the sign-in (Lane 150: free this season, nothing says what it comes with). */

	type View = 'loading' | 'signed-out' | 'form' | 'unreachable';

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

	/** Signed out the member-only reads are skipped (Lane 166, D19): the shell's session read names it,
	 * so no request answers 401. */
	async function start(): Promise<void> {
		await siteContext.load();
		if (!siteContext.signedIn) {
			view = 'signed-out';
			return;
		}
		hostsApi
			.connections()
			.then((hosts) => (ffpcOn = ffpcOpen(hosts)))
			.catch(() => (ffpcOn = false));
		companions
			.me()
			.then(async () => {
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
	}

	onMount(() => {
		replay = page.url.searchParams.get('replay') === '1';
		if (replay) link = WORDS.replay;
		void start();
	});

	const ready = $derived(link.trim() !== '' && (by === 'slot' || username.trim() !== '') && !busy);

	async function followFFPC(league: HostLeague): Promise<void> {
		const made = await companions.create({ host: 'ffpc', draft: league.league_id, seat: {} });
		await goto(resolve('/companion/[id]', { id: made.id }));
	}

	/** The FFPC list is a single choice here: its one league is the draft. */
	async function followFirstFFPC(leagues: HostLeague[]): Promise<null> {
		const [league] = leagues;
		if (league) await followFFPC(league);
		return null;
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
			problem = fields[0] ?? (error instanceof ApiError ? error.message : WORDS.failed);
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>{WORDS.title} · Commish</title>
</svelte:head>

<Shell title={COMPANION.title} active="advisor">
	<main class="new">
		{#if view === 'loading'}
			<div class="reserve"></div>
		{:else if view === 'signed-out'}
			<EmptyState title={SIGNED_OUT_WORDS.title} line={SIGNED_OUT_WORDS.line}>
				{#snippet actions()}
					<Verb href={companions.signInUrl(links.companionNew())}>{SIGNED_OUT_WORDS.verb}</Verb>
				{/snippet}
			</EmptyState>
		{:else if view === 'unreachable'}
			<EmptyState title={WORDS.unreachableTitle} line={WORDS.reloadLine} />
		{:else}
			<DisplayTitle size="page">{WORDS.title}</DisplayTitle>
			<p class="lede">{WORDS.lede}</p>
			{#if ffpcOn}
				<ChipGroup label={WORDS.draftOn} fit>
					<Chip pressed={way === 'sleeper'} onclick={() => (way = 'sleeper')}>Sleeper</Chip>
					<Chip pressed={way === 'ffpc'} onclick={() => (way = 'ffpc')}>FFPC</Chip>
				</ChipGroup>
			{/if}
			{#if ffpcOn && way === 'ffpc'}
				<FFPCLeagues verb={() => WORDS.verb} onpick={followFirstFFPC} typed />
			{:else}
				<div class="form">
					<Field
						label={WORDS.linkLabel}
						bind:value={link}
						placeholder={WORDS.linkPlaceholder}
						maxlength={300}
						onenter={() => void follow()}
					/>
					<div class="seat">
						<ChipGroup label={WORDS.seatBy}>
							<Chip pressed={by === 'slot'} onclick={() => (by = 'slot')}>{WORDS.bySlot}</Chip>
							<Chip pressed={by === 'username'} onclick={() => (by = 'username')}
								>{WORDS.byUsername}</Chip
							>
						</ChipGroup>
						{#if by === 'slot'}
							<ChipGroup label={WORDS.slotLabel} variant="loose">
								{#each SLOTS as n (n)}
									<Chip size="sm" pressed={slot === n} onclick={() => (slot = n)}>{n}</Chip>
								{/each}
							</ChipGroup>
						{:else}
							<Field
								label={WORDS.usernameLabel}
								bind:value={username}
								maxlength={40}
								onenter={() => void follow()}
							/>
						{/if}
					</div>
				</div>
				<ActionBar alert={problem ? alert : undefined}>
					<Verb disabled={!ready} onclick={() => void follow()}>{WORDS.verb}</Verb>
				</ActionBar>
			{/if}
			{#if recentFailed}
				<p class="lede">{WORDS.recentFailed}</p>
			{:else if recent.length > 0}
				<section aria-label={WORDS.recentTitle}>
					<PanelHead title={WORDS.recentTitle} level={2} />
					<LineList
						label={WORDS.recentTitle}
						lines={recent.map((r) => recentLine(r, links.companion(r.id)))}
					/>
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
