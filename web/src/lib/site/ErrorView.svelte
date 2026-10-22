<script lang="ts">
	import PageHead from '#lib/ui/PageHead.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { sectionHref } from '#lib/ui/nav.ts';
	import { ERROR_WORDS, type ErrorWords } from './error-words.ts';

	interface Props {
		words: ErrorWords;
		/** The rail's week item named at build (the prerendered not-found page), else absent. */
		weekLabel?: string;
		/** Hold the week item's label unpainted until the site's season is read (the Worker's page). */
		holdWeek?: boolean;
	}

	let { words, weekLabel, holdWeek = false }: Props = $props();
</script>

<svelte:head>
	<title>{words.bar} · Commish</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<Shell title={words.bar} active={null} {weekLabel} {holdWeek}>
	<main class="error">
		<PageHead title={words.head} lead={words.lead} />
		<div class="ways">
			<Verb href={sectionHref('board')}>{ERROR_WORDS.toBoard}</Verb>
		</div>
	</main>
</Shell>

<style>
	.error {
		padding: var(--s-6) var(--s-5);
		display: flex;
		flex-direction: column;
		gap: var(--s-5);
		max-width: 720px;
	}

	.ways {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-3);
	}

	@media (max-width: 760px) {
		.error {
			padding: var(--s-5) var(--s-4);
		}
	}
</style>
