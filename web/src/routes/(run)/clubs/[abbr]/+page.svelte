<script lang="ts">
	import { onMount } from 'svelte';
	import { fixed } from '#lib/format/number.ts';
	import { heldOut } from '#lib/run/board-status.ts';
	import { liveStatusClock, sayBoard, type LiveStatus } from '#lib/run/live-status.ts';
	import { basisAtClock, placedRows } from '#lib/run/live-order.ts';
	import { BUILD_ZONE, inSeasonStamp } from '#lib/front/live-board.ts';
	import type { BasisPart } from '#lib/run/board-basis.ts';
	import type { BoardRowView } from '#lib/run/schema.ts';
	import { memberZone } from '#lib/format/clock.ts';
	import { apiFormatOf } from '#lib/run/format-ids.ts';
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
	import { CLUB_PAGE, filled } from '#lib/site/reference-words.ts';
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
			restOfSeason: page.format.rosFromWeek !== undefined,
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
	/** In season the club's players at the order's clock, the one the Rankings read (Lane 220, B184):
	 * their ranks, places, points and values the order's, or the run's rows while it is unread or
	 * when it does not place every one of them. */
	let atClock = $state<{ rows: BoardRowView[]; lead: BasisPart } | null>(null);
	/** The member's zone once the page is live, the build's before (as the front door's stamp). */
	let zone = $state(BUILD_ZONE);
	onMount(() => {
		zone = memberZone();
	});
	$effect(() => {
		const { format, rows } = page;
		if (format.rosFromWeek === undefined) {
			atClock = null;
			return;
		}
		let stale = false;
		void import('#lib/run/live-order-read.ts')
			.then(({ readOrder }) =>
				readOrder(
					club.abbr,
					{ teams: format.teams, scoring: apiFormatOf(format) },
					memberZone(),
					Date.now
				)
			)
			.then((read) => {
				if (stale) return;
				const placed = placedRows(rows, read.places, format.teams);
				atClock = placed === null ? null : { rows: placed, lead: read.lead };
			})
			.catch(() => {
				if (!stale) atClock = null;
			});
		return () => {
			stale = true;
		};
	});
	const rows = $derived(atClock?.rows ?? page.rows);
	/** The order's lead once its rows stand, else the run's basis with its stamp (review M1). */
	const basis = $derived(
		basisAtClock(page.basis, atClock?.lead ?? null, inSeasonStamp(page.format, zone))
	);
	/** The page's one verb: his two best available players side by side. */
	const pair = $derived(rows.filter((row) => !heldOut(row)).slice(0, 2));
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

<SiteShell title={name} head={data.head} run={data.run}>
	{#snippet tail()}
		{#if pair.length === 2}<Verb href={links.compare(pair[0]?.slug, pair[1]?.slug)}
				>{CLUB_PAGE.comparePair}</Verb
			>{/if}
	{/snippet}
	<main class="club">
		<Crumb trail={[{ label: CLUB_PAGE.clubs, href: links.clubs() }, { label: name }]} />
		<HeroCard title={name}>
			{#snippet meta()}<Label
					>{club.abbr} · {CLUB_PAGE.byeWeek} {club.bye ?? CLUB_PAGE.byeNotSet}</Label
				>{/snippet}
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
		<BasisLine parts={basis} tail={words?.capture ?? null} />

		<section aria-label="On our board">
			<PanelHead title={filled(CLUB_PAGE.onBoard, page.format.label)} />
			{#if rows.length > 0}
				<BoardTable {columns} label="{name} on our {page.format.label} board">
					{#each rows as player (player.id)}
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
				<Label>{filled(CLUB_PAGE.nobody, club.city)}</Label>
			{/if}
		</section>

		{#if page.market.length > 0}
			<section aria-label="Kickers and defense">
				<PanelHead title={CLUB_PAGE.kickers} />
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
					{ label: CLUB_PAGE.week },
					{ label: CLUB_PAGE.opponent },
					{ label: CLUB_PAGE.expectedWins, align: 'end' }
				]}
			>
				{#each page.games as game (game.week)}
					{@const opponent = names.get(game.opponent)}
					<tr class:played={game.played}>
						<td>{CLUB_PAGE.week} {game.week}</td>
						<td>
							{game.home ? CLUB_PAGE.home : CLUB_PAGE.away}
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
