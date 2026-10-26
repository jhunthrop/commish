<script lang="ts">
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Field from '#lib/ui/Field.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { confirmed, type DeleteState } from './delete-api.ts';
	import { DELETE_WORDS } from './delete-words.ts';

	/** The delete account page's body for each state it knows (Lane 233): signed in with the lists,
	 * the typed email and the one verb (waiting for the email to match), signed out, deleted, offline
	 * and unreachable. No router and no API here: DeletePage reads the account and does the delete,
	 * so the states render alone in a test. */
	interface Props {
		view: DeleteState;
		/** The email typed so far. */
		typed?: string;
		/** The delete is under way. */
		busy?: boolean;
		/** The API's sentence for a delete that did not go through. */
		problem?: string | null;
		/** Where Sign in goes, coming back to this page. */
		signInHref: string;
		/** Where the page after leads. */
		homeHref: string;
		onremove: () => void;
		onretry: () => void;
	}

	let {
		view,
		typed = $bindable(''),
		busy = false,
		problem = null,
		signInHref,
		homeHref,
		onremove,
		onretry
	}: Props = $props();
</script>

{#if view.kind === 'deleted'}
	<EmptyState title={DELETE_WORDS.doneTitle} line={DELETE_WORDS.doneLine}>
		{#snippet actions()}<Quiet href={homeHref}>{DELETE_WORDS.home}</Quiet>{/snippet}
	</EmptyState>
{:else if view.kind === 'signed-out'}
	<EmptyState title={DELETE_WORDS.signedOutTitle} line={DELETE_WORDS.signedOutLine}>
		{#snippet actions()}<Verb href={signInHref}>{DELETE_WORDS.signIn}</Verb>{/snippet}
	</EmptyState>
{:else if view.kind === 'offline'}
	<EmptyState title={DELETE_WORDS.offlineTitle} line={DELETE_WORDS.offlineLine} />
{:else if view.kind === 'unreachable'}
	<EmptyState title={DELETE_WORDS.unreachableTitle} line={DELETE_WORDS.unreachableLine}>
		{#snippet actions()}<Quiet onclick={onretry}>{DELETE_WORDS.tryAgain}</Quiet>{/snippet}
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
			onremove();
		}}
	>
		<p class="who">{DELETE_WORDS.signedInAs} <b>{email}</b></p>
		<Field label={DELETE_WORDS.confirm} kind="email" autocomplete="off" bind:value={typed} />
		<Verb type="submit" disabled={busy || !confirmed(typed, email)}>{DELETE_WORDS.verb}</Verb>
		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
	</form>
{/if}

<style>
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
		.lists {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
