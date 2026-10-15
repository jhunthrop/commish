<script lang="ts">
	import SiteShell from '#lib/site/SiteShell.svelte';
	import { SOURCES, SOURCES_LEAD, SOURCES_TITLE } from '#lib/site/sources.ts';
	import PageHead from '#lib/ui/PageHead.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<SiteShell title={SOURCES_TITLE} run={data.run}>
	<main class="sources">
		<PageHead title={SOURCES_TITLE} lead={SOURCES_LEAD} />
		<ul aria-label={SOURCES_TITLE}>
			{#each SOURCES as source (source.href)}
				<li>
					{source.before}<a href={source.href} rel="external">{source.credit}</a>{source.after}
				</li>
			{/each}
		</ul>
	</main>
</SiteShell>

<style>
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
		border-top: 1px solid var(--line);
	}

	li {
		padding: var(--s-3) 0;
		border-bottom: 1px solid var(--line);
		max-width: 68ch;
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
