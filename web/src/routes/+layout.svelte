<script lang="ts">
	import '#lib/ui/tokens.css';
	import '#lib/ui/base.css';
	import favicon from '#lib/assets/favicon.svg';
	import { FONT_CSS_ORIGIN, FONT_FILE_ORIGIN, UI_FONTS_HREF } from '#lib/ui/fonts.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="preconnect" href={FONT_CSS_ORIGIN} />
	<link rel="preconnect" href={FONT_FILE_ORIGIN} crossorigin="anonymous" />
	<link rel="stylesheet" href={UI_FONTS_HREF} />
</svelte:head>

{@render children()}
