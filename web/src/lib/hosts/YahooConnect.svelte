<script lang="ts">
	import ActionBar from '#lib/ui/ActionBar.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { ApiError, goToYahoo } from './api.ts';

	/** Connect Yahoo: one verb that opens Yahoo's own sign-in, which asks for read-only access to
	 * fantasy leagues and sends the member back to the account page. */
	interface Props {
		/** A line above the verb: why a connection is asked for again. */
		reason?: string;
		/** The verb's words: "Connect Yahoo", "Connect Yahoo again". */
		label?: string;
		/** The verb sits in the page's action bar: true where connecting is the page's one verb (the
		 * attach page), false where it sits among other rows (the account page). */
		bar?: boolean;
		/** The page to come back to once connected, a path on the site; the account page when unset. */
		returnTo?: string;
	}

	let { reason, label = 'Connect Yahoo', bar = false, returnTo }: Props = $props();

	let busy = $state(false);
	let problem = $state<string | null>(null);

	async function go(): Promise<void> {
		busy = true;
		problem = null;
		try {
			await goToYahoo(returnTo);
		} catch (error) {
			problem = error instanceof ApiError ? error.message : 'That did not go through. Try again.';
			busy = false;
		}
	}
</script>

<div class="connect">
	{#if reason}<p class="reason">{reason}</p>{/if}
	<p class="note">
		Yahoo asks you to allow read-only access to your fantasy leagues. We read your league with it
		and never make a move. Disconnect on your account page deletes it at once.
	</p>
	{#if bar}
		<ActionBar alert={problem ? alert : undefined}>{@render verb()}</ActionBar>
	{:else}
		<div class="act">{@render verb()}</div>
		{#if problem}{@render alert()}{/if}
	{/if}
</div>

{#snippet verb()}
	<Verb disabled={busy} onclick={() => void go()}>{busy ? 'Opening Yahoo' : label}</Verb>
{/snippet}

{#snippet alert()}
	<ProblemLine>{problem}</ProblemLine>
{/snippet}

<style>
	.connect {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}

	.reason,
	.note {
		margin: 0;
		max-width: 60ch;
	}

	.note {
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.act {
		display: flex;
		margin-top: var(--s-1);
	}
</style>
