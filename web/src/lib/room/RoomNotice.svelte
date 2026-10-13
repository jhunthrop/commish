<script lang="ts">
	import Panel from '#lib/ui/Panel.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { type NoticeSubject, noticeFor } from './notice.ts';

	interface Props {
		/** What went wrong. */
		error: unknown;
		/** Which page hit it, so the words fit: a mock, a shared link, a lobby, setup. */
		subject: NoticeSubject;
		/** Where sign-in brings the drafter back to. */
		returnTo: string;
	}

	let { error, subject, returnTo }: Props = $props();

	const view = $derived(noticeFor(error, subject, returnTo));
</script>

<Panel padding="sm" edge="loss">
	<div class="notice" role="alert">
		<p>{view.text}</p>
		{#if (view.verb ?? view.quiet) !== undefined}
			<div class="acts">
				{#if view.verb}<Verb href={view.verb.href}>{view.verb.label}</Verb>{/if}
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
