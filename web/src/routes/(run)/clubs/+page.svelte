<script lang="ts">
	import { plural } from '#lib/format/number.ts';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import { links } from '#lib/site/links.ts';
	import Figure from '#lib/ui/Figure.svelte';
	import Label from '#lib/ui/Label.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import PlayerLine from '#lib/ui/PlayerLine.svelte';
	import Tile from '#lib/ui/Tile.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const page = $derived(data.page);
	const lead = $derived(page.lead);
</script>

<SiteShell title="Clubs" head={data.head} run={data.run}>
	<main class="clubs">
		<PageHead title="Clubs" {lead} />
		<ul>
			{#each page.clubs as club (club.abbr)}
				<li>
					<Tile
						title="{club.city} {club.nickname}"
						href={links.club(club.abbr)}
						meta="{club.abbr} · bye week {club.bye ?? 'not set'}"
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
								{#snippet trailing()}<Label>Our rank {club.lead?.ourRank}</Label>{/snippet}
							</PlayerLine>
						{/if}
						<Label>{plural(club.players, 'player')} on our board</Label>
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
