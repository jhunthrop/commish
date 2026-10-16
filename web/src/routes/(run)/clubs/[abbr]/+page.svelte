<script lang="ts">
	import { onMount } from 'svelte';
	import { fixed } from '#lib/format/number.ts';
	import { liveStatusClock, sayBoard, type LiveStatus } from '#lib/run/live-status.ts';
	import { rowFraming } from '#lib/run/row-framing.ts';
	import { clubCaption, playedWords } from '#lib/run/strength-words.ts';
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
	/** How every row frames his rank against the drafts, the board's rule (run/row-framing.ts). */
	const framing = $derived(rowFraming(page.format));
	const club = $derived(page.club);
	const name = $derived(`${club.city} ${club.nickname}`);
	const names = $derived(new Map(page.clubs.map((other) => [other.abbr, other])));
	const caption = $derived(clubCaption(page.slate, page.clubs.length));
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
					<RowHead games={page.rows.some((row) => row.season !== undefined)} {framing} />
					{#each page.rows as player (player.id)}
						<Row
							{player}
							href={links.player(player.slug)}
							scale={page.scale}
							showTier
							unit={page.format.unit}
							season={player.season}
							{framing}
							status={words?.rows[player.id] ?? null}
						/>
					{/each}
				</Panel>
			{:else}
				<Label>Nobody from {club.city} is on this board</Label>
			{/if}
		</section>

		<section aria-label="Schedule">
			<Table
				caption={page.played === 0
					? `${String(page.schedule.season)} schedule`
					: `${String(page.schedule.season)} schedule, ${playedWords(page.played)}`}
				showCaption
				columns={[
					{ label: 'Week' },
					{ label: 'Opponent' },
					{ label: page.schedule.opponentBasis, align: 'end' }
				]}
			>
				{#each page.games as game (game.week)}
					{@const opponent = names.get(game.opponent)}
					<tr class:played={game.week <= page.played}>
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
		max-width: 1180px;
	}

	@media (max-width: 760px) {
		.club {
			padding: var(--s-4);
			gap: var(--s-4);
		}
	}
</style>
