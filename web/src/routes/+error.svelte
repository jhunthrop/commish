<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import ErrorView from '#lib/site/ErrorView.svelte';
	import { ERROR_WORDS } from '#lib/site/error-words.ts';

	const NOT_FOUND = 404;

	// The Worker's error page: every failure that is not a missing page the Worker serves from the
	// prerendered one (routes/404), and a 404 where no build is behind it (the dev server, a page the
	// Worker draws that finds nothing). With no build to name the week from, it holds the week item's
	// label from its first paint, on the server too, until the site's season is read (context
	// firstSeason), as the pages the Worker draws do (Lane 148).
	let waiting = $state(true);
	onMount(() => {
		siteContext.firstSeason();
		waiting = false;
	});
</script>

<ErrorView
	words={page.status === NOT_FOUND ? ERROR_WORDS.notFound : ERROR_WORDS.broke}
	holdWeek={waiting}
/>
