<script lang="ts">
	import { onMount } from 'svelte';
	import { fixed } from '#lib/format/number.ts';
	import { heldOut } from '#lib/run/board-status.ts';
	import { liveStatusClock, sayBoard, type LiveStatus } from '#lib/run/live-status.ts';
	import { rowFraming } from '#lib/run/row-framing.ts';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import { links } from '#lib/site/links.ts';
	import BasisLine from '#lib/ui/BasisLine.svelte';
	import BoardTable from '#lib/ui/BoardTable.svelte';
	import Crumb from '#lib/ui/Crumb.svelte';
	import Figure from '#lib/ui/Figure.svelte';
	import HeroCard from '#lib/ui/HeroCard.svelte';
	import Label from '#lib/ui/Label.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Row from '#lib/ui/Row.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { boardColumns } from '#lib/ui/board-columns.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const page = $derived(data.page);
	/** How every row frames his rank against the drafts, the board's rule (run/row-framing.ts). */
	const framing = $derived(rowFraming(page.format));
	const club = $derived(page.club);
	const name = $derived(`${club.city} ${club.nickname}`);
	const names = $derived(new Map(page.clubs.map((other) => [other.abbr, other])));
	/** Every row shares the club's bye, said once in the hero, so the rows carry no Bye column. */
	const columns = $derived(
		boardColumns({
			order: 'board',
			tier: true,
			bye: false,
			range: page.scale !== null,
			gap: page.gap,
			season: page.underway,
			action: false
		})
	);
	const kickers = $derived(
		boardColumns({
			order: 'board',
			tier: false,
			bye: false,
			range: false,
			gap: false,
			season: false,
			action: false,
			draftOrder: true
		})
	);
	/** The page's one verb: his two best available players side by side. */
	const pair = $derived(page.rows.filter((row) => !heldOut(row)).slice(0, 2));
	/** The rows' status words as built, said again on the member's clock once the page is live. */
	let live = $state<LiveStatus | null>(null);
	onMount(() => {
		liveStatusClock(
			page.capture !== null,
			() => import('#lib/run/status-view.ts'),
			(said) => {
				live = said;
			}
		);
	});
	const words = $derived(sayBoard(page, live));
</script>

<SiteShell title={name} run={data.run}>
	{#snippet tail()}
		{#if pair.length === 2}<Verb href={links.compare(pair[0]?.slug, pair[1]?.slug)}
				>Compare two of them</Verb
			>{/if}
	{/snippet}
	<main class="club">
		<Crumb trail={[{ label: 'Clubs', href: links.clubs() }, { label: name }]} />
		<HeroCard title={name}>
			{#snippet meta()}<Label>{club.abbr} · bye week {club.bye ?? 'not set'}</Label>{/snippet}
			{#snippet aside()}
				{#if page.hero}
					<div class="figures">
						<Figure
							value={page.hero.value}
							size="xl"
							align="end"
							phoneAlign="start"
							caption={page.hero.caption}
							note={page.hero.note}
						/>
						<Figure
							value={page.hero.hardest.figure}
							size="lg"
							align="end"
							phoneAlign="start"
							caption={page.hero.hardest.caption}
						/>
					</div>
				{/if}
			{/snippet}
		</HeroCard>
		<BasisLine parts={page.basis} tail={words?.capture ?? null} />

		<section aria-label="On our board">
			<PanelHead title="On our {page.format.label} board" />
			{#if page.rows.length > 0}
				<BoardTable {columns} label="{name} on our {page.format.label} board">
					{#each page.rows as player (player.id)}
						<Row
							{player}
							href={links.player(player.slug)}
							{columns}
							scale={page.scale ?? undefined}
							bye={null}
							season={player.season}
							{framing}
							status={words?.rows[player.id] ?? null}
						/>
					{/each}
				</BoardTable>
			{:else}
				<Label>Nobody from {club.city} is on this board</Label>
			{/if}
		</section>

		{#if page.market.length > 0}
			<section aria-label="Kickers and defense">
				<PanelHead title="Kickers and defense, in draft order" />
				<BoardTable columns={kickers} label="{name} kickers and defense">
					{#each page.market as player (player.id)}
						<Row
							{player}
							columns={kickers}
							bye={null}
							{framing}
							href={links.board(page.format.id, player.position)}
							status={words?.rows[player.id] ?? null}
						/>
					{/each}
				</BoardTable>
			</section>
		{/if}

		<section aria-label="Schedule">
			<Table
				caption={page.scheduleCaption}
				showCaption
				columns={[
					{ label: 'Week' },
					{ label: 'Opponent' },
					{ label: 'Expected wins', align: 'end' }
				]}
			>
				{#each page.games as game (game.week)}
					{@const opponent = names.get(game.opponent)}
					<tr class:played={game.played}>
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
	/* A week already played is set back, so what is left reads first. */
	.played,
	.played :global(a) {
		color: var(--played-ink);
	}

	.club {
		padding: var(--s-5);
		display: flex;
		flex-direction: column;
		gap: var(--s-5);
		max-width: 1440px;
	}

	.figures {
		display: flex;
		align-items: flex-end;
		gap: var(--s-6);
	}

	@media (max-width: 760px) {
		.club {
			padding: var(--s-4);
			gap: var(--s-4);
		}

		.figures {
			gap: var(--s-5);
		}
	}
</style>
