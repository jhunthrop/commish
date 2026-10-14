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
	}

	let { reason, label = 'Connect Yahoo' }: Props = $props();

	let busy = $state(false);
	let problem = $state<string | null>(null);

	async function go(): Promise<void> {
		busy = true;
		problem = null;
		try {
			await goToYahoo();
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
	<ActionBar alert={problem ? alert : undefined}>
		<Verb disabled={busy} onclick={() => void go()}>{busy ? 'Opening Yahoo' : label}</Verb>
	</ActionBar>
</div>

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
</style>
