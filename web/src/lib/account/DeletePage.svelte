<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { PUBLIC_API_URL } from '$app/env/public';
	import { ApiError, apiClient } from '#lib/api/client.ts';
	import { forgetContext } from '#lib/context/forget.ts';
	import type { HeadMarkup } from '#lib/site/head.ts';
	import { links } from '#lib/site/links.ts';
	import Shell from '#lib/ui/Shell.svelte';
	import DeleteView from './DeleteView.svelte';
	import { confirmed, deleteApi, type DeleteState } from './delete-api.ts';
	import { DELETED_PARAM, DELETE_WORDS } from './delete-words.ts';
	import { markDeleted, takeDeleted } from './deleted-flag.ts';

	interface Props {
		/** The rail's week item, named at build in season (server/build-week.ts). */
		weekLabel?: string | undefined;
		/** The page's head but its title, built at prerender. */
		head: HeadMarkup;
	}

	let { weekLabel, head }: Props = $props();

	/** Delete account (Lane 233, B230): what goes and what stays, the email typed to confirm, one
	 * verb, and the page after, all at /account/delete, the address the stores cite. The shell is
	 * prerendered and the account is read in the browser; the states are DeleteView's. */
	const client = apiClient(PUBLIC_API_URL);
	const api = deleteApi(client, () => navigator.onLine);
	const here = links.accountDelete();

	let view = $state<DeleteState | null>(null);
	let typed = $state('');
	let busy = $state(false);
	let problem = $state<string | null>(null);

	async function load(): Promise<void> {
		// The page after says the account is deleted only to the tab that just deleted it.
		if (
			new URLSearchParams(window.location.search).has(DELETED_PARAM) &&
			takeDeleted(sessionStorage)
		) {
			view = { kind: 'deleted' };
			return;
		}
		try {
			view = await api.load();
		} catch {
			view = navigator.onLine ? { kind: 'unreachable' } : { kind: 'offline' };
		}
	}

	onMount(() => {
		void load();
	});

	async function remove(): Promise<void> {
		if (view?.kind !== 'signed-in' || !confirmed(typed, view.email)) return;
		busy = true;
		problem = null;
		try {
			await api.remove(typed);
			// Nothing of the account's leagues stays in this browser.
			forgetContext();
			view = { kind: 'deleted' };
			// The page after, at the same address, once: a reload of it still says so. A browser
			// that keeps nothing stays on this view instead.
			if (markDeleted(sessionStorage)) window.location.replace(`${here}?${DELETED_PARAM}`);
		} catch (error) {
			problem = error instanceof ApiError ? error.message : DELETE_WORDS.failed;
		} finally {
			busy = false;
		}
	}
</script>

<Shell head={{ title: DELETE_WORDS.title, markup: head }} title={DELETE_WORDS.title} {weekLabel}>
	<main class="delete" aria-busy={view === null}>
		{#if view === null}
			<div class="reserve"></div>
		{:else}
			<DeleteView
				{view}
				bind:typed
				{busy}
				{problem}
				signInHref={client.signInUrl(here)}
				homeHref={resolve('/(run)')}
				onremove={() => void remove()}
				onretry={() => void load()}
			/>
		{/if}
	</main>
</Shell>

<style>
	.delete {
		display: flex;
		flex-direction: column;
		gap: var(--s-5);
		padding: var(--s-5);
		max-width: 72ch;
	}

	.reserve {
		min-height: 40vh;
	}

	@media (max-width: 760px) {
		.delete {
			padding: var(--s-4);
		}
	}
</style>
