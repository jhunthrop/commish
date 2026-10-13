<script lang="ts">
	import { windowLabel } from '#lib/format/date.ts';
	import { fixed } from '#lib/format/number.ts';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import { links } from '#lib/site/links.ts';
	import PageHead from '#lib/ui/PageHead.svelte';
	import Table from '#lib/ui/Table.svelte';
	import type { Column } from '#lib/ui/table.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const page = $derived(data.page);
	const names = $derived(new Map(page.clubs.map((club) => [club.abbr, club])));
	const columns = $derived<Column[]>([
		{ label: 'Rank', align: 'end' },
		{ label: 'Club' },
		{ label: 'Strength', align: 'end' },
		...page.weeks.map((week) => ({ label: `Wk ${String(week)}`, wideOnly: true }))
	]);
	const lead = $derived.by(() => {
		const [first] = page.schedule.slates;
		const basis = first ? `Strength is the ${first.method}, read ${windowLabel(first.window)}` : '';
		return `${basis} · hardest first · @ is away`;
	});

	/** "KC" at home, "@KC" away, "Bye" on the open week. */
	function cell(abbr: string, week: number): string {
		const game = page.schedule.slates
			.find((slate) => slate.abbr === abbr)
			?.games.find((candidate) => candidate.week === week);
		if (!game) return 'Bye';
		return game.home ? game.opponent : `@${game.opponent}`;
	}
</script>

<SiteShell title="Schedule strength" active="board" run={data.run}>
	<main class="schedule">
		<PageHead title="{page.schedule.season} schedule strength" {lead} />
		<Table caption="Every club's schedule, hardest first" minWidth={340} {columns}>
			{#each page.schedule.slates as slate (slate.abbr)}
				{@const club = names.get(slate.abbr)}
				<tr>
					<td class="num">{slate.rank}</td>
					<td class="nowrap"
						><a href={links.club(slate.abbr)}
							>{club ? `${club.city} ${club.nickname}` : slate.abbr}</a
						></td
					>
					<td class="num">{fixed(slate.strength, 2)}</td>
					{#each page.weeks as week (week)}
						<td class="wide small">{cell(slate.abbr, week)}</td>
					{/each}
				</tr>
			{/each}
		</Table>
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
