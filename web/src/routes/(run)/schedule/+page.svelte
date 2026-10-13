<script lang="ts">
	import { fixed } from '#lib/format/number.ts';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import { links } from '#lib/site/links.ts';
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
		<div class="lead">
			<h2>{page.schedule.season} schedule strength</h2>
			<p>Strength is the {page.schedule.basis} · hardest first · @ is away</p>
		</div>
		<Table caption="Every club's schedule, hardest first" minWidth={340} {columns}>
			{#each page.schedule.slates as slate (slate.abbr)}
				{@const club = names.get(slate.abbr)}
				<tr>
					<td class="num">{slate.rank}</td>
					<td class="club"
						><a href={links.club(slate.abbr)}
							>{club ? `${club.city} ${club.nickname}` : slate.abbr}</a
						></td
					>
					<td class="num">{fixed(slate.strength, 2)}</td>
					{#each page.weeks as week (week)}
						<td class="wide wk">{cell(slate.abbr, week)}</td>
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

	h2 {
		margin: 0;
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-2xl);
		line-height: 0.9;
		text-transform: uppercase;
	}

	.lead p {
		margin: 6px 0 0;
		color: var(--ink-2);
		font-size: var(--t-sm);
	}

	.club {
		white-space: nowrap;
	}

	.club a {
		font-weight: 600;
		text-decoration: none;
	}

	.club a:hover {
		text-decoration: underline;
	}

	.wk {
		font-size: var(--t-xs);
		color: var(--ink-2);
		white-space: nowrap;
	}

	@media (max-width: 760px) {
		.schedule {
			padding: var(--s-4);
		}

		h2 {
			font-size: 34px;
		}
	}
</style>
