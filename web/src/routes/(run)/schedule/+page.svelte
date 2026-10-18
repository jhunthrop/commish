<script lang="ts">
	import { scheduleLead } from '#lib/run/strength-words.ts';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import ScheduleGrid from '#lib/ui/ScheduleGrid.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { sectionHref } from '#lib/ui/nav.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const page = $derived(data.page);
	const lead = $derived(scheduleLead(page, page.strong, page.played));
</script>

<SiteShell title="Schedule strength" run={data.run}>
	{#snippet tail()}<Verb href={sectionHref('mock')}>Start a mock draft</Verb>{/snippet}
	<main class="schedule">
		<PageHead title="{page.season} schedule strength" {lead} />
		<ScheduleGrid
			rows={page.rows}
			weeks={page.weeks}
			caption="Every club's schedule, hardest first"
			strengthLabel="Strength"
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
