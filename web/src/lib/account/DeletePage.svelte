<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { PUBLIC_API_URL } from '$app/env/public';
	import { ApiError, apiClient } from '#lib/api/client.ts';
	import { forgetContext } from '#lib/context/forget.ts';
	import type { HeadMarkup } from '#lib/site/head.ts';
	import { links } from '#lib/site/links.ts';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Field from '#lib/ui/Field.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { confirmed, deleteApi, type DeleteState } from './delete-api.ts';
	import { DELETED_PARAM, DELETE_WORDS } from './delete-words.ts';

	interface Props {
		/** The rail's week item, named at build in season (server/build-week.ts). */
		weekLabel?: string | undefined;
		/** The page's head but its title, built at prerender. */
		head: HeadMarkup;
	}

	let { weekLabel, head }: Props = $props();

	/** Delete account (Lane 233, B230): what goes and what stays, the email typed to confirm, one
	 * verb, and the page after, all at /account/delete, the address the stores cite. The shell is
	 * prerendered and the account is read in the browser. */
	const api = deleteApi(apiClient(PUBLIC_API_URL), () => navigator.onLine);
	const here = links.accountDelete();

	let view = $state<DeleteState | null>(null);
	let typed = $state('');
	let busy = $state(false);
	let problem = $state<string | null>(null);

	async function load(): Promise<void> {
		if (new URLSearchParams(window.location.search).has(DELETED_PARAM)) {
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
			void goto(`${here}?${DELETED_PARAM}`, { state: {}, shallow: true, replace: true });
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
		{:else if view.kind === 'deleted'}
			<EmptyState title={DELETE_WORDS.doneTitle} line={DELETE_WORDS.doneLine}>
				{#snippet actions()}<Quiet href={resolve('/(run)')}>{DELETE_WORDS.home}</Quiet>{/snippet}
			</EmptyState>
		{:else if view.kind === 'signed-out'}
			<EmptyState title={DELETE_WORDS.signedOutTitle} line={DELETE_WORDS.signedOutLine}>
				{#snippet actions()}<Verb href={apiClient(PUBLIC_API_URL).signInUrl(here)}
						>{DELETE_WORDS.signIn}</Verb
					>{/snippet}
			</EmptyState>
		{:else if view.kind === 'offline'}
			<EmptyState title={DELETE_WORDS.offlineTitle} line={DELETE_WORDS.offlineLine} />
		{:else if view.kind === 'unreachable'}
			<EmptyState title={DELETE_WORDS.unreachableTitle} line={DELETE_WORDS.unreachableLine}>
				{#snippet actions()}<Quiet onclick={() => void load()}>{DELETE_WORDS.tryAgain}</Quiet
					>{/snippet}
			</EmptyState>
		{:else}
			{@const email = view.email}
			<PageHead title={DELETE_WORDS.heading} lead={DELETE_WORDS.lead} />
			<div class="lists">
				<section aria-label={DELETE_WORDS.deletedHead}>
					<h2>{DELETE_WORDS.deletedHead}</h2>
					<ul>
						{#each DELETE_WORDS.deleted as line (line)}<li>{line}</li>{/each}
					</ul>
				</section>
				<section aria-label={DELETE_WORDS.keptHead}>
					<h2>{DELETE_WORDS.keptHead}</h2>
					<ul>
						{#each DELETE_WORDS.kept as line (line)}<li>{line}</li>{/each}
					</ul>
				</section>
			</div>
			<form
				class="confirm"
				onsubmit={(event) => {
					event.preventDefault();
					void remove();
				}}
			>
				<p class="who">{DELETE_WORDS.signedInAs} <b>{email}</b></p>
				<Field label={DELETE_WORDS.confirm} kind="email" autocomplete="off" bind:value={typed} />
				<Verb type="submit" disabled={busy || !confirmed(typed, email)}>{DELETE_WORDS.verb}</Verb>
				{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
			</form>
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

	.lists {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--s-5);
	}

	h2 {
		margin: 0 0 var(--s-2);
		font-size: var(--t-sm);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--ink-3);
	}

	ul {
		margin: 0;
		padding-left: var(--s-4);
		display: flex;
		flex-direction: column;
		gap: var(--s-1);
		font-size: var(--t-md);
		color: var(--ink-2);
	}

	.confirm {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--s-3);
	}

	.who {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-3);
	}

	.problem {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--loss-ink);
	}

	@media (max-width: 760px) {
		.delete {
			padding: var(--s-4);
		}

		.lists {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
