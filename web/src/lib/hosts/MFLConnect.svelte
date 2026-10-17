<script lang="ts">
	import ActionBar from '#lib/ui/ActionBar.svelte';
	import Consent from '#lib/ui/Consent.svelte';
	import Field from '#lib/ui/Field.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { ApiError, MFL_CONSENT, hostsApi, type HostConnected } from './api.ts';

	/** Connect MyFantasyLeague on our form: username, password, the consent in plain words with the
	 * box first, one verb. The password goes to the API once, which sends it to MyFantasyLeague's login
	 * once and keeps only the session; the field is cleared, whatever the answer. */
	interface Props {
		/** The verb's words: "Connect MyFantasyLeague", or "Connect MyFantasyLeague again". */
		label?: string;
		onconnected: (answer: HostConnected) => void;
	}

	let { label = 'Connect MyFantasyLeague', onconnected }: Props = $props();

	let username = $state('');
	let password = $state('');
	let consent = $state(false);
	let busy = $state(false);
	let problem = $state<string | null>(null);

	const ready = $derived(username.trim() !== '' && password !== '' && consent && !busy);

	async function connect(): Promise<void> {
		if (!ready) return;
		busy = true;
		problem = null;
		const typed = password;
		password = '';
		try {
			onconnected(await hostsApi.connectMFL(username.trim(), typed));
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
	<Field
		label="MyFantasyLeague username or email"
		autocomplete="username"
		bind:value={username}
		maxlength={128}
	/>
	<Field
		label="MyFantasyLeague password"
		kind="password"
		autocomplete="current-password"
		bind:value={password}
		maxlength={128}
		onenter={() => void connect()}
	/>
	<Consent words={MFL_CONSENT} bind:checked={consent} />
	<ActionBar alert={problem ? alert : undefined}>
		<Verb disabled={!ready} onclick={() => void connect()}
			>{busy ? 'Signing in to MyFantasyLeague' : label}</Verb
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
</style>
