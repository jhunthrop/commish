<script lang="ts">
	import { windowLabel } from '#lib/format/date.ts';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import ScheduleGrid from '#lib/ui/ScheduleGrid.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const page = $derived(data.page);
	const lead = $derived(
		`Strength is the ${page.method}, read ${windowLabel(page.window)} · hardest first · each week shows the opponent's ${page.opponentBasis.toLowerCase()}, shaded for the ${String(page.strong.count)} highest of the 32 (${page.strong.atLeast} or more)`
	);
</script>

<SiteShell title="Schedule strength" run={data.run}>
	<main class="schedule">
		<PageHead title="{page.season} schedule strength" {lead} />
		<ScheduleGrid
			rows={page.rows}
			weeks={page.weeks}
			caption="Every club's schedule, hardest first"
			strengthLabel="Strength"
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
