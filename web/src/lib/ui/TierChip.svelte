<script lang="ts">
	import { tierColor } from './tier.ts';

	interface Props {
		/** Tier within the player's position, 1 is the top. */
		tier: number;
	}

	let { tier }: Props = $props();
</script>

<span class="tier-chip" style:--tier={tierColor(tier)}>T{tier}</span>

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
</style>
