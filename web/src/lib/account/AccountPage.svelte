<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import { forgetContext } from '#lib/context/forget.ts';
	import { THEN_PARAM, safeThen } from '#lib/context/then-path.ts';
	import { page } from '$app/state';
	import { PUBLIC_API_URL } from '$app/env/public';
	import { ApiError, apiClient } from '#lib/api/client.ts';
	import { dayLabel } from '#lib/format/date.ts';
	import { zoneName } from '#lib/format/clock.ts';
	import { lazySheet } from '#lib/site/lazy-sheet.svelte.ts';
	import ActionRow from '#lib/ui/ActionRow.svelte';
	import ActionRows from '#lib/ui/ActionRows.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import HeroCard from '#lib/ui/HeroCard.svelte';
	import LineList from '#lib/ui/LineList.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import ThemeSwitch from '#lib/ui/ThemeSwitch.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { sectionHref } from '#lib/ui/nav.ts';
	import { DRAFT_TOOLS, NEXT_DRAFT, NEXT_DRAFT_ROWS } from '#lib/league/phase-words.ts';
	import { railInSeason } from '#lib/ui/nav.ts';
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
	import { AttachedList } from '#lib/league/attached-list.svelte.ts';
	import AccountConnections from '#lib/hosts/AccountConnections.svelte';
	import AccountDevices from '#lib/hosts/AccountDevices.svelte';
	import GroupPasses from './GroupPasses.svelte';
	import { hostsApi, openHostsOf } from '#lib/hosts/api.ts';
	import { SWITCHED_SHUT, type OpenHosts } from '#lib/league/hosts.ts';
	import { CONNECT, keeps, memberHosts, signedOutTitle } from './keeps.ts';
	import { accountLinks } from './links.ts';
	import { hasFeature } from './features.ts';
	import {
		boughtMembership,
		displayName,
		draftToolsRecede,
		mockLine,
		planWords,
		sheetLine
	} from './words.ts';

	interface Props {
		/** The rail's week item, named at build in season (server/build-week.ts, Lane 143, B126). */
		weekLabel?: string | undefined;
	}

	let { weekLabel }: Props = $props();

	/** Your account: who you are, your sheets and mocks, your pass or membership with its one-click
	 * cancel, and sign out. Signed out, the sign-in verb and what an account keeps. The shell is
	 * prerendered and everything inside it is read from the API in the browser. */
	const api = accountApi(apiClient(PUBLIC_API_URL), () => navigator.onLine);

	let view = $state<AccountState | null>(null);
	/** The API's sentence for an action that failed, shown beside the action. */
	let problem = $state<string | null>(null);
	let busy = $state(false);
	/** Back from checkout: what was bought, and whether it shows on the account yet. */
	let arrival = $state<Arrival>({ kind: 'none' });
	/** The switched hosts open here (the hosts answer's enabled): shut until it is read, so a host
	 * switched off is never promised. */
	let openHosts = $state<OpenHosts>(SWITCHED_SHUT);

	/** Reads which switched hosts are open, for the signed-out page's lines. */
	async function readOpenHosts(): Promise<void> {
		try {
			const hosts = await hostsApi.connections();
			openHosts = openHostsOf(hosts);
		} catch {
			openHosts = SWITCHED_SHUT;
		}
	}

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

	/** The account's attached leagues, read once for the Platforms and Leagues attached tables both
	 * (Lane 94 fix round 2), in the browser alone: the shell is prerendered. */
	const attached = new AttachedList();

	onMount(() => {
		// Back from signing in on a content page: the store reads the account and keeps the league
		// line's hint, then the reader goes on to the page they left, which paints with its room.
		const then = safeThen(page.url.searchParams.get(THEN_PARAM), page.url.origin);
		if (then !== null) {
			void siteContext.load().then(() => window.location.replace(then));
			return;
		}
		const bought = boughtFrom(page.url.searchParams);
		if (bought) {
			arrival = { kind: 'waiting', bought };
			void goto(resolve('/account'), { replace: true, shallow: true });
		}
		void load().then(() => {
			if (view?.kind === 'signed-out') void readOpenHosts();
			if (view?.kind === 'signed-in') void attached.load();
			return awaitArrival();
		});
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
			const url = await api.signOut();
			// Nothing of this account's leagues stays in the browser for whoever comes next.
			forgetContext();
			window.location.assign(url);
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

<!-- No bar parts, so the phone bar is its one row (Lane 87). The page's way to a mock is its Next
     draft row; the bottom bar carries Mock draft only on a rail without a league's screens. -->
<Shell title="Account" {weekLabel}>
	<main class="account" aria-busy={view === null}>
		{#if view === null}
			<!-- The shell is drawn; the account arrives in a moment and takes this place. -->
			<div class="reserve"></div>
		{:else if view.kind === 'signed-out'}
			<HeroCard title={signedOutTitle(railInSeason(siteContext.rail))}>
				{#snippet meta()}<span>One account for the site, on any device.</span>{/snippet}
				{#snippet aside()}
					<Verb href={api.signInUrl(accountLinks.account())} size="lg" fill>Sign in</Verb>
				{/snippet}
			</HeroCard>
			<section aria-label="What an account keeps">
				<PanelHead title="What your account keeps" level={2} />
				<LineList
					label="What an account keeps"
					lines={keeps(openHosts, railInSeason(siteContext.rail)).map(({ link, ...line }) => ({
						...line,
						href: link ? accountLinks[link]() : undefined
					}))}
				/>
			</section>
			{#if memberHosts(openHosts).length > 0}
				<section aria-label={CONNECT.label}>
					<PanelHead title={CONNECT.head} level={2} />
					<ActionRows label={CONNECT.label}>
						{#each memberHosts(openHosts) as host (host.lead)}
							<ActionRow lead={host.lead} text={host.text}>
								{#snippet action()}
									<Quiet size="sm" href={api.signInUrl(accountLinks.account())}>{host.verb}</Quiet>
								{/snippet}
							</ActionRow>
						{/each}
					</ActionRows>
				</section>
			{/if}
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
			<div class="who">
				<div class="title">
					<h2>{displayName(account)}</h2>
					<p class="lede">{account.email}, with us since {dayLabel(account.created_at)}</p>
				</div>
				<Quiet disabled={busy} onclick={() => void signOut()}>Sign out</Quiet>
			</div>

			<div class="grid">
				<div class="lists">
					<AccountConnections list={attached} />
					<AccountLeagues features={account.features} list={attached} />
					{#if groupPasses.length > 0}
						<GroupPasses
							passes={groupPasses}
							features={account.features}
							onclaimed={() => void load()}
						/>
					{/if}
				</div>

				<aside class="side" aria-label="Your plan and display">
					<section aria-label="Plan">
						<div class="sec-h"><h2>Plan</h2></div>
						<div class="kv">
							<div class="kvr">
								<span class="st"><b class="plan">{plan.title}</b><span>{plan.line}</span></span>
							</div>
							{#if plan.action === 'cancel'}
								<div class="kvr">
									<span class="st"
										><b>Cancel</b><span>It runs to its date and does not renew</span></span
									>
									<Quiet size="sm" disabled={busy} onclick={() => void changeMembership('cancel')}
										>Cancel my membership</Quiet
									>
								</div>
							{:else if plan.action === 'resume'}
								<div class="kvr">
									<span class="st"><b>Renew</b><span>Keep it past its date</span></span>
									<Quiet size="sm" disabled={busy} onclick={() => void changeMembership('resume')}
										>Keep my membership</Quiet
									>
								</div>
							{/if}
							<!-- Receipts are a purchase question, not a feature one: a claimer's pass has none. -->
							{#if boughtMembership(account) || account.draft_pass?.source === 'purchase' || groupPasses.length > 0}
								<div class="kvr">
									<span class="st"
										><b>Billing and receipts</b><span>Your card and every receipt</span></span
									>
									<Quiet size="sm" disabled={busy} onclick={() => void billing()}>Open</Quiet>
								</div>
							{/if}
							<div class="kvr">
								{#if hasFeature(account.features, 'live_draft_advisor')}
									<span class="st"
										><b>Live draft companion</b><span>On your phone while you draft</span></span
									>
									<Quiet size="sm" href={accountLinks.companion()}>Open</Quiet>
								{:else}
									<span class="st"
										><b>Draft Pass</b><span>Every league and the live draft companion</span></span
									>
									<Quiet size="sm" href={accountLinks.pass()}>See the Draft Pass</Quiet>
								{/if}
							</div>
						</div>
						{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
					</section>

					<section aria-label="Display">
						<div class="sec-h"><h2>Display</h2></div>
						<div class="kv">
							<div class="kvr">
								<span class="st"><b>Theme</b><span>On this device</span></span>
								<ThemeSwitch />
							</div>
							<div class="kvr">
								<span class="st"
									><b>Time zone</b><span
										>{zoneName()}, from this device. Every time on the site follows it.</span
									></span
								>
							</div>
						</div>
					</section>

					{#if draftToolsRecede(account.season)}
						<section aria-label={DRAFT_TOOLS.label}>
							<p class="tools">
								<b>{DRAFT_TOOLS.lead}</b>
								<a href={sectionHref('mock')}>{DRAFT_TOOLS.mock}</a>{DRAFT_TOOLS.joint}<a
									href={accountLinks.sheet()}>{DRAFT_TOOLS.sheet}</a
								>
							</p>
						</section>
					{:else}
						<section aria-label={NEXT_DRAFT}>
							<div class="sec-h"><h2>{NEXT_DRAFT}</h2></div>
							{#if sheets.length > 0}
								<LineList label="Your sheets" lines={sheetLines(sheets)} />
							{/if}
							{#if mocks.length > 0}
								<LineList label="Your mock drafts" lines={mockLines(mocks)} />
							{/if}
							<div class="kv">
								{#each NEXT_DRAFT_ROWS as row, i (row.lead)}
									<div class="kvr">
										<span class="st"><b>{row.lead}</b><span>{row.text}</span></span>
										<Quiet size="sm" href={i === 0 ? sectionHref('mock') : accountLinks.sheet()}
											>{row.verb}</Quiet
										>
									</div>
								{/each}
							</div>
						</section>
					{/if}

					<AccountDevices />
				</aside>
			</div>
		{/if}
		<!-- The theme switch lives here at every width and on no page bar: signed in, under Display. -->
		{#if view?.kind !== 'signed-in'}
			<section class="theme" aria-label="Theme">
				<PanelHead title="Theme" level={2} />
				<ThemeSwitch />
			</section>
		{/if}
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
		grid-template-columns: minmax(0, 1fr) 380px;
		gap: var(--s-5);
		align-items: start;
	}

	.lists,
	.side {
		display: flex;
		flex-direction: column;
		gap: var(--s-5);
		min-width: 0;
	}

	.who {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--s-4);
	}

	.title h2 {
		margin: 0;
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-display);
		line-height: 1;
		text-transform: uppercase;
		letter-spacing: 0.01em;
	}

	.lede {
		margin: 6px 0 0;
		font-size: var(--t-sm);
		color: var(--ink-3);
	}

	/* The room's settings tables (Lane 66k), one look for every section the page draws: the section
	 * head, a table of rows each with its state in two lines and its one verb at the right, and a
	 * key and value list for the side's short sections. */
	.account :global(.sec-h) {
		display: flex;
		align-items: baseline;
		gap: var(--s-3);
		margin: 0 0 var(--s-2);
	}

	.account :global(.sec-h h2) {
		margin: 0;
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-xl);
		line-height: 1;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		white-space: nowrap;
	}

	.account :global(.sec-h span) {
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.account :global(table.set) {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		table-layout: fixed;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		overflow: hidden;
	}

	.account :global(.set th),
	.account :global(.set td) {
		padding: var(--s-2);
		border-bottom: 1px solid var(--line);
		vertical-align: middle;
		text-align: left;
		font-size: var(--t-sm);
	}

	.account :global(.set tbody tr:last-child > *) {
		border-bottom: 0;
	}

	.account :global(.set thead th) {
		height: 32px;
		padding-block: 0;
		font-size: var(--t-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
		background: var(--bg);
		white-space: nowrap;
	}

	.account :global(.set tbody tr) {
		height: 64px;
	}

	.account :global(.set .act) {
		text-align: right;
	}

	.account :global(.set .read),
	.account :global(.set .none) {
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}

	.account :global(.st) {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.account :global(.st > b) {
		font-weight: 600;
	}

	.account :global(.st > b.num),
	.account :global(.st > b.plan) {
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-lg);
		font-variant-numeric: tabular-nums;
	}

	.account :global(.st > b.plan) {
		font-size: var(--t-xl);
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}

	.account :global(.st > span) {
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.account :global(.sr) {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	.account :global(.kv) {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--surface);
		overflow: hidden;
	}

	.account :global(.kvr) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s-3);
		min-height: 60px;
		padding: var(--s-2) var(--s-3);
		border-bottom: 1px solid var(--line);
	}

	.account :global(.kvr:last-child) {
		border-bottom: 0;
	}

	.account :global(.ph-only) {
		display: none;
	}

	.account :global(.kvr .st) {
		flex: 1;
	}

	/* The draft tools in season: one line, each tool's words its link. */
	.tools {
		margin: 0;
		padding: var(--s-3);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--surface);
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.tools b {
		font-weight: 600;
		color: var(--ink);
	}

	.tools a {
		color: var(--ink);
		text-decoration: underline;
		text-underline-offset: 3px;
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

	/* The side folds under the lists below 1440, not at the site's 1180: the Platforms table needs a
	 * 744 px column for its Connection column to keep 200 px beside whole names, verbs and one-line
	 * last reads (Lane 105 fix round 1), and the Leagues attached table's League column, beside its
	 * four set columns, held a long league name on five lines at 1280 (Lane 117, B84). At 1280 the page
	 * is the 1200 layout. */
	@media (max-width: 1439px) {
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	/* Below a desk's width each table row is a card: its name and verb on one line, its states under. */
	@media (max-width: 900px) {
		.account {
			padding: var(--s-4);
			gap: var(--s-4);
		}

		.who {
			flex-direction: column;
			align-items: flex-start;
		}

		.account :global(.set),
		.account :global(.set tbody),
		.account :global(.set tr),
		.account :global(.set th),
		.account :global(.set td) {
			display: block;
			width: 100%;
		}

		.account :global(.set colgroup),
		.account :global(.set thead),
		.account :global(.set .ph-hide) {
			display: none;
		}

		.account :global(.set tbody tr) {
			height: auto;
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 6px var(--s-3);
			padding: var(--s-3);
			border-bottom: 1px solid var(--line);
		}

		.account :global(.set tbody tr:last-child) {
			border-bottom: 0;
		}

		.account :global(.set tbody th),
		.account :global(.set tbody td) {
			padding: 0;
			border: 0;
			width: auto;
		}

		.account :global(.set .act) {
			grid-column: 2;
			grid-row: 1;
		}

		.account :global(.set .wide) {
			grid-column: 1 / -1;
		}

		.account :global(.ph-only) {
			display: inline;
		}

		.account :global(.set .read) {
			grid-column: 1 / -1;
			font-size: var(--t-xs);
		}
	}
</style>
