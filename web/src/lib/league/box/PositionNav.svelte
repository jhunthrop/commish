<script lang="ts">
	import type { Snippet } from 'svelte';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import { PANEL, type PanelMode } from './positions.ts';
	import { NAV, type NavCard, type NavKey } from './position-nav.ts';

	/** The Waivers screen's navigation (Lane 305): a full-width row of cards, All first, then a card a
	 * position the league starts with the member's rank there, his figure against the median and the
	 * Need mark; the chosen card is drawn solid. One toggle over them reads the cards and the list for
	 * the rest of the season or this week. On a phone the cards scroll sideways in one row, the chosen
	 * one kept in view. */
	interface Props {
		cards: readonly NavCard[];
		chosen: NavKey;
		onchoose: (key: NavKey) => void;
		mode: PanelMode;
		/** Whether the answer reads this week's figures: the toggle is drawn only then. */
		week: boolean;
		onmode: (mode: PanelMode) => void;
		/** The id of the comparison the cards control. */
		controls: string;
		/** Drawn in the label's place on a phone (the screen's search), so the comparison starts above
		 * the pinned verb (review 305 M5); the screen draws its own at a desk. */
		phoneTools?: Snippet;
	}

	let { cards, chosen, onchoose, mode, week, onmode, controls, phoneTools }: Props = $props();

	let row = $state<HTMLElement | undefined>();

	/** The chosen card scrolled into the row's view, the page never moved (a phone's sideways row).
	 * The row is the cards' offset parent (position: relative), so a card's offsetLeft is its own. */
	$effect(() => {
		const el = row?.querySelector<HTMLElement>(`[data-card="${chosen}"]`);
		if (row === undefined || el === null || el === undefined) return;
		const left = el.offsetLeft;
		const right = left + el.offsetWidth;
		if (left < row.scrollLeft) row.scrollTo({ left });
		else if (right > row.scrollLeft + row.clientWidth) {
			row.scrollTo({ left: right - row.clientWidth });
		}
	});
</script>

<section class="nav" aria-label={PANEL.label} data-nav="positions">
	<div class="head">
		<span class="label">{PANEL.label}</span>
		<!-- The rank's meaning, once a mode, not once a card (review 305 M5). -->
		<span class="explain">{PANEL.explain[mode]}</span>
		{#if week}
			<ChipGroup label={NAV.figuresFor}>
				<Chip size="sm" pressed={mode === 'season'} onclick={() => onmode('season')}
					>{PANEL.season}</Chip
				>
				<Chip size="sm" pressed={mode === 'week'} onclick={() => onmode('week')}>{PANEL.week}</Chip>
			</ChipGroup>
		{:else}<span class="basis">{PANEL.season}</span>{/if}
		{#if phoneTools}<span class="tools">{@render phoneTools()}</span>{/if}
	</div>
	<div class="cards" bind:this={row}>
		{#each cards as card (card.key)}
			{@const on = chosen === card.key}
			<button
				type="button"
				class="card"
				class:on
				data-card={card.key}
				aria-pressed={on}
				aria-controls={controls}
				onclick={() => onchoose(card.key)}
			>
				<span class="top"
					><b class="pos">{card.word}</b>{#if card.pickup}<span class="pickup">{NAV.pickup}</span
						>{/if}</span
				>
				{#if card.place !== null}<span class="place">{card.place}</span>{/if}
				{#if card.waits}
					<span class="waits">{card.waits}</span>
				{:else}
					<span class="figs"
						><b class="figure">{card.figure}</b>{#if card.tag}<span class="tag">{card.tag}</span
							>{/if}{#if card.need}<span class="need" title={PANEL.needSays}>{PANEL.need}</span
							>{/if}</span
					>
					<span class="meter" aria-hidden="true"
						>{#if card.meter}<span
								class="fill"
								class:under={card.meter.under}
								style:width="{card.meter.share * 100}%"
							></span><span class="tick"></span>{/if}</span
					>
					{#if card.foot}<span class="foot">{card.foot}</span>{/if}
				{/if}
			</button>
		{/each}
	</div>
	<!-- A phone's line for the rank's meaning, once a mode under the cards (the head holds the search
	     there); a desk says it in the head (round 2 N2). -->
	<p class="explain under">{PANEL.explain[mode]}</p>
</section>

<style>
	.nav {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		min-width: 0;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s-3);
	}

	.explain {
		flex: 1;
		min-width: 0;
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.explain.under {
		display: none;
		margin: 0;
		line-height: 1.25;
	}

	.tools {
		display: none;
	}

	.label {
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
		white-space: nowrap;
	}

	.basis {
		font-size: var(--t-xs);
		color: var(--ink-2);
	}

	.cards {
		position: relative;
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: minmax(0, 1fr);
		gap: var(--s-2);
		/* Room under the row for the chosen card's pointer. */
		padding-bottom: 8px;
	}

	.card {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 2px;
		min-width: 0;
		padding: var(--s-2) var(--s-3);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			border-color 120ms,
			background 120ms,
			transform 80ms;
	}

	/* Hover only where a pointer hovers: on touch it would stick after the tap. */
	@media (hover: hover) {
		.card:hover {
			border-color: var(--ink-3);
			background: var(--surface-2);
		}

		.card.on:hover {
			background: var(--ink);
			border-color: var(--ink);
		}
	}

	.card:active {
		transform: translateY(1px);
	}

	.card:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	/* The chosen card, unmistakable: solid ink, a pointer down to the comparison it opens. */
	.card.on {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--bg);
	}

	.on .need {
		background: var(--loss-ink);
		color: var(--bg);
	}

	.card.on::after {
		content: '';
		position: absolute;
		left: 50%;
		bottom: -7px;
		width: 12px;
		height: 12px;
		border-radius: 2px;
		background: var(--ink);
		transform: translateX(-50%) rotate(45deg);
	}

	.top,
	.figs {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		white-space: nowrap;
	}

	.top {
		justify-content: space-between;
	}

	.figs {
		align-items: baseline;
	}

	.pos {
		font-family: var(--font-num);
		font-size: var(--t-xl);
		font-weight: 800;
		line-height: 1;
		letter-spacing: 0.02em;
	}

	.pickup {
		padding: 0 6px;
		border-radius: var(--r-pill);
		background: color-mix(in srgb, var(--accent) 18%, transparent);
		color: var(--accent-text);
		font-size: var(--t-xs);
		font-weight: 700;
	}

	.place {
		font-size: var(--t-sm);
		color: var(--ink-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.figure {
		font-family: var(--font-num);
		font-size: var(--t-xl);
		font-weight: 800;
		line-height: 1.05;
		font-variant-numeric: tabular-nums;
	}

	.tag {
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: var(--t-xs);
		color: var(--ink-2);
	}

	.need {
		margin-left: auto;
		padding: 0 6px;
		border-radius: var(--r-pill);
		background: color-mix(in srgb, var(--loss-ink) 16%, transparent);
		color: var(--loss-ink);
		font-size: var(--t-xs);
		font-weight: 700;
	}

	.waits {
		font-size: var(--t-xs);
		line-height: 1.3;
		color: var(--ink-2);
	}

	/* The member's figure against the median team's: the tick is the median, at the middle. */
	.meter {
		position: relative;
		height: 4px;
		margin: 3px 0 1px;
		border-radius: 2px;
		background: var(--line);
	}

	.fill {
		position: absolute;
		inset: 0 auto 0 0;
		border-radius: 2px;
		background: var(--gain-ink);
	}

	.fill.under {
		background: var(--loss-ink);
	}

	.tick {
		position: absolute;
		left: 50%;
		top: -3px;
		bottom: -3px;
		width: 2px;
		background: var(--ink-2);
	}

	.foot {
		font-size: var(--t-xs);
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.on .place,
	.on .tag,
	.on .foot,
	.on .waits {
		color: color-mix(in srgb, var(--bg) 78%, var(--ink));
	}

	/* The Pickup mark on the solid card: the accent itself under the card's own ground, so it reads
	   at contrast in both themes (review 305 M4). */
	.on .pickup {
		background: var(--accent);
		color: var(--accent-ink);
	}

	.on .meter {
		background: color-mix(in srgb, var(--bg) 30%, var(--ink));
	}

	.on .tick {
		background: var(--bg);
	}

	@media (max-width: 760px) {
		/* One row scrolled sideways inside the nav, the page never: three cards and a part of the
		   fourth show, so the row says it scrolls (review 305 M3). The padding keeps a focused card's
		   ring inside the scroller, the negative margins keep the cards on the page's edge (L4). */
		.cards {
			grid-auto-columns: calc((100% - 3 * var(--s-2)) / 3.4);
			overflow-x: auto;
			scrollbar-width: none;
			margin: -4px -4px 0;
			padding: 4px 4px 8px;
			scroll-padding: 0 4px;
		}

		/* The figure's words wrap under it rather than cut (L2); a Need stays beside the figure, a
		   size down, so every card keeps one height. */
		.figs {
			flex-wrap: wrap;
		}

		.need {
			padding: 0 4px;
		}

		.head .explain {
			display: none;
		}

		.explain.under {
			display: block;
		}

		/* The search in the label's place, the toggle after it: one row (review 305 M5). */
		.head:has(.tools) .label {
			display: none;
		}

		.tools {
			display: flex;
			flex: 1;
			min-width: 0;
			order: -1;
		}

		/* A phone's cards, compact so the comparison starts above the pinned verb (review 305 M5):
		   the position word and the figure a size down, the median beside the meter's tick. */
		.nav {
			gap: 6px;
		}

		.card {
			padding: 5px var(--s-2);
			gap: 0;
		}

		.pos {
			font-size: var(--t-lg);
		}

		.place {
			font-size: var(--t-xs);
		}

		.figure {
			font-size: var(--t-md);
		}

		.meter {
			margin: 3px 0 1px;
		}
	}
</style>
