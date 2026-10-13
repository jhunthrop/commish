<script lang="ts">
	import { fixed, signed as withSign } from '#lib/format/number.ts';
	import Label from './Label.svelte';
	import type { Heat } from './heat.ts';

	interface Props {
		value: number;
		/** The number's basis, printed under it: "PPR pts", "over repl · rd 1". */
		label: string;
		/** A magnitude cell takes a heat, even none, and draws as a tinted tile. A plain cell omits it. */
		heat?: Heat;
		/** Print the sign: +93.7, −0.9. */
		signed?: boolean;
		decimals?: number;
		/** Off, the phone prints the number alone, for a cell whose column head names it. */
		phoneLabel?: boolean;
	}

	let { value, label, heat, signed = false, decimals = 1, phoneLabel = true }: Props = $props();

	const text = $derived(signed ? withSign(value, decimals) : fixed(value, decimals));
</script>

<span class="cell {heat ?? ''}" class:tile={heat !== undefined} class:bare={!phoneLabel}>
	<b>{text}</b>
	<span class="basis"
		><Label size="cell" tone={heat === undefined ? 'muted' : 'inherit'}>{label}</Label></span
	>
</span>

<style>
	.cell {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: flex-end;
		height: calc(var(--row-h) - 8px);
	}

	b {
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.01em;
		font-weight: 700;
		font-size: var(--t-xl);
		line-height: 1;
	}

	.tile {
		padding: 0 var(--s-3);
		border-radius: var(--r-sm);
		color: var(--heat-ink);
	}

	.heat-1 {
		background: var(--heat-1);
	}

	.heat-2 {
		background: var(--heat-2);
	}

	.heat-3 {
		background: var(--heat-3);
	}

	.heat-4 {
		background: var(--heat-4);
	}

	.heat-neg {
		background: var(--heat-neg);
	}

	/* On a phone the basis wraps under the number, so the cell grows with it. */
	@media (max-width: 760px) {
		.cell {
			height: auto;
			min-height: calc(var(--row-h) - 8px);
		}

		b {
			font-size: 22px;
		}

		.tile {
			padding: 0 var(--s-2);
		}

		/* The column head names the number, so the cell is the number alone. Assistive tech still reads
		   the basis with it. */
		.bare .basis {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}
</style>
