<script lang="ts">
	import { tierColor } from './tier.ts';

	interface Props {
		/** Tier within the player's position, 1 is the top. */
		tier: number;
		/** "Tier 3" where there is room, a player's hero. "T3" in a row. */
		long?: boolean;
	}

	let { tier, long = false }: Props = $props();
</script>

<span class="tier-chip" class:long style:--tier={tierColor(tier)}
	>{long ? `Tier ${String(tier)}` : `T${String(tier)}`}</span
>

<style>
	.tier-chip {
		display: inline-flex;
		align-items: center;
		height: 20px;
		padding: 0 7px;
		border-radius: var(--r-sm);
		background: var(--tier);
		color: var(--tier-ink);
		font-size: var(--t-xs);
		font-weight: 700;
		letter-spacing: 0.04em;
	}

	.long {
		height: 24px;
		font-size: var(--t-sm);
	}
</style>
