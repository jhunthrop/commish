<script lang="ts">
	import { fixed, plural } from '#lib/format/number.ts';
	import type { PlayerRef } from '#lib/types/player.ts';
	import PlayerLine from './PlayerLine.svelte';
	import Figure from './Figure.svelte';
	import { tierColor, type GroupName, type TierCliff } from './tier.ts';

	interface Mate extends PlayerRef {
		href: string;
		projected: number;
	}

	interface Props {
		tier: number;
		/** What his tier's players are called, one and many. */
		group: GroupName;
		mates: readonly Mate[];
		/** The player the page is about, marked in the list. */
		currentId: string;
		cliff: TierCliff | null;
		/** What the points are in: "PPR pts". */
		unit: string;
		/** The basis of the numbers in the list, printed at its foot: "Projected PPR points, 2026". */
		basis: string;
	}

	let { tier, group, mates, currentId, cliff, unit, basis }: Props = $props();

	const drop = $derived(
		cliff
			? `${plural(mates.length, 'player')}, then ${fixed(cliff.drop)} ${unit} down to tier ${String(cliff.nextTier)}`
			: `${plural(mates.length, 'player')}, the last tier`
	);
</script>

<div class="mates" style:--tier={tierColor(tier)}>
	<div class="band">
		<span class="strip">{tier}</span>
		<span class="what"><b>Tier {tier} {group.many}</b><span>{drop}</span></span>
	</div>
	<ol>
		{#each mates as mate (mate.id)}
			<li>
				<PlayerLine
					name={mate.name}
					position={mate.position}
					positionRank={mate.positionRank}
					team={mate.team}
					headshot={mate.headshot}
					href={mate.href}
					current={mate.id === currentId}
				>
					{#snippet trailing()}<Figure value={fixed(mate.projected)} size="sm" />{/snippet}
				</PlayerLine>
			</li>
		{/each}
	</ol>
	<div class="foot">{basis}</div>
</div>

<style>
	.mates {
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--surface);
		overflow: hidden;
	}

	.band {
		display: grid;
		grid-template-columns: 44px 1fr;
		align-items: center;
		min-height: 52px;
		background: color-mix(in srgb, var(--tier) var(--tier-wash), var(--bg));
		border-bottom: 2px solid var(--tier);
	}

	.strip {
		align-self: stretch;
		display: grid;
		place-items: center;
		background: var(--tier);
		color: var(--tier-ink);
		font-family: var(--font-num);
		font-weight: 800;
		font-size: 30px;
	}

	.what {
		display: flex;
		flex-direction: column;
		padding: 0 var(--s-3);
	}

	.what b {
		font-size: var(--t-md);
	}

	.what span {
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	ol {
		list-style: none;
		margin: 0;
		padding: var(--s-2);
	}

	.foot {
		padding: var(--s-3) var(--s-4);
		border-top: 1px solid var(--line);
		font-size: var(--t-sm);
		color: var(--ink-2);
	}
</style>
