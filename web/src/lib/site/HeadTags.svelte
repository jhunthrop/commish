<script lang="ts">
	import { documentTitle, type HeadMarkup } from './head.ts';

	/** A page's head (Lane 169): its title and og:title, which follow the page's name where it
	 * changes with the season, then the rest as the server built it with the page (head.ts
	 * headMarkup), so the page's script carries the string and no builder. `fullTitle` is a whole
	 * title printed as is (the front door's), in place of "<title> · Commish" and as its og:title. */
	let {
		title,
		markup,
		fullTitle
	}: { title: string; markup: HeadMarkup; fullTitle?: string | undefined } = $props();
</script>

<svelte:head>
	<title>{fullTitle ?? documentTitle(title)}</title>
	<meta property="og:title" content={fullTitle ?? title} />
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- head.ts builds it on the server, every value escaped -->
	{@html markup}
</svelte:head>
