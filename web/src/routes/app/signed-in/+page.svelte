<script lang="ts">
	import { NO_APP, OPEN_APP } from '#lib/site/app-words.ts';
	import HeadTags from '#lib/site/HeadTags.svelte';
	import Mark from '#lib/ui/Mark.svelte';
	import type { HeadMarkup } from '#lib/site/head.ts';

	/** An app's sign-in comes back here. The app takes the link, so a member sees this page only when
	 * it did not: it names the app and how to get it, and nothing it was opened with. */
	let { data }: { data: { head: HeadMarkup } } = $props();
</script>

<HeadTags title={OPEN_APP} markup={data.head} />

<main class="signed-in">
	<Mark size={56} />
	<h1>{OPEN_APP}</h1>
	<p>{NO_APP}</p>
</main>

<style>
	.signed-in {
		max-width: 420px;
		min-height: 100dvh;
		margin: 0 auto;
		padding: var(--s-6) var(--s-5);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--s-4);
		text-align: center;
	}

	h1 {
		margin: 0;
		font-size: var(--t-xl);
		color: var(--ink);
	}

	p {
		margin: 0;
		font-size: var(--t-md);
		color: var(--ink-2);
	}
</style>
