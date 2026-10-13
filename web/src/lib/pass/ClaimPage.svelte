<script lang="ts">
	import { onMount } from 'svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Figure from '#lib/ui/Figure.svelte';
	import HeroCard from '#lib/ui/HeroCard.svelte';
	import LineList from '#lib/ui/LineList.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { claimStep, fromWords, stateFromError, type ClaimState } from './claim.ts';
	import { ApiError, currentAccount, pass, type Feature } from './pass-api.ts';
	import { PASS_PATH } from './intent.ts';
	import { featureLines, passEnds } from './words.ts';

	/** A group pass's claim link: whose league it is, how many passes are left, what a pass unlocks,
	 * and the one verb. Signed out, the verb signs in and comes back here. */
	interface Props {
		code: string;
	}

	let { code }: Props = $props();

	const COMPANION_HREF = '/companion/new';

	let view = $state<ClaimState>({ kind: 'loading' });
	let features = $state<Feature[]>([]);
	let endsAt = $state<string | null>(null);
	let busy = $state(false);
	let problem = $state<string | null>(null);

	async function load(): Promise<void> {
		try {
			const [preview, account] = await Promise.all([pass.preview(code), currentAccount()]);
			view = { kind: 'open', preview, account };
		} catch (error) {
			view = stateFromError(error);
		}
	}

	onMount(() => {
		void load();
		void pass
			.plans()
			.then((catalog) => {
				features = catalog.features.draft_pass;
				endsAt = passEnds(catalog);
			})
			.catch(() => undefined);
	});

	async function claim(): Promise<void> {
		if (busy || view.kind !== 'open') return;
		busy = true;
		problem = null;
		try {
			const account = await pass.claim(code);
			view = { kind: 'open', preview: await pass.preview(code), account };
		} catch (error) {
			problem = error instanceof ApiError ? error.message : 'That did not go through. Try again.';
		} finally {
			busy = false;
		}
	}

	const here = $derived(`/claim/${code}`);
</script>

<svelte:head>
	<title>Claim your Draft Pass · Commish</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<Shell title="Draft Pass" active="account">
	<main class="claim" aria-busy={view.kind === 'loading'}>
		{#if view.kind === 'loading'}
			<div class="reserve"></div>
		{:else if view.kind === 'missing'}
			<EmptyState
				title="This link does not open a pass"
				line="Check the link with whoever sent it. A pass that was refunded stops working."
			>
				{#snippet actions()}<Quiet href={PASS_PATH}>See the Draft Pass</Quiet>{/snippet}
			</EmptyState>
		{:else if view.kind === 'ended'}
			<EmptyState
				title="This pass was for a season that has ended"
				line="A pass runs for one season. This season's is on the pass page."
			>
				{#snippet actions()}<Quiet href={PASS_PATH}>See the Draft Pass</Quiet>{/snippet}
			</EmptyState>
		{:else if view.kind === 'unreachable'}
			<EmptyState title="This link can't be read right now" line="Reload in a moment.">
				{#snippet actions()}<Quiet onclick={() => void load()}>Try again</Quiet>{/snippet}
			</EmptyState>
		{:else}
			{@const { preview, account } = view}
			{@const step = claimStep(preview, account)}
			{@const left = preview.seats - preview.claimed}
			<HeroCard title={preview.league_name}>
				{#snippet meta()}<span>{fromWords(preview)}</span>{/snippet}
				{#snippet aside()}
					<Figure
						value="{left} of {preview.seats}"
						size="lg"
						caption="passes left on this link"
						align="end"
						phoneAlign="start"
					/>
				{/snippet}
			</HeroCard>

			<section class="step" aria-label="Your pass">
				{#if step === 'yours'}
					<p class="line">
						Your Draft Pass is on{endsAt ? `, good through ${endsAt}` : ''}.
					</p>
					<Verb href={COMPANION_HREF} size="lg">Open the live draft companion</Verb>
				{:else if step === 'covered'}
					<p class="line">
						You already have the {preview.season} Draft Pass, so leave this one for a teammate.
					</p>
					<Quiet href={COMPANION_HREF}>Open the live draft companion</Quiet>
				{:else if step === 'full'}
					<p class="line">
						Every pass on this link is taken. Ask {preview.purchaser_handle
							? `@${preview.purchaser_handle}`
							: 'whoever sent it'} about another, or get your own.
					</p>
					<Quiet href={PASS_PATH}>See the Draft Pass</Quiet>
				{:else if step === 'sign-in'}
					<p class="line">Sign in and the pass is yours, one per drafter.</p>
					<Verb href={pass.signInUrl(here)} size="lg">Sign in to claim your pass</Verb>
				{:else}
					<p class="line">One pass per drafter, yours for the {preview.season} season.</p>
					<Verb size="lg" disabled={busy} onclick={() => void claim()}>Claim my pass</Verb>
				{/if}
				{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
			</section>

			{#if features.length > 0}
				<section aria-label="What the pass unlocks">
					<PanelHead title="What the pass unlocks" level={2} />
					<LineList label="What the pass unlocks" lines={featureLines(features)} />
				</section>
			{/if}
		{/if}
	</main>
</Shell>

<style>
	.claim {
		display: flex;
		flex-direction: column;
		gap: var(--s-5);
		padding: var(--s-5);
		max-width: 900px;
	}

	.step {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--s-3);
	}

	.line {
		margin: 0;
		font-size: var(--t-lg);
		max-width: 52ch;
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
		.claim {
			padding: var(--s-4);
			gap: var(--s-4);
		}
	}
</style>
