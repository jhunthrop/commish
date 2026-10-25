<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fixed, plural } from '#lib/format/number.ts';
	import { TIER_WORDS, tierColor, tierInk, type GroupName, type TierCliff } from './tier.ts';

	interface Props {
		tier: number;
		/** How many players share the tier. */
		count: number;
		/** What the count counts, one and many: { one: 'WR', many: 'WRs' }. */
		group: GroupName;
		/** The drop to the next tier, or null on the last tier. */
		cliff: TierCliff | null;
		/** What the drop is measured in, named in full: "PPR pts". */
		unit: string;
		/** The anchor the tier jump list links to. */
		id?: string;
		/** Controls at the strip's right end where it has no drop to print: your sheet's tier
		 * handle. */
		tail?: Snippet;
	}

	let { tier, count, group, cliff, unit, id, tail }: Props = $props();
</script>

<div class="band" {id} style:--tier={tierColor(tier)} style:--tier-ink={tierInk(tier)}>
	<span class="strip">{tier}</span>
	<span class="name"
		><b>{TIER_WORDS.tier} {tier}</b><span>{plural(count, group.one, group.many)}</span></span
	>
	<span class="cliff">
		{#if cliff}
			<b>{fixed(cliff.drop)}</b><span>{unit} {TIER_WORDS.toTier} {cliff.nextTier}</span>
		{:else if tail}
			{@render tail()}
		{:else}
			<span>{TIER_WORDS.lastTier}</span>
		{/if}
	</span>
</div>

<style>
	/* The band is a row's height (Lane 66n, the approved mock): its number once on the tier's hue, its
	   count, and the drop to the next tier in the row's figure size, so no band figure outsizes a
	   player's name. */
	.band {
		display: grid;
		grid-template-columns: 44px 1fr auto;
		align-items: center;
		column-gap: var(--s-3);
		padding-right: var(--s-3);
		min-height: 40px;
		border-radius: var(--r-md) var(--r-md) 0 0;
		background: color-mix(in srgb, var(--tier) var(--tier-wash), var(--bg));
		border-bottom: 2px solid var(--tier);
	}

	.strip {
		align-self: stretch;
		display: grid;
		place-items: center;
		background: var(--tier);
		color: var(--tier-ink);
		border-radius: var(--r-md) 0 0 0;
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		font-weight: 800;
		font-size: var(--t-row-num);
		line-height: 1;
	}

	.name {
		display: flex;
		align-items: baseline;
		gap: var(--s-2);
		min-width: 0;
	}

	.name b {
		font-size: var(--t-md);
		font-weight: 700;
	}

	.name span,
	.cliff span {
		color: var(--ink-2);
		font-size: var(--t-sm);
		white-space: nowrap;
	}

	.cliff {
		display: flex;
		align-items: baseline;
		gap: 6px;
	}

	.cliff b {
		font-family: var(--font-num);
		font-weight: 600;
		font-size: var(--t-row-num);
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	@media (max-width: 760px) {
		.band {
			grid-template-columns: 36px 1fr auto;
			column-gap: var(--s-2);
			padding-right: var(--s-2);
		}

		.name span,
		.cliff span {
			font-size: var(--t-xs);
		}
	}
</style>
