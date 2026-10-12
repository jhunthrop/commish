<script lang="ts">
	import { fixed } from '#lib/format/number.ts';
	import { tierColor, type TierCliff } from './tier.ts';

	interface Props {
		tier: number;
		/** How many players share the tier. */
		count: number;
		/** The plural the count reads with: "WRs". */
		group: string;
		/** The drop to the next tier, or null on the last tier. */
		cliff: TierCliff | null;
		/** What the drop is measured in, named in full: "PPR pts". */
		unit: string;
		/** The anchor the tier jump list links to. */
		id?: string;
	}

	let { tier, count, group, cliff, unit, id }: Props = $props();
</script>

<div class="band" {id} style:--tier={tierColor(tier)}>
	<span class="strip">{tier}</span>
	<span class="name"><b>Tier {tier}</b><span>{count} {group}</span></span>
	<span class="cliff">
		{#if cliff}
			<b>{fixed(cliff.drop)}</b><span>{unit} down to tier {cliff.nextTier}</span>
		{:else}
			<span>Last tier</span>
		{/if}
	</span>
</div>

<style>
	.band {
		display: grid;
		grid-template-columns: 52px 1fr auto;
		align-items: center;
		column-gap: var(--s-3);
		padding-right: var(--s-4);
		min-height: 56px;
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
		font-size: var(--t-2xl);
		line-height: 1;
	}

	.name {
		display: flex;
		align-items: baseline;
		gap: var(--s-3);
	}

	.name b {
		font-size: var(--t-lg);
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
		gap: 8px;
	}

	.cliff b {
		font-family: var(--font-num);
		font-weight: 800;
		font-size: 34px;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	@media (max-width: 760px) {
		.band {
			grid-template-columns: 40px 1fr;
			row-gap: 2px;
			padding: 6px var(--s-3) 6px 0;
		}

		.strip {
			grid-row: span 2;
			font-size: 30px;
		}

		.name {
			gap: var(--s-2);
		}

		.cliff b {
			font-size: 24px;
		}
	}
</style>
