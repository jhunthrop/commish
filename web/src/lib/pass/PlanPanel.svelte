<script lang="ts">
	import type { Snippet } from 'svelte';
	import DisplayTitle from '#lib/ui/DisplayTitle.svelte';
	import FactStrip from '#lib/ui/FactStrip.svelte';
	import type { FactCell } from '#lib/ui/facts.ts';
	import Panel from '#lib/ui/Panel.svelte';
	import type { FeatureWords } from './words.ts';

	/** One product on the pass page as facts in cells (Lane 66o): its name, its price and dates as a
	 * strip, what it holds as a list of names, then its controls and its verb. With no price yet
	 * (checkout not open), the strip carries the dates alone and says so. */
	interface Props {
		title: string;
		/** The price first, then the dates and terms. */
		facts: readonly FactCell[];
		/** What the product holds, by name. */
		features: readonly FeatureWords[];
		/** Leads the list when the product builds on another: everything in the Draft Pass. */
		lead?: FeatureWords;
		/** The one product the page leads with takes the accent edge. */
		featured?: boolean;
		/** Choices between the facts and the list: the Membership's year or month. */
		choose?: Snippet;
		/** More under the list, before the verb: where the pass works. */
		more?: Snippet;
		/** The verb, or what stands in for it when the product is already yours. */
		action: Snippet;
	}

	let { title, facts, features, lead, featured = false, choose, more, action }: Props = $props();

	const holds = $derived(lead ? [lead, ...features] : features);
</script>

<Panel as="section" label={title} edge={featured ? 'accent' : undefined}>
	<div class="plan">
		<DisplayTitle size="panel">{title}</DisplayTitle>
		<FactStrip label="{title}: price and dates" cells={facts} />
		{#if choose}<div class="choose">{@render choose()}</div>{/if}
		<div class="holds">
			<span class="label">Holds</span>
			<ul aria-label="What {title} holds">
				{#each holds as line (line.lead)}<li>{line.lead}</li>{/each}
			</ul>
		</div>
		{#if more}{@render more()}{/if}
		<div class="action">{@render action()}</div>
	</div>
</Panel>

<style>
	.plan {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		height: 100%;
	}

	.choose {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
	}

	.label {
		font-size: var(--t-xs);
		font-weight: 500;
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--ink-3);
	}

	ul {
		margin: var(--s-2) 0 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
	}

	li {
		padding: var(--s-2) 0;
		border-bottom: 1px solid var(--line);
		font-weight: 600;
		font-size: var(--t-sm);
	}

	li:last-child {
		border-bottom: 0;
	}

	.action {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}
</style>
