<script lang="ts">
	import { windowLabel } from '#lib/format/date.ts';
	import { fixed, scheduleRankWords } from '#lib/format/number.ts';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import { links } from '#lib/site/links.ts';
	import Crumb from '#lib/ui/Crumb.svelte';
	import Figure from '#lib/ui/Figure.svelte';
	import HeroCard from '#lib/ui/HeroCard.svelte';
	import Label from '#lib/ui/Label.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Row from '#lib/ui/Row.svelte';
	import RowHead from '#lib/ui/RowHead.svelte';
	import Table from '#lib/ui/Table.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const page = $derived(data.page);
	const club = $derived(page.club);
	const name = $derived(`${club.city} ${club.nickname}`);
	const names = $derived(new Map(page.clubs.map((other) => [other.abbr, other])));
	const caption = $derived(
		`${scheduleRankWords(page.slate.rank)} of 32, the ${page.slate.method}, read ${windowLabel(page.slate.window)}`
	);
</script>

<SiteShell title={name} active="players" run={data.run}>
	<main class="club">
		<Crumb trail={[{ label: 'Clubs', href: links.clubs() }, { label: name }]} />
		<HeroCard title={name}>
			{#snippet meta()}<Label>{club.abbr} · bye week {club.bye ?? 'not set'}</Label>{/snippet}
			{#snippet aside()}
				<Figure
					value={fixed(page.slate.strength, 2)}
					size="xl"
					align="end"
					phoneAlign="start"
					{caption}
				/>
			{/snippet}
		</HeroCard>

		<section aria-label="On our board">
			<PanelHead title="On our {page.format.label} board" />
			{#if page.scale}
				<Panel padding="none">
					<RowHead />
					{#each page.rows as player (player.id)}
						<Row
							{player}
							href={links.player(player.slug)}
							scale={page.scale}
							showTier
							unit={page.format.unit}
						/>
					{/each}
				</Panel>
			{:else}
				<Label>Nobody from {club.city} is on this board</Label>
			{/if}
		</section>

		<section aria-label="Schedule">
			<Table
				caption="{page.schedule.season} schedule"
				showCaption
				columns={[
					{ label: 'Week' },
					{ label: 'Opponent' },
					{ label: page.schedule.opponentBasis, align: 'end' }
				]}
			>
				{#each page.games as game (game.week)}
					{@const opponent = names.get(game.opponent)}
					<tr>
						<td>Week {game.week}</td>
						<td>
							{game.home ? 'vs' : 'at'}
							<a href={links.club(game.opponent)}
								>{opponent ? `${opponent.city} ${opponent.nickname}` : game.opponent}</a
							>
						</td>
						<td class="num">{fixed(game.value, 1)}</td>
					</tr>
				{/each}
			</Table>
		</section>
	</main>
</SiteShell>

<style>
	.club {
		padding: var(--s-5);
		display: flex;
		flex-direction: column;
		gap: var(--s-5);
		max-width: 1180px;
	}

	@media (max-width: 760px) {
		.club {
			padding: var(--s-4);
			gap: var(--s-4);
		}
	}
</style>
