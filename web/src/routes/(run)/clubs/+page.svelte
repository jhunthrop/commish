<script lang="ts">
	import { windowLabel } from '#lib/format/date.ts';
	import { fixed, plural, scheduleRankWords } from '#lib/format/number.ts';
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
	const lead = $derived.by(() => {
		const [first] = page.clubs;
		const strength = first
			? ` · schedule strength is the ${first.slate.method}, read ${windowLabel(first.slate.window)}`
			: '';
		return `Every club's players on our ${page.format.label} board${strength}`;
	});
</script>

<SiteShell title="Clubs" run={data.run}>
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
						<span class="sos">
							<Figure value={fixed(club.slate.strength, 2)} size="md" />
							<Label>{scheduleRankWords(club.slate.rank)}</Label>
						</span>
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

	.sos {
		display: flex;
		align-items: baseline;
		gap: var(--s-2);
	}

	@media (max-width: 760px) {
		.clubs {
			padding: var(--s-4);
		}
	}
</style>
