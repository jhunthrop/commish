<script lang="ts">
	import { ApiError } from '#lib/api/client.ts';
	import { pass as passApi } from '#lib/pass/pass-api.ts';
	import { COPIED_MS } from '#lib/room/actions.ts';
	import { Flash } from '#lib/room/flash.svelte.ts';
	import LineList from '#lib/ui/LineList.svelte';
	import LiveRegion from '#lib/ui/LiveRegion.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import type { AccountGroupPass } from './account-api.ts';
	import { hasFeature, type Feature } from './features.ts';
	import { groupPassLine, seatLines } from './words.ts';

	/** The group passes this account bought: each league's claim link to copy and share, every seat,
	 * claimed by whom and when, or still open, and the buyer's own seat one tap away. */
	interface Props {
		passes: readonly AccountGroupPass[];
		/** What the account may use, from /me: a buyer who already has the pass leaves the seat open. */
		features: readonly Feature[];
		/** After the buyer claims a seat, the account is read again. */
		onclaimed: () => void;
	}

	let { passes, features, onclaimed }: Props = $props();

	const copied = new Flash(COPIED_MS);
	let copiedId = $state<string | null>(null);
	/** A pass whose link could not be copied: its address is selected for a copy by hand. */
	let manualId = $state<string | null>(null);
	let busy = $state(false);
	let problem = $state<string | null>(null);
	const covered = $derived(hasFeature(features, 'live_draft_advisor'));

	async function copy(pass: AccountGroupPass, url: HTMLElement | undefined): Promise<void> {
		try {
			await navigator.clipboard.writeText(pass.claim_url);
			manualId = null;
			copiedId = pass.id;
			copied.show();
		} catch {
			// No clipboard here (an insecure page, a denied permission): select the address instead.
			manualId = pass.id;
			if (url) window.getSelection()?.selectAllChildren(url);
		}
	}

	async function claimMine(pass: AccountGroupPass): Promise<void> {
		busy = true;
		problem = null;
		try {
			await passApi.claim(pass.claim_code);
			onclaimed();
		} catch (error) {
			problem = error instanceof ApiError ? error.message : 'That did not go through. Try again.';
		} finally {
			busy = false;
		}
	}

	const urls: Record<string, HTMLElement | undefined> = {};
</script>

<section class="passes" aria-label="Your group passes">
	<PanelHead title="Your group passes" aside={String(passes.length)} level={2} />
	{#each passes as pass (pass.id)}
		<Panel as="section" label={pass.league_name}>
			<div class="pass">
				<PanelHead title={pass.league_name} aside="{pass.claimed} of {pass.seats} claimed" />
				<p class="line">{groupPassLine(pass)}</p>
				{#if pass.status === 'active'}
					<div class="link">
						<span class="url" bind:this={urls[pass.id]}>{pass.claim_url}</span>
						<Quiet size="sm" onclick={() => void copy(pass, urls[pass.id])}>
							{copied.on && copiedId === pass.id ? 'Link copied' : 'Copy the claim link'}
						</Quiet>
						{#if !pass.claimed_by_me && !covered && pass.claimed < pass.seats}
							<Quiet size="sm" disabled={busy} onclick={() => void claimMine(pass)}
								>Claim my seat</Quiet
							>
						{/if}
					</div>
					{#if manualId === pass.id}
						<p class="line" role="status">This browser can't copy it. Copy it from here.</p>
					{/if}
					<LineList label="Seats on {pass.league_name}" lines={seatLines(pass)} />
				{/if}
			</div>
		</Panel>
	{/each}
	{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
	<LiveRegion words={copied.on ? 'Link copied' : ''} />
</section>

<style>
	.passes,
	.pass {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
	}

	.line,
	.url {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.url {
		overflow-wrap: anywhere;
		min-width: 0;
	}

	.link {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-2) var(--s-3);
	}

	.problem {
		margin: 0;
		color: var(--loss-ink);
		font-size: var(--t-sm);
	}
</style>
