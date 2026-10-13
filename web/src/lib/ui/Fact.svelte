<script lang="ts">
	import type { Snippet } from 'svelte';
	import Label from './Label.svelte';
	import type { Heat } from './heat.ts';

	interface Props {
		/** What the fact is about, as an uppercase label: "Where drafters take him". */
		label: string;
		/** The fact's number with its unit or chip, on one line. */
		value: Snippet;
		/** A magnitude fact takes the heat of its number, the way a value cell does. */
		heat?: Heat;
		/** One sentence naming the number's basis. */
		children: Snippet;
	}

	let { label, value, heat, children }: Props = $props();
</script>

<div class="fact {heat ?? ''}" class:tinted={heat !== undefined && heat !== 'none'}>
	<Label tone={heat === undefined || heat === 'none' ? 'muted' : 'inherit'}>{label}</Label>
	<div class="value">{@render value()}</div>
	<p>{@render children()}</p>
</div>

<style>
	.fact {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		min-width: 0;
		padding: var(--s-4);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--surface);
	}

	.tinted {
		color: var(--heat-ink);
		border-color: transparent;
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

	.value {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: var(--s-2);
	}

	p {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.tinted p {
		color: inherit;
	}
</style>
