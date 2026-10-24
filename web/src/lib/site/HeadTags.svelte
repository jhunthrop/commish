<script lang="ts">
	import { documentTitle, type HeadMarkup } from './head.ts';

	/** A page's head (Lane 169): its title and og:title, which follow the page's name where it
	 * changes with the season, then the rest as the server built it with the page (head.ts
	 * headMarkup), so the page's script carries the string and no builder. */
	let { title, markup }: { title: string; markup: HeadMarkup } = $props();
</script>

<svelte:head>
	<title>{documentTitle(title)}</title>
	<meta property="og:title" content={title} />
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- head.ts builds it on the server, every value escaped -->
	{@html markup}
</svelte:head>
