<script lang="ts">
	import Panel from '#lib/ui/Panel.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { ApiError, isSignedOut, signInHref } from './api.ts';

	interface Props {
		/** What went wrong; a signed-out answer becomes the way to sign in. */
		error: unknown;
		/** Where sign-in brings the drafter back to. */
		returnTo: string;
	}

	let { error, returnTo }: Props = $props();

	const signedOut = $derived(isSignedOut(error));
	const message = $derived(
		error instanceof ApiError
			? error.message
			: 'The room could not be reached. Check the connection and reload.'
	);
</script>

<Panel padding="md">
	<div class="notice">
		{#if signedOut}
			<p>Sign in to draft. Your mocks and leagues are kept with your account.</p>
			<Verb href={signInHref(returnTo)}>Sign in to draft</Verb>
		{:else}
			<p>{message}</p>
		{/if}
	</div>
</Panel>

<style>
	.notice {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-3);
	}

	p {
		margin: 0;
		color: var(--ink-2);
	}
</style>
