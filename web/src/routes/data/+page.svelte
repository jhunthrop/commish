<script lang="ts">
	import '#lib/ui/fonts/steady.css';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import {
		DATA_PAGE_TITLE,
		LICENCE_WORD,
		SHARED_UNDER,
		SOURCES,
		SOURCES_LEAD,
		SOURCES_TITLE,
		sourceEnd
	} from '#lib/site/sources.ts';
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
						{source.before}<a href={source.href} rel="external">{source.credit}</a
						>{source.after}{#if source.licence}{SHARED_UNDER}<a
								href={source.licence.href}
								rel="external license">{source.licence.name}</a
							>{LICENCE_WORD}{/if}{sourceEnd(source)}
					</li>
				{/each}
			</ul>
		</section>
	</main>
</SiteShell>

<style>
	/* The credits are long sentences in the first screen: set in the steady face (fonts/steady.css,
	   font-display optional), the lead and the list keep the face they painted in, so Outfit's arrival
	   moves no word (measured at 412 wide: a CLS of 0.08 to 0.15 with the swap face). The title is
	   the display face, short enough to break the same in both. */
	.sources {
		padding: var(--s-5);
		display: flex;
		flex-direction: column;
		gap: var(--s-5);
		max-width: 900px;
		font-family: var(--font-ui-steady);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		max-width: 68ch;
		border-top: 1px solid var(--line);
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
