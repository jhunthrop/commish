<script lang="ts">
	import type { Snippet } from 'svelte';
	import DisplayTitle from '#lib/ui/DisplayTitle.svelte';
	import Figure from '#lib/ui/Figure.svelte';
	import LineList from '#lib/ui/LineList.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import type { FeatureWords } from './words.ts';

	/** One product on the pass page: its name, its figure with the basis, what it unlocks in
	 * sentences, then its controls and its verb. The figure is null until checkout opens, and the
	 * line under the name says what the product is in one sentence. */
	interface Props {
		title: string;
		line: string;
		/** "$39" with "for the 2026 season", or null while there is no figure to print. */
		figure: { value: string; caption: string } | null;
		/** The sentence that stands where the figure would. */
		noFigure?: string;
		features: readonly FeatureWords[];
		/** Leads the feature list when the product builds on another: everything in the Draft Pass. */
		lead?: FeatureWords;
		/** The one product the page leads with takes the accent edge. */
		featured?: boolean;
		/** Choices between the figure and the list: the Membership's year or month. */
		choose?: Snippet;
		/** More under the list, before the verb: where the pass works. */
		more?: Snippet;
		/** The verb, or what stands in for it when the product is already yours. */
		action: Snippet;
	}

	let {
		title,
		line,
		figure,
		noFigure = 'Checkout is not open yet',
		features,
		lead,
		featured = false,
		choose,
		more,
		action
	}: Props = $props();

	const lines = $derived(lead ? [lead, ...features] : features);
</script>

<Panel as="section" label={title} edge={featured ? 'accent' : undefined}>
	<div class="plan">
		<header>
			<DisplayTitle size="panel">{title}</DisplayTitle>
			<p class="line">{line}</p>
		</header>
		<div class="figure">
			{#if figure}
				<Figure value={figure.value} size="lg" caption={figure.caption} />
			{:else}
				<p class="none">{noFigure}</p>
			{/if}
		</div>
		{#if choose}<div class="choose">{@render choose()}</div>{/if}
		<LineList label="What {title} unlocks" {lines} />
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

	header {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}

	.line {
		margin: 0;
		color: var(--ink-2);
		font-size: var(--t-md);
		max-width: 44ch;
	}

	.figure {
		min-height: 76px;
		display: flex;
		align-items: flex-end;
	}

	.none {
		margin: 0;
		color: var(--ink-3);
		font-size: var(--t-sm);
	}

	.choose {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
	}

	.action {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}
</style>
