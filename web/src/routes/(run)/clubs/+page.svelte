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
	import { placedLeads } from '#lib/run/live-order.ts';
	import { memberZone } from '#lib/format/clock.ts';
	import type { ClubCard } from '#lib/server/pages/clubs.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const page = $derived(data.page);
	const lead = $derived(page.lead);
	/** In season each club's lead at the order's clock, the one the Rankings read (Lane 220, B184): his
	 * rank and place the order's, or the run's leads while it is unread or when it does not place them. */
	let atClock = $state<ClubCard[] | null>(null);
	$effect(() => {
		const { format, clubs, restOfSeason } = page;
		if (!restOfSeason) {
			atClock = null;
			return;
		}
		let stale = false;
		void import('#lib/run/live-order-read.ts')
			.then(({ readOrder }) => readOrder(null, format.teams, memberZone(), Date.now))
			.then((read) => {
				if (!stale) atClock = placedLeads(clubs, read.places, format.teams);
			})
			.catch(() => {
				if (!stale) atClock = null;
			});
		return () => {
			stale = true;
		};
	});
	const cards = $derived(atClock ?? page.clubs);
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
