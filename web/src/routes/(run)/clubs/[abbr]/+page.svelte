<script lang="ts">
	import { fixed, scheduleRankWords } from '#lib/format/number.ts';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import { links } from '#lib/site/links.ts';
	import Figure from '#lib/ui/Figure.svelte';
	import Label from '#lib/ui/Label.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import Row from '#lib/ui/Row.svelte';
	import RowHead from '#lib/ui/RowHead.svelte';
	import Table from '#lib/ui/Table.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const page = $derived(data.page);
	const club = $derived(page.club);
	const names = $derived(new Map(page.clubs.map((other) => [other.abbr, other])));
</script>

<SiteShell title="{club.city} {club.nickname}" active="players" run={data.run}>
	<main class="club">
		<nav class="crumb" aria-label="Where this page sits">
			<a href={links.clubs()}>Clubs</a> / {club.city}
			{club.nickname}
		</nav>
		<section class="hero">
			<div class="ident">
				<h2>{club.city} {club.nickname}</h2>
				<Label>{club.abbr} · bye week {club.bye ?? 'not set'}</Label>
			</div>
			<Figure
				value={fixed(page.slate.strength, 2)}
				size="xl"
				align="end"
				phoneAlign="start"
				caption="{scheduleRankWords(page.slate.rank)} of 32, the {page.schedule.basis}"
			/>
		</section>

		<section aria-label="On our board">
			<h3 class="head">On our {page.format.label} board</h3>
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
				<p class="none">Nobody from {club.city} is on this board.</p>
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

	.crumb {
		font-size: var(--t-sm);
		color: var(--ink-3);
	}

	.crumb a {
		text-decoration: none;
	}

	.hero {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: var(--s-5);
		padding: var(--s-6);
		border-radius: var(--r-md);
		background: var(--surface);
		border: 1px solid var(--line);
	}

	.ident {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}

	h2 {
		margin: 0;
		font-size: clamp(2rem, 4vw, 3.25rem);
		font-weight: 700;
		line-height: 1;
	}

	.head {
		margin: 0 0 var(--s-3);
		font-size: var(--t-md);
		font-weight: 700;
	}

	.none {
		color: var(--ink-2);
	}

	td a {
		text-decoration: none;
		font-weight: 600;
	}

	td a:hover {
		text-decoration: underline;
	}

	@media (max-width: 760px) {
		.club {
			padding: var(--s-4);
			gap: var(--s-4);
		}

		.hero {
			padding: var(--s-4);
		}
	}
</style>
