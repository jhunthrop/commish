<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { PUBLIC_API_URL } from '$app/env/public';
	import { ApiError, apiClient } from '#lib/api/client.ts';
	import { dayLabel } from '#lib/format/date.ts';
	import { lazySheet } from '#lib/site/lazy-sheet.svelte.ts';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Fact from '#lib/ui/Fact.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import HeroCard from '#lib/ui/HeroCard.svelte';
	import LineList from '#lib/ui/LineList.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import ThemeSwitch from '#lib/ui/ThemeSwitch.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { sectionHref } from '#lib/ui/nav.ts';
	import {
		accountApi,
		type AccountMock,
		type AccountSheet,
		type AccountState
	} from './account-api.ts';
	import {
		ARRIVAL_POLL_MS,
		ARRIVAL_TRIES,
		arrivalWords,
		boughtFrom,
		hasArrived,
		type Arrival
	} from './arrival.ts';
	import AccountLeagues from '#lib/league/AccountLeagues.svelte';
	import AccountConnections from '#lib/hosts/AccountConnections.svelte';
	import AccountDevices from '#lib/hosts/AccountDevices.svelte';
	import GroupPasses from './GroupPasses.svelte';
	import { accountLinks } from './links.ts';
	import { hasFeature } from './features.ts';
	import { boughtMembership, displayName, mockLine, planWords, sheetLine } from './words.ts';

	/** Your account: who you are, your sheets and mocks, your pass or membership with its one-click
	 * cancel, and sign out. Signed out, the sign-in verb and what an account keeps. The shell is
	 * prerendered and everything inside it is read from the API in the browser. */
	const api = accountApi(apiClient(PUBLIC_API_URL), () => navigator.onLine);

	/** What an account keeps, said to a reader who has none yet. */
	const KEEPS = [
		{
			lead: 'Your cheat sheets',
			text: 'on every device you sign in on, with your notes and tiers'
		},
		{ lead: 'Your mock drafts', text: 'and the report on each one' },
		{
			lead: 'Your leagues',
			text: 'on Sleeper or MyFantasyLeague, kept up to date',
			href: accountLinks.leagueNew()
		},
		{
			lead: 'Your Draft Pass or Membership',
			text: 'and the receipts for it',
			href: accountLinks.pass()
		}
	];

	let view = $state<AccountState | null>(null);
	/** The API's sentence for an action that failed, shown beside the action. */
	let problem = $state<string | null>(null);
	let busy = $state(false);
	/** Back from checkout: what was bought, and whether it shows on the account yet. */
	let arrival = $state<Arrival>({ kind: 'none' });

	async function load(): Promise<void> {
		try {
			view = await api.load();
		} catch {
			view = navigator.onLine ? { kind: 'unreachable' } : { kind: 'offline' };
		}
	}

	/** Reads the account until what checkout bought is on it, or says it is slow. */
	async function awaitArrival(): Promise<void> {
		if (arrival.kind === 'none') return;
		const { bought } = arrival;
		for (let tries = 0; tries < ARRIVAL_TRIES; tries++) {
			if (view && hasArrived(view, bought, Date.now())) {
				arrival = { kind: 'on', bought };
				return;
			}
			await new Promise((done) => setTimeout(done, ARRIVAL_POLL_MS));
			await load();
		}
		arrival = { kind: 'slow', bought };
	}

	onMount(() => {
		const bought = boughtFrom(page.url.searchParams);
		if (bought) {
			arrival = { kind: 'waiting', bought };
			void goto(resolve('/account'), { replace: true, shallow: true });
		}
		void load().then(awaitArrival);
		const again = (): void => void load();
		window.addEventListener('online', again);
		return () => window.removeEventListener('online', again);
	});

	async function act(step: () => Promise<void>): Promise<void> {
		busy = true;
		problem = null;
		try {
			await step();
		} catch (error) {
			problem = error instanceof ApiError ? error.message : 'That did not go through. Try again.';
		} finally {
			busy = false;
		}
	}

	function changeMembership(next: 'cancel' | 'resume'): Promise<void> {
		return act(async () => {
			const account =
				next === 'cancel' ? await api.cancelMembership() : await api.resumeMembership();
			if (view?.kind === 'signed-in') view = { ...view, account };
		});
	}

	const billing = (): Promise<void> =>
		act(async () => {
			window.location.assign(await api.billingPortal());
		});

	const signOut = (): Promise<void> =>
		act(async () => {
			window.location.assign(await api.signOut());
		});

	/** Opens the sheet on your account, then its page. */
	function openSheet(event: MouseEvent, sheet: AccountSheet): void {
		event.preventDefault();
		void lazySheet
			.load()
			.then((parts) => parts.store.open(sheet.id))
			.then(() => goto(accountLinks.sheet()));
	}

	function sheetLines(sheets: readonly AccountSheet[]) {
		return sheets.map((sheet) => ({
			key: sheet.id,
			lead: sheet.name,
			text: sheetLine(sheet),
			href: accountLinks.sheet(),
			onclick: (event: MouseEvent) => openSheet(event, sheet)
		}));
	}

	function mockLines(mocks: readonly AccountMock[]) {
		return mocks.map((mock) => ({
			key: mock.id,
			lead: mock.status === 'complete' ? 'Mock draft' : 'Mock in progress',
			text: mockLine(mock),
			href: accountLinks.mock(mock)
		}));
	}
</script>

<svelte:head>
	<title>Account · Commish</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<Shell title="Account">
	{#snippet tail()}
		{#if view?.kind === 'signed-in'}
			<Quiet href={sectionHref('mock')}>Start a mock draft</Quiet>
		{/if}
	{/snippet}
	<main class="account" aria-busy={view === null}>
		{#if view === null}
			<!-- The shell is drawn; the account arrives in a moment and takes this place. -->
			<div class="reserve"></div>
		{:else if view.kind === 'signed-out'}
			<HeroCard title="Sign in to keep your prep">
				{#snippet meta()}<span>One account for the site, on any device.</span>{/snippet}
				{#snippet aside()}
					<Verb href={api.signInUrl(accountLinks.account())} size="lg" fill>Sign in</Verb>
				{/snippet}
			</HeroCard>
			<section aria-label="What an account keeps">
				<PanelHead title="What your account keeps" level={2} />
				<LineList label="What an account keeps" lines={KEEPS} />
			</section>
		{:else if view.kind === 'offline'}
			<EmptyState title="You're offline" line="Your account loads as soon as you're back online." />
		{:else if view.kind === 'unreachable'}
			<EmptyState
				title="Your account can't be reached right now"
				line="Your sheet is still saved in this browser."
			>
				{#snippet actions()}<Quiet onclick={() => void load()}>Try again</Quiet>{/snippet}
			</EmptyState>
		{:else}
			{@const { account, sheets, mocks, groupPasses } = view}
			{@const plan = planWords(account)}
			{@const arrived = arrivalWords(arrival)}
			{#if arrived}
				<Panel edge={arrival.kind === 'slow' ? 'loss' : 'accent'} padding="sm">
					<p class="arrival" role="status">{arrived}</p>
				</Panel>
			{/if}
			<HeroCard title={displayName(account)}>
				{#snippet meta()}
					<span>{account.email} · with us since {dayLabel(account.created_at)}</span>
				{/snippet}
			</HeroCard>

			<div class="grid">
				<div class="lists">
					<section aria-label="Your sheets">
						<PanelHead title="Your sheets" aside={String(sheets.length)} level={2} />
						{#if sheets.length > 0}
							<LineList label="Your sheets" lines={sheetLines(sheets)} />
						{:else}
							<EmptyState level={3} title="No sheets yet">
								{#snippet actions()}
									<Quiet href={accountLinks.sheet()}>Start a cheat sheet</Quiet>
								{/snippet}
							</EmptyState>
						{/if}
					</section>

					<section aria-label="Your mock drafts">
						<PanelHead title="Your mock drafts" aside={String(mocks.length)} level={2} />
						{#if mocks.length > 0}
							<LineList label="Your mock drafts" lines={mockLines(mocks)} />
						{:else}
							<EmptyState level={3} title="No mock drafts yet" />
						{/if}
					</section>

					<AccountLeagues features={account.features} />
					<AccountConnections />
					<AccountDevices />

					{#if groupPasses.length > 0}
						<GroupPasses
							passes={groupPasses}
							features={account.features}
							onclaimed={() => void load()}
						/>
					{/if}
				</div>

				<aside class="side" aria-label="Your plan">
					<Fact label="Your plan">
						{#snippet value()}<PanelHead title={plan.title} />{/snippet}
						{plan.line}
					</Fact>
					<div class="actions">
						{#if plan.action === 'cancel'}
							<Quiet disabled={busy} onclick={() => void changeMembership('cancel')}>
								Cancel my membership
							</Quiet>
						{:else if plan.action === 'resume'}
							<Quiet disabled={busy} onclick={() => void changeMembership('resume')}>
								Keep my membership
							</Quiet>
						{/if}
						{#if hasFeature(account.features, 'live_draft_advisor')}
							<Quiet href={accountLinks.companion()}>Open the live draft companion</Quiet>
						{:else}
							<Quiet href={accountLinks.pass()}>See the Draft Pass</Quiet>
						{/if}
						<!-- Receipts are a purchase question, not a feature one: a claimer's pass has none. -->
						{#if boughtMembership(account) || account.draft_pass?.source === 'purchase' || groupPasses.length > 0}
							<Quiet disabled={busy} onclick={() => void billing()}>Billing and receipts</Quiet>
						{/if}
						<Quiet disabled={busy} onclick={() => void signOut()}>Sign out</Quiet>
					</div>
					{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
				</aside>
			</div>
		{/if}
		<!-- The theme switch lives here at every width, signed in or out, and on no page bar. -->
		<section class="theme" aria-label="Theme">
			<PanelHead title="Theme" level={2} />
			<ThemeSwitch />
		</section>
	</main>
</Shell>

<style>
	.account {
		display: flex;
		flex-direction: column;
		gap: var(--s-5);
		padding: var(--s-5);
	}

	.reserve {
		min-height: 60vh;
	}

	.theme {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--s-3);
	}

	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) var(--side-w);
		gap: var(--s-5);
		align-items: start;
	}

	.lists,
	.side {
		display: flex;
		flex-direction: column;
		gap: var(--s-5);
	}

	.side {
		gap: var(--s-3);
	}

	.actions {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}

	.arrival {
		margin: 0;
		font-size: var(--t-md);
	}

	.problem {
		margin: 0;
		color: var(--loss-ink);
		font-size: var(--t-sm);
	}

	@media (max-width: 1180px) {
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (max-width: 760px) {
		.account {
			padding: var(--s-4);
			gap: var(--s-4);
		}
	}
</style>
