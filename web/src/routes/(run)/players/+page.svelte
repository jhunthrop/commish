<script lang="ts">
	import { POSITION_NAMES } from '#lib/run/derive.ts';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import { links } from '#lib/site/links.ts';
	import Label from '#lib/ui/Label.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import PlayerLine from '#lib/ui/PlayerLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<SiteShell title="Players" active="players" run={data.run}>
	{#snippet tail()}<Quiet href={links.compare()}>Compare two players</Quiet>{/snippet}
	<main class="players">
		<PageHead
			title="Players"
			lead="
				Every player on our {data.format.label} board · by position · our rank overall at the right
			"
		/>
		<div class="groups">
			{#each data.groups as group (group.position)}
				<Panel as="section" label={POSITION_NAMES[group.position].many}>
					<PanelHead
						title={POSITION_NAMES[group.position].many}
						aside={String(group.players.length)}
					/>
					<ol>
						{#each group.players as player (player.id)}
							<li>
								<PlayerLine
									name={player.name}
									position={group.position}
									positionRank={player.positionRank}
									team={player.team}
									href={links.player(player.slug)}
								>
									{#snippet trailing()}<Label>{player.ourRank}</Label>{/snippet}
								</PlayerLine>
							</li>
						{/each}
					</ol>
				</Panel>
			{/each}
		</div>
	</main>
</SiteShell>

<style>
	.players {
		padding: var(--s-5);
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
	}

	.groups {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--s-3);
		align-items: start;
	}

	ol {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	@media (max-width: 760px) {
		.players {
			padding: var(--s-4);
		}
	}
</style>
