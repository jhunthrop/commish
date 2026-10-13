<script lang="ts">
	import ActionBar from '#lib/ui/ActionBar.svelte';
	import Consent from '#lib/ui/Consent.svelte';
	import Field from '#lib/ui/Field.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { ApiError, FFPC_CONSENT, FFPC_TERMS, hostsApi, type HostLeague } from './api.ts';

	/** Sign in to FFPC on our form: email, password, the consent in plain words with the box first,
	 * one verb. The password is sent to the API once and the field is cleared, whatever the answer. */
	interface Props {
		/** A line above the form: why a sign-in is asked for again. */
		reason?: string;
		onconnected: (leagues: HostLeague[]) => void;
	}

	let { reason, onconnected }: Props = $props();

	let email = $state('');
	let password = $state('');
	let consent = $state(false);
	let busy = $state(false);
	let problem = $state<string | null>(null);

	const ready = $derived(email.trim() !== '' && password !== '' && consent && !busy);

	async function connect(): Promise<void> {
		if (!ready) return;
		busy = true;
		problem = null;
		const typed = password;
		password = '';
		try {
			const answer = await hostsApi.connectFFPC(email.trim(), typed, consent);
			onconnected(answer.leagues);
		} catch (error) {
			const fields = error instanceof ApiError ? Object.values(error.fields) : [];
			problem =
				fields[0] ??
				(error instanceof ApiError ? error.message : 'That did not go through. Try again.');
		} finally {
			busy = false;
		}
	}
</script>

<div class="signin">
	{#if reason}<p class="reason">{reason}</p>{/if}
	<Field
		label="FFPC email or username"
		autocomplete="username"
		bind:value={email}
		maxlength={128}
	/>
	<Field
		label="FFPC password"
		kind="password"
		autocomplete="current-password"
		bind:value={password}
		maxlength={128}
		onenter={() => void connect()}
	/>
	<Consent words={FFPC_CONSENT} bind:checked={consent} />
	<p class="terms">{FFPC_TERMS}</p>
	<ActionBar alert={problem ? alert : undefined}>
		<Verb disabled={!ready} onclick={() => void connect()}
			>{busy ? 'Signing in to FFPC' : 'Connect FFPC'}</Verb
		>
	</ActionBar>
</div>

{#snippet alert()}
	<ProblemLine>{problem}</ProblemLine>
{/snippet}

<style>
	.signin {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
		max-width: var(--form-w);
	}

	.reason {
		margin: 0;
		color: var(--ink-2);
	}

	.terms {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}
</style>
