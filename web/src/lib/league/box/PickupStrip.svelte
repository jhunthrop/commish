<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { WaiverAdvice } from '../inseason/api.ts';
	import {
		cardGains,
		dropWhyWords,
		moveWords,
		pickupsTitle,
		pickupSum,
		type PickupCard
	} from './waivers.ts';
	import { stripLead, stripMark } from './strip.ts';

	/** The Waivers decision as a strip (Lane 66f): the board week, the count of pickups worth making
	 * and what they add to the lineup the advice sets, then a card for each (his slot, the move, this
	 * week's Proj gain and the rest of the season's) with its own verb. On a phone the cards scroll on
	 * one line and the chosen card's verb is the screen's pinned one. The strips' one rule (strip.ts,
	 * Lane 115, B87): the first card, the best, draws its verb solid and says Best, every other card
	 * the same words quiet. */
	interface Props {
		week: number;
		cards: readonly PickupCard[];
		/** The API's two figures for the sum: the lineup without the cards and with every one. */
		sum: Pick<WaiverAdvice, 'lineup_proj' | 'pickups_proj'>;
		/** The card the pinned verb acts on. */
		chosen: string | null;
		onchoose: (card: PickupCard) => void;
		/** A card's verb, drawn on a wide screen, and whether the card leads the strip (its verb solid). */
		verb: Snippet<[PickupCard, boolean]>;
		/** The line under the cards: why the verb opens the platform, or what it just did. */
		foot?: Snippet;
	}

	let { week, cards, sum: figures, chosen, onchoose, verb, foot }: Props = $props();
	const sum = $derived(pickupSum(figures, cards));
</script>

<div class="strip" data-strip="waivers">
	<div class="head">
		<span class="wk">Week {week}</span>
		<span class="title" class:quiet={cards.length === 0}>{pickupsTitle(cards.length)}</span>
		{#if sum}<span class="sum"
				><b class="figure">{sum.figure}</b><span class="words"
					>{sum.words}, <em>{sum.gain}</em></span
				></span
			>{/if}
	</div>
	{#if cards.length > 0}
		<ul class="pickups">
			{#each cards as card, index (card.key)}
				{@const on = chosen === card.key}
				{@const mark = stripMark(index, cards.length)}
				<li class="pickup" class:on>
					<button type="button" class="pick" aria-pressed={on} onclick={() => onchoose(card)}>
						<span class="slot">{card.slot}</span>
						<span class="text"
							><span class="move"
								>{#if mark}<span class="mark">{mark}</span>{/if}<b>{moveWords(card)}</b
								>{#if card.dropWhy}<span class="why">{dropWhyWords(card.dropWhy)}</span>{/if}</span
							><span class="gains">{cardGains(card)}</span></span
						>
					</button>
					<span class="verb">{@render verb(card, stripLead(index))}</span>
				</li>
			{/each}
		</ul>
	{/if}
	{#if foot}<div class="foot">{@render foot()}</div>{/if}
</div>

<style>
	.strip {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		gap: var(--s-2) var(--s-5);
		min-width: 0;
	}

	.head {
		grid-row: 1 / span 2;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.wk {
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--accent-text);
	}

	.title {
		font-family: var(--font-num);
		font-size: var(--t-head);
		font-weight: 800;
		line-height: 1;
		text-transform: uppercase;
		letter-spacing: 0.01em;
		white-space: nowrap;
	}

	.title.quiet {
		font-size: var(--t-xl);
	}

	.sum {
		display: flex;
		flex-direction: column;
		margin-top: var(--s-2);
	}

	.figure {
		font-family: var(--font-num);
		font-size: var(--t-xl);
		font-weight: 800;
		line-height: 1;
		color: var(--accent-text);
		font-variant-numeric: tabular-nums;
	}

	.words {
		font-size: var(--t-xs);
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	em {
		font-style: normal;
		font-weight: 700;
		color: var(--gain-ink);
	}

	.pickups {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* A card never passes the strip: on a narrow desk its verb drops under its words. */
	.pickup {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-2) var(--s-3);
		max-width: 100%;
		min-width: 0;
		padding: 6px;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: var(--bg);
	}

	.pickup.on {
		border-color: color-mix(in srgb, var(--accent) 55%, var(--line-strong));
	}

	.pick {
		display: flex;
		align-items: center;
		gap: var(--s-3);
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.slot {
		display: grid;
		place-items: center;
		height: 30px;
		min-width: 40px;
		padding: 0 6px;
		border-radius: var(--r-pill);
		background: var(--surface-2);
		font-family: var(--font-num);
		font-size: var(--t-sm);
		font-weight: 700;
		letter-spacing: 0.03em;
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		white-space: nowrap;
	}

	.move b {
		font-size: var(--t-md);
		font-weight: 700;
		color: var(--ink);
	}

	/* "Best" over the strip's first card of more than one, as the Trades strip says it (B87). */
	.mark {
		margin-right: 0.5em;
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--accent-text);
	}

	/* Why the drop is the one named (B34), quieter than the move. */
	.move .why {
		margin-left: 0.3em;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.gains {
		font-size: var(--t-xs);
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}

	.foot {
		grid-column: 2;
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	@media (max-width: 760px) {
		.strip {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--s-2);
		}

		.head {
			grid-row: auto;
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: end;
		}

		.title {
			grid-column: 1;
			font-size: var(--t-xl);
		}

		.sum {
			grid-column: 2;
			grid-row: 1 / span 2;
			align-items: flex-end;
			margin: 0;
		}

		.words {
			white-space: normal;
			text-align: right;
		}

		/* The cards stack, each the strip's width, its move wrapping so the reason is whole: never a
		   sideways scroll with the bar hidden (fix round 1, H2). The chosen one's verb is pinned at the
		   foot. */
		.pickups {
			flex-direction: column;
			flex-wrap: nowrap;
		}

		.pickup {
			flex: none;
			max-width: 100%;
			padding-right: var(--s-3);
		}

		.pick,
		.text {
			min-width: 0;
		}

		.text {
			white-space: normal;
		}

		.verb {
			display: none;
		}

		.move b {
			font-size: var(--t-sm);
		}

		/* The pinned verb carries the line on a phone. */
		.foot {
			display: none;
		}
	}
</style>
