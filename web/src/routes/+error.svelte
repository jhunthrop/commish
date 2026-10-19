<script lang="ts">
	import { page } from '$app/state';
	import PageHead from '#lib/ui/PageHead.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { sectionHref } from '#lib/ui/nav.ts';

	const NOT_FOUND = 404;

	const missing = $derived(page.status === NOT_FOUND);
	const title = $derived(missing ? 'Page not found' : 'Something broke');
	const lead = $derived(
		missing ? 'Nothing lives at this address.' : 'This page did not load. Try it again in a moment.'
	);
</script>

<svelte:head>
	<title>{title} · Commish</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<Shell {title} active={null}>
	<main class="error">
		<PageHead title={missing ? 'Not found' : 'Error'} {lead} />
		<div class="ways">
			<!-- One way on (the sweep's C14): the board, where every other page is a tap away. -->
			<Verb href={sectionHref('board')}>Go to the board</Verb>
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
