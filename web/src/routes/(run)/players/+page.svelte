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
	import { siteContext } from '#lib/context/context.svelte.ts';
	import type OrderScreenComponent from '#lib/order/OrderScreen.svelte';
	import { onMount } from 'svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** The Players screen (Lane 66j): the search first and our order as a box score, read from the
	 * API with the page's script; the run's lists by position stay the page without one. */
	let Order = $state<typeof OrderScreenComponent | null>(null);

	// The league's rosters mark who is held on the lists.
	onMount(() => {
		siteContext.wantHeld();
		void import('#lib/order/OrderScreen.svelte').then((module) => {
			Order = module.default;
		});
	});
</script>

<SiteShell title="Players" run={data.run}>
	{#snippet tail()}<Quiet href={links.compare()}>Compare two players</Quiet>{/snippet}
	<main class="players">
		<PageHead
			title="Players"
			lead={Order === null
				? `Every player on our ${data.format.label} board · by position · our rank overall at the right`
				: 'Every player in our order, with kickers and defenses'}
		>
			{#snippet actions()}
				<Quiet href={links.clubs()} size="sm">Clubs</Quiet>
			{/snippet}
		</PageHead>
		{#if Order}
			<Order mode="players" label="Players in our rest-of-season order" />
		{:else}
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
										{#snippet trailing()}
											{@const held = siteContext.held?.mark(player.id)}
											{#if held}<held.Mark words={held.words} kind={held.kind} inline />{/if}
											<Label>{player.ourRank}</Label>
										{/snippet}
									</PlayerLine>
								</li>
							{/each}
						</ol>
					</Panel>
				{/each}
			</div>
		{/if}
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
