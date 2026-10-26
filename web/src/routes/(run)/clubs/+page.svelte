<script lang="ts">
	import { plural } from '#lib/format/number.ts';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import { links } from '#lib/site/links.ts';
	import Figure from '#lib/ui/Figure.svelte';
	import Label from '#lib/ui/Label.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import PlayerLine from '#lib/ui/PlayerLine.svelte';
	import Tile from '#lib/ui/Tile.svelte';
	import { CLUB_PAGE } from '#lib/site/reference-words.ts';
	import { basisAtClock, placedLeads } from '#lib/run/live-order.ts';
	import { apiFormatOf } from '#lib/run/format-ids.ts';
	import type { BasisPart } from '#lib/run/board-basis.ts';
	import { BUILD_ZONE, inSeasonStamp } from '#lib/front/live-board.ts';
	import BasisLine from '#lib/ui/BasisLine.svelte';
	import { memberZone } from '#lib/format/clock.ts';
	import type { ClubCard } from '#lib/server/pages/clubs.ts';
	import { onMount } from 'svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const page = $derived(data.page);
	const lead = $derived(page.lead);
	/** In season each club's lead at the order's clock, the one the Rankings read (Lane 220, B184): his
	 * rank and place the order's, or the run's leads while it is unread or when it does not place them. */
	let atClock = $state<{ cards: ClubCard[]; lead: BasisPart } | null>(null);
	/** The member's zone once the page is live, the build's before (as the front door's stamp). */
	let zone = $state(BUILD_ZONE);
	onMount(() => {
		zone = memberZone();
	});
	$effect(() => {
		const { format, clubs, restOfSeason } = page;
		if (!restOfSeason) {
			atClock = null;
			return;
		}
		let stale = false;
		void import('#lib/run/live-order-read.ts')
			.then(({ readOrder }) =>
				readOrder(
					null,
					{ teams: format.teams, scoring: apiFormatOf(format) },
					memberZone(),
					Date.now
				)
			)
			.then((read) => {
				if (stale) return;
				const cards = placedLeads(clubs, read.places, format.teams);
				atClock = cards === null ? null : { cards, lead: read.lead };
			})
			.catch(() => {
				if (!stale) atClock = null;
			});
		return () => {
			stale = true;
		};
	});
	const cards = $derived(atClock?.cards ?? page.clubs);
	/** The cards' clock, said once under them (review M2): the order's lead once its leads stand, the
	 * run's stamp before; none before the season, when the run's leads are the only ones. */
	const basis = $derived(basisAtClock([], atClock?.lead ?? null, inSeasonStamp(page.format, zone)));
</script>

<SiteShell title={CLUB_PAGE.clubs} head={data.head} run={data.run}>
	<main class="clubs">
		<PageHead title={CLUB_PAGE.clubs} {lead} />
		<ul>
			{#each cards as club (club.abbr)}
				<li>
					<Tile
						title="{club.city} {club.nickname}"
						href={links.club(club.abbr)}
						meta="{club.abbr} · {CLUB_PAGE.byeWeek} {club.bye ?? CLUB_PAGE.byeNotSet}"
					>
						{#if club.strength}
							<Figure value={club.strength.value} size="md" caption={club.strength.caption} />
						{/if}
						{#if club.lead}
							<PlayerLine
								name={club.lead.name}
								position={club.lead.position}
								positionRank={club.lead.positionRank}
								team={club.lead.team}
								headshot={club.lead.headshot}
								href={links.player(club.lead.slug)}
							>
								{#snippet trailing()}<Label>{CLUB_PAGE.ourRank} {club.lead?.ourRank}</Label
									>{/snippet}
							</PlayerLine>
						{/if}
						<Label>{plural(club.players, CLUB_PAGE.player)} {CLUB_PAGE.onOurBoard}</Label>
					</Tile>
				</li>
			{/each}
		</ul>
		{#if basis.length > 0}<BasisLine parts={basis} />{/if}
	</main>
</SiteShell>

<style>
	.clubs {
		padding: var(--s-5);
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--s-3);
	}

	@media (max-width: 760px) {
		.clubs {
			padding: var(--s-4);
		}
	}
</style>
