<script lang="ts">
	import { fixed, plural, scheduleRankWords } from '#lib/format/number.ts';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import { links } from '#lib/site/links.ts';
	import Figure from '#lib/ui/Figure.svelte';
	import Label from '#lib/ui/Label.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PlayerLine from '#lib/ui/PlayerLine.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const page = $derived(data.page);
</script>

<SiteShell title="Clubs" active="players" run={data.run}>
	<main class="clubs">
		<div class="lead">
			<h2>Clubs</h2>
			<p>
				Every club's players on our {page.format.label} board · schedule strength is the {page.basis}
			</p>
		</div>
		<ul>
			{#each page.clubs as club (club.abbr)}
				<li>
					<Panel padding="sm">
						<div class="card">
							<div class="top">
								<a class="name" href={links.club(club.abbr)}>{club.city} {club.nickname}</a>
								<Label>{club.abbr} · bye week {club.bye ?? 'not set'}</Label>
							</div>
							<div class="sos">
								<Figure value={fixed(club.slate.strength, 2)} size="md" />
								<Label>{scheduleRankWords(club.slate.rank)}</Label>
							</div>
							{#if club.lead}
								<PlayerLine
									name={club.lead.name}
									position={club.lead.position}
									positionRank={club.lead.positionRank}
									team={club.lead.team}
									headshot={club.lead.headshot}
									href={links.player(club.lead.slug)}
								>
									{#snippet trailing()}<Label>Our {club.lead?.ourRank}</Label>{/snippet}
								</PlayerLine>
							{/if}
							<Label>{plural(club.players, 'player')} on our board</Label>
						</div>
					</Panel>
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

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--s-3);
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}

	.top {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.name {
		font-weight: 700;
		font-size: var(--t-lg);
		text-decoration: none;
	}

	.name:hover {
		text-decoration: underline;
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

		h2 {
			font-size: 34px;
		}
	}
</style>
