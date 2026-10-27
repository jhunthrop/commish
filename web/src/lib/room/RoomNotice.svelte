<script lang="ts">
	import Panel from '#lib/ui/Panel.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { type NoticeRetry, type NoticeSubject, noticeFor } from './notice.ts';

	interface Props {
		/** What went wrong. */
		error: unknown;
		/** Which page hit it, so the words fit: a mock, a shared link, a lobby, setup. */
		subject: NoticeSubject;
		/** Where sign-in brings the drafter back to. */
		returnTo: string;
		/** Beside a page's own verb the way forward is quiet, so the page keeps one solid verb. */
		besideVerb?: boolean;
		/** A read that did not go, read again in place: drawn quiet before the way out. */
		retry?: NoticeRetry;
		/** The page did not load (its read failed), so a lobby notice keeps the way back. */
		read?: boolean;
	}

	let { error, subject, returnTo, besideVerb = false, retry, read = false }: Props = $props();

	const view = $derived(noticeFor(error, subject, returnTo, read));
</script>

<Panel padding="sm" edge="loss">
	<div class="notice" role="alert">
		<p>{view.text}</p>
		{#if (view.verb ?? view.quiet ?? retry) !== undefined}
			<div class="acts">
				{#if retry}<Quiet onclick={retry.run}>{retry.label}</Quiet>{/if}
				{#if view.verb && besideVerb}<Quiet href={view.verb.href}>{view.verb.label}</Quiet>
				{:else if view.verb}<Verb href={view.verb.href}>{view.verb.label}</Verb>{/if}
				{#if view.quiet}<Quiet href={view.quiet.href}>{view.quiet.label}</Quiet>{/if}
			</div>
		{/if}
	</div>
</Panel>

<style>
	.notice {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--s-3);
	}

	p {
		margin: 0;
		max-width: 64ch;
		color: var(--ink);
	}

	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-2);
	}
</style>
