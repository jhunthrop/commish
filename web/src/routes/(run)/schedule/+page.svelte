<script lang="ts">
	import SiteShell from '#lib/site/SiteShell.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import ScheduleGrid from '#lib/ui/ScheduleGrid.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { sectionHref } from '#lib/ui/nav.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const page = $derived(data.page);
	const lead = $derived(page.lead);
</script>

<SiteShell title="Schedule strength" head={data.head} run={data.run}>
	{#snippet tail()}<Verb href={sectionHref('mock')}>Start a mock draft</Verb>{/snippet}
	<main class="schedule">
		<PageHead title="{page.season} schedule strength" {lead} />
		<ScheduleGrid
			rows={page.rows}
			weeks={page.weeks}
			caption={page.strengthLabel === null
				? "Every club's schedule"
				: "Every club's schedule, hardest first"}
			strengthLabel={page.strengthLabel}
			played={page.played}
		/>
	</main>
</SiteShell>

<style>
	.schedule {
		padding: var(--s-5);
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		min-width: 0;
	}

	@media (max-width: 760px) {
		.schedule {
			padding: var(--s-4);
		}
	}
</style>
