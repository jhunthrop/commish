<script lang="ts">
	import SiteShell from '#lib/site/SiteShell.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import ScheduleGrid from '#lib/ui/ScheduleGrid.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { sectionHref } from '#lib/ui/nav.ts';
	import { SCHEDULE_PAGE } from '#lib/site/reference-words.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const page = $derived(data.page);
	const lead = $derived(page.lead);
</script>

<SiteShell title={SCHEDULE_PAGE.title} head={data.head} run={data.run}>
	{#snippet tail()}<Verb href={sectionHref('mock')}>Start a mock draft</Verb>{/snippet}
	<main class="schedule">
		<PageHead title="{page.season} {SCHEDULE_PAGE.heading}" {lead} />
		<ScheduleGrid
			rows={page.rows}
			weeks={page.weeks}
			caption={page.strengthLabel === null ? SCHEDULE_PAGE.caption : SCHEDULE_PAGE.captionHardest}
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
