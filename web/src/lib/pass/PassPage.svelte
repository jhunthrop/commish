<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { hasEvery, hasFeature } from '#lib/account/features.ts';
	import { hostsApi, openHostsOf } from '#lib/hosts/api.ts';
	import { SWITCHED_SHUT, type OpenHosts } from '#lib/league/hosts.ts';
	import { links } from '#lib/site/links.ts';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import LineList from '#lib/ui/LineList.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import GroupPassForm from './GroupPassForm.svelte';
	import PlanPanel from './PlanPanel.svelte';
	import {
		CHECKOUT_CANCELED,
		CHECKOUT_KEY,
		intentFrom,
		noteResume,
		resumePath,
		takeResume
	} from './intent.ts';
	import {
		ApiError,
		currentAccount,
		pass,
		type Account,
		type CheckoutRequest,
		type Interval,
		type PlanCatalog
	} from './pass-api.ts';
	import { ALWAYS_FREE, addedFeatures, featureLines } from './words.ts';
	import { draftPassFacts, groupFacts, hostCells, membershipFacts } from './plan-facts.ts';
	import FactStrip from '#lib/ui/FactStrip.svelte';

	/** The pass page: the Draft Pass, the Membership and the Group Draft Pass with what each unlocks,
	 * read from the API (the prices from Stripe, the features from the table Can reads), which
	 * platforms a live draft is read from and a league is followed from, and what is free whatever you
	 * have. Signed out, a verb signs
	 * in first and comes back here to go on to checkout. */

	let catalog = $state<PlanCatalog | null>(null);
	let account = $state<Account | null>(null);
	let unreachable = $state(false);
	let interval = $state<Interval>('year');
	let seats = $state(12);
	let league = $state('');
	let busy = $state(false);
	let problem = $state<string | null>(null);
	/** The switched platforms open here, as /account and /league/new read them: shut until read, so a
	 * platform switched off is never promised. */
	let openHosts = $state<OpenHosts>(SWITCHED_SHUT);
	/** Back from a checkout closed without paying. Read in the browser: the shell is prerendered. */
	let canceled = $state(false);

	/** Every verb answers from the features /me reports (Can), never from which product is held. */
	const features = $derived(account?.features ?? []);
	const passOn = $derived(catalog !== null && hasEvery(features, catalog.features.draft_pass));
	const memberOn = $derived(catalog !== null && hasEvery(features, catalog.features.membership));
	const companionOn = $derived(hasFeature(features, 'live_draft_advisor'));
	const membershipPrice = $derived(
		catalog?.membership.find((p) => p.interval === interval) ?? null
	);
	const group = $derived(catalog?.group_pass ?? null);

	async function begin(request: CheckoutRequest): Promise<void> {
		if (busy) return;
		if (account === null) {
			noteResume(request);
			window.location.assign(pass.signInUrl(resumePath(request)));
			return;
		}
		busy = true;
		problem = null;
		try {
			window.location.assign(await pass.checkout(request));
		} catch (error) {
			const fields = error instanceof ApiError ? Object.values(error.fields) : [];
			problem =
				fields[0] ??
				(error instanceof ApiError ? error.message : 'That did not go through. Try again.');
			busy = false;
		}
	}

	onMount(() => {
		canceled = page.url.searchParams.get(CHECKOUT_KEY) === CHECKOUT_CANCELED;
		const intent = intentFrom(page.url.searchParams);
		const resume = intent !== null && takeResume(intent);
		if (intent || canceled) void goto(resolve('/pass'), { replace: true, shallow: true });
		if (intent?.product === 'membership') interval = intent.interval ?? 'year';
		if (intent?.product === 'group_pass') {
			seats = intent.seats ?? seats;
			league = intent.league_name ?? '';
		}
		void Promise.all([pass.plans(), currentAccount()])
			.then(([plans, me]) => {
				catalog = plans;
				account = me;
				if (group) seats = Math.min(Math.max(seats, group.min_seats), group.max_seats);
				if (intent && resume && me && plans.checkout_open) void begin(intent);
			})
			.catch(() => (unreachable = true));
		void hostsApi
			.connections()
			.then((hosts) => (openHosts = openHostsOf(hosts)))
			.catch(() => (openHosts = SWITCHED_SHUT));
	});
</script>

<svelte:head>
	<title>Passes and Membership · Commish</title>
	<meta
		name="description"
		content="Our call beside your real Sleeper draft, at every one of your picks, for one season."
	/>
</svelte:head>

<Shell title="Passes and Membership" active="account">
	<main class="pass" aria-busy={catalog === null && !unreachable}>
		<PageHead title="Passes and Membership" />
		{#if catalog && !catalog.checkout_open}
			<Panel edge="quiet" padding="sm">
				<p class="note">
					Checkout is not open yet. The figures below are set for the {catalog.season} season.
				</p>
			</Panel>
		{/if}
		{#if canceled}
			<Panel edge="quiet" padding="sm">
				<p class="note">Checkout closed before paying. Nothing was charged.</p>
			</Panel>
		{/if}
		{#if unreachable}
			<Panel edge="loss" padding="sm">
				<p class="note">The pass can't be reached right now. Reload in a moment.</p>
			</Panel>
		{/if}
		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

		{#if catalog}
			<div class="plans">
				<PlanPanel
					title="Draft Pass"
					facts={draftPassFacts(catalog)}
					features={featureLines(catalog.features.draft_pass)}
					featured
				>
					{#snippet more()}
						<section aria-label="Where it works">
							<PanelHead title="Where it works" />
							<FactStrip
								label="Where the live draft and your league work"
								cells={hostCells(openHosts)}
								dense
							/>
						</section>
					{/snippet}
					{#snippet action()}
						{#if passOn}
							<p class="have">Everything in it is on your account.</p>
							{#if companionOn}
								<Verb href={links.companionNew()} fill>Open the live draft companion</Verb>
							{/if}
						{:else}
							<Verb
								fill
								disabled={busy || !catalog?.checkout_open || !catalog.draft_pass}
								onclick={() => void begin({ product: 'draft_pass' })}>Get the Draft Pass</Verb
							>
						{/if}
					{/snippet}
				</PlanPanel>

				<PlanPanel
					title="Membership"
					facts={membershipFacts(membershipPrice)}
					lead={{ lead: 'Everything in the Draft Pass', text: 'every season you stay a member' }}
					features={featureLines(
						addedFeatures(catalog.features.draft_pass, catalog.features.membership)
					)}
				>
					{#snippet choose()}
						{#if catalog && catalog.membership.length > 1}
							<ChipGroup label="Billed">
								{#each catalog.membership as price (price.lookup_key)}
									<Chip
										pressed={interval === price.interval}
										onclick={() => (interval = price.interval ?? 'year')}
										>{price.interval === 'month' ? 'Monthly' : 'Yearly'}</Chip
									>
								{/each}
							</ChipGroup>
						{/if}
					{/snippet}
					{#snippet action()}
						{#if memberOn}
							<p class="have">Everything in it is on your account.</p>
							<Quiet href={links.account()} fill>Your account</Quiet>
						{:else}
							<Quiet
								fill
								disabled={busy || !catalog?.checkout_open || !membershipPrice}
								onclick={() => void begin({ product: 'membership', interval })}
								>Become a member</Quiet
							>
						{/if}
					{/snippet}
				</PlanPanel>

				<PlanPanel
					title="Group Draft Pass"
					facts={groupFacts(group, seats)}
					features={featureLines(catalog.features.draft_pass)}
				>
					{#snippet choose()}
						{#if group}
							<GroupPassForm
								{seats}
								min={group.min_seats}
								max={group.max_seats}
								{league}
								onseats={(n: number) => (seats = n)}
								onleague={(name: string) => (league = name)}
								onenter={() =>
									void begin({ product: 'group_pass', seats, league_name: league.trim() })}
							/>
						{/if}
					{/snippet}
					{#snippet action()}
						<Quiet
							fill
							disabled={busy || !catalog?.checkout_open || !group || league.trim() === ''}
							onclick={() =>
								void begin({ product: 'group_pass', seats, league_name: league.trim() })}
							>Get {seats} passes for my league</Quiet
						>
					{/snippet}
				</PlanPanel>
			</div>

			<section class="free" aria-label="Free, whatever you have">
				<PanelHead title="Free, whatever you have" level={2} />
				<LineList label="Free, whatever you have" lines={ALWAYS_FREE} />
			</section>
		{:else if !unreachable}
			<div class="reserve"></div>
		{/if}
	</main>
</Shell>

<style>
	.pass {
		display: flex;
		flex-direction: column;
		gap: var(--s-5);
		padding: var(--s-5);
		max-width: 1280px;
	}

	.plans {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--s-4);
		align-items: stretch;
	}

	.free {
		max-width: 760px;
	}

	.note,
	.have {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.problem {
		margin: 0;
		color: var(--loss-ink);
		font-size: var(--t-sm);
	}

	.reserve {
		min-height: 70vh;
	}

	@media (max-width: 1180px) {
		.plans {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (max-width: 760px) {
		.pass {
			padding: var(--s-4);
			gap: var(--s-4);
		}
	}
</style>
