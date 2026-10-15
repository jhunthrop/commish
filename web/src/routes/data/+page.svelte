<script lang="ts">
	import SiteShell from '#lib/site/SiteShell.svelte';
	import { DATA_PAGE_TITLE, SOURCES, SOURCES_LEAD, SOURCES_TITLE } from '#lib/site/sources.ts';
	import PageHead from '#lib/ui/PageHead.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<SiteShell title={SOURCES_TITLE} heading={DATA_PAGE_TITLE} run={data.run}>
	<main class="sources">
		<PageHead title={DATA_PAGE_TITLE} lead={SOURCES_LEAD} />
		<section aria-label={SOURCES_TITLE}>
			<PanelHead title={SOURCES_TITLE} level={2} />
			<ul>
				{#each SOURCES as source (source.href)}
					<li>
						{source.before}<a href={source.href} rel="external">{source.credit}</a>{source.after}
					</li>
				{/each}
			</ul>
		</section>
	</main>
</SiteShell>

<style>
	/* The credits are long sentences in the viewport's first screen, and wherever Outfit breaks a line
	   where its fallback did not, its arrival moves words across the list (measured at 412 wide: a CLS
	   of 0.08 to 0.15 with the shared swap face). This face is the same core file with `optional`: the
	   list keeps whichever face it painted in, Outfit once the file is cached, and never swaps. */
	@font-face {
		font-family: 'Outfit Steady';
		font-style: normal;
		font-display: optional;
		font-weight: 100 900;
		src: url('../../lib/ui/fonts/core/outfit-core.woff2') format('woff2-variations');
		unicode-range: U+0020-007E, U+00A0-017F, U+2018-2019, U+201C-201D, U+2026, U+2190-2193, U+2212;
	}

	.sources {
		padding: var(--s-5);
		display: flex;
		flex-direction: column;
		gap: var(--s-5);
		max-width: 900px;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		max-width: 68ch;
		border-top: 1px solid var(--line);
		font-family: 'Outfit Steady', 'Outfit Fallback', var(--font-ui);
	}

	li {
		padding: var(--s-3) 0;
		border-bottom: 1px solid var(--line);
		font-size: var(--t-md);
		line-height: 1.5;
		color: var(--ink-2);
	}

	a {
		font-weight: 600;
		color: var(--ink);
	}

	@media (max-width: 760px) {
		.sources {
			padding: var(--s-4);
			gap: var(--s-4);
		}
	}
</style>
