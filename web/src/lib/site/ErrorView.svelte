<script lang="ts">
	import PageHead from '#lib/ui/PageHead.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { sectionHref } from '#lib/ui/nav.ts';

	/** The site's own error page: not found, or something broke. The root error page draws it, and
	 * so does a route whose own load cannot throw (a client-rendered page reloads without end). */
	interface Props {
		missing: boolean;
	}

	let { missing }: Props = $props();

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
			<Verb href={sectionHref('board')}>Go to the board</Verb>
			<Quiet href={sectionHref('players')}>Every player</Quiet>
			<Quiet href={sectionHref('record')}>Our record</Quiet>
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
