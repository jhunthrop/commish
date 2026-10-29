<script lang="ts">
	import type { Snippet } from 'svelte';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import StripAction from '#lib/ui/StripAction.svelte';
	import type { WaiverAdvice, WaiverRow } from '../inseason/api.ts';
	import { LINES } from '../inseason/words.ts';
	import { BOX } from './box.ts';
	import { WAIVERS } from './waivers.ts';
	import {
		PANEL,
		panelCards,
		panelExplain,
		panelHasWeek,
		type PanelCard,
		type PanelMode
	} from './positions.ts';

	/** The Waivers screen's position panel (Lane 291): one row of cards, a position each, its rank in
	 * the league, the member's figure against the median team's and the need mark; a card opens under
	 * the row on its ranked list, the member's players first, then the best free agents there, each
	 * with the table's Beats words and the table's Add. The toggle reads the figures for the rest of
	 * the season (the default) or this week. On a phone the cards scroll sideways in one row. */
	interface Props {
		advice: Pick<WaiverAdvice, 'positions' | 'pickups' | 'roster'>;
		zone: string;
		now: number;
		/** The table's Add for a free agent's row: the screen's one verb rule. */
		onadd: (row: WaiverRow) => void;
		/** At a desk, the pickups strip the panel sits beside in one band (coordinator's ruling,
		 * 2026-10-29): the strip takes its cards' width, the cards the rest, the open list under both. */
		beside?: Snippet;
	}

	let { advice, zone, now, onadd, beside }: Props = $props();

	let mode = $state<PanelMode>('season');
	let open = $state<string | null>(null);
	const cards = $derived(panelCards(advice, mode, zone, now));
	const week = $derived(panelHasWeek(advice));
	const opened = $derived(cards.find((c) => c.key === open) ?? null);
	const listId = 'position-list';

	function toggle(card: PanelCard): void {
		open = open === card.key ? null : card.key;
	}
</script>

{#if cards.length > 0}
	<div class="positions" class:band={beside !== undefined} data-panel="positions">
		{#if beside}<div class="beside">{@render beside()}</div>{/if}
		<section class="panel" aria-label={PANEL.label}>
			<div class="row">
				<div class="head">
					<span class="label">{PANEL.label}</span>
					{#if week}
						<ChipGroup label={PANEL.label}>
							<Chip size="sm" pressed={mode === 'season'} onclick={() => (mode = 'season')}
								>{PANEL.season}</Chip
							>
							<Chip size="sm" pressed={mode === 'week'} onclick={() => (mode = 'week')}
								>{PANEL.week}</Chip
							>
						</ChipGroup>
					{:else}<span class="basis">{PANEL.season}</span>{/if}
				</div>
				<ul class="cards">
					{#each cards as card (card.key)}
						<li data-card={card.key} class:on={open === card.key}>
							<button
								type="button"
								class="card-head"
								aria-expanded={open === card.key}
								aria-controls={listId}
								onclick={() => toggle(card)}
							>
								<span class="top"
									><b class="pos">{card.word}</b><span class="rank">{card.place}</span></span
								>
								<span class="figs"
									><b class="figure">{card.figure}</b>{#if card.need}<span class="need"
											>{PANEL.need}</span
										>{/if}</span
								>
								{#if card.standing !== null}<span class="median">{card.median} {PANEL.median}</span
									>{/if}
							</button>
						</li>
					{/each}
				</ul>
			</div>
		</section>
		{#if opened}
			<div class="list" id={listId} data-list={opened.key} role="region" aria-label={opened.rank}>
				<p class="list-head">
					<b>{opened.rank}</b>
					<span>{panelExplain(mode, [opened])}</span>
				</p>
				<ol class="entries">
					<li class="entry heads" aria-hidden="true">
						<span>{BOX.player}</span>
						<span></span>
						<span class="fig">{mode === 'season' ? PANEL.season : BOX.proj}</span>
						<span>{WAIVERS.beats}</span>
						<span></span>
					</li>
					{#each opened.mine as entry (entry.key)}
						<li class="entry mine" data-mine>
							<span class="who"
								><b title={entry.full}>{entry.name}</b> <span>{entry.team}</span></span
							>
							<span class="mark">{PANEL.yours}, {entry.mark}</span>
							<span class="fig">{entry.figure}</span>
							<span class="beats"></span>
							<span class="act"></span>
						</li>
					{/each}
					{#each opened.free as entry, index (entry.key)}
						<li class="entry free" class:first={index === 0 && opened.mine.length > 0} data-free>
							<span class="who"
								><b title={entry.full}>{entry.name}</b> <span>{entry.team}</span></span
							>
							<span class="mark">{entry.mark}</span>
							<span class="fig">{entry.figure}</span>
							<span class="beats" class:gains={entry.pool?.gains}
								>{#if entry.beats}<span class="beats-word"
										>{WAIVERS.beats}
									</span>{entry.beats}{/if}</span
							>
							<span class="act"
								>{#if entry.pool}{@const source = entry.pool.source}<StripAction
										lead={false}
										size="sm"
										onclick={() => onadd(source)}>{LINES.add}</StripAction
									>{/if}</span
							>
						</li>
					{:else}
						<li class="none">{PANEL.noneFree}</li>
					{/each}
				</ol>
			</div>
		{/if}
	</div>
{:else if beside}
	{@render beside()}
{/if}

<style>
	.positions {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		min-width: 0;
	}

	.panel {
		min-width: 0;
	}

	/* At a desk, one band: the strip at its cards' width, the cards in the rest, as many to a row as
	   fit, the label and the toggle over them; the open list under both, the band's width. */
	.positions.band {
		display: grid;
		grid-template-columns: minmax(min-content, 47rem) minmax(20rem, 1fr);
		align-items: start;
		gap: var(--s-3) var(--s-5);
	}

	.band > .beside {
		grid-column: 1;
		min-width: 0;
	}

	/* On a narrow desk the strip's card words wrap rather than squeeze the cards out of the band. */
	.band > .beside :global(.pickup .text) {
		white-space: normal;
	}

	.band > .panel {
		grid-column: 2;
	}

	.band > .list {
		grid-column: 1 / -1;
	}

	.band .row {
		grid-template-columns: minmax(0, 1fr);
		gap: 6px;
	}

	.band .head {
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
	}

	/* A narrow desk (1024 to 1279): the strip keeps its cards, so the panel's column is narrow; the
	   label sits over the toggle and the toggle's chips stack, as on a phone. */
	@media (max-width: 1279px) {
		.band .head {
			flex-direction: column;
			align-items: flex-start;
		}

		.band .head :global([role='group']) {
			flex-direction: column;
			border-radius: var(--r-md);
		}

		.band .head :global([role='group'] button) {
			border-radius: calc(var(--r-md) - 2px);
		}
	}

	.band .cards {
		grid-auto-flow: row;
		gap: 6px;
		grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
	}

	.band .card-head {
		padding: 3px var(--s-2);
	}

	.band .top,
	.band .figs {
		overflow: hidden;
	}

	/* Three cards to a row: the rank at the small size, so "rank 12 of 12" fits whole. */
	.band .top {
		gap: 4px;
	}

	.band .rank {
		font-size: var(--t-xs);
	}

	.row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: stretch;
		gap: var(--s-3);
		min-width: 0;
	}

	.head {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
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
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: minmax(0, 1fr);
		gap: var(--s-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.cards li {
		min-width: 0;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: var(--bg);
	}

	.cards li.on {
		border-color: color-mix(in srgb, var(--accent) 55%, var(--line-strong));
	}

	.card-head {
		display: flex;
		flex-direction: column;
		gap: 0;
		line-height: 1.25;
		width: 100%;
		padding: 6px var(--s-3);
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.top,
	.figs {
		display: flex;
		align-items: baseline;
		gap: 6px;
		white-space: nowrap;
	}

	.pos {
		font-family: var(--font-num);
		font-size: var(--t-md);
		font-weight: 800;
		letter-spacing: 0.02em;
	}

	.rank {
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.need {
		margin-left: auto;
		padding: 0 6px;
		border-radius: var(--r-pill);
		background: var(--surface-2);
		font-size: var(--t-xs);
		font-weight: 700;
		color: var(--loss-ink);
	}

	.figure {
		font-family: var(--font-num);
		font-size: var(--t-md);
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}

	.median {
		font-size: var(--t-xs);
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.list {
		padding: var(--s-2) var(--s-3);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: var(--bg);
	}

	.list-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--s-1) var(--s-3);
		margin: 0 0 var(--s-2);
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.list-head b {
		font-size: var(--t-sm);
		color: var(--ink);
	}

	.entries {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.entry {
		display: grid;
		grid-template-columns: minmax(0, 13rem) 7rem 6.5rem minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--s-3);
		min-height: 36px;
		border-top: 1px solid var(--line);
		font-size: var(--t-sm);
	}

	/* The list's column heads, as the table's. */
	.entry.heads {
		min-height: 24px;
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
	}

	.entry.heads .fig {
		font-family: inherit;
	}

	.entry.heads + .entry {
		border-top: 0;
	}

	.beats-word {
		display: none;
	}

	.entry:first-child {
		border-top: 0;
	}

	.who {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.who span,
	.mark {
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	/* The member's players and the free agents read apart: his in ink, theirs marked Free in the
	   gain colour, the walk's rostered against available. */
	.free .mark {
		font-weight: 700;
		color: var(--gain-ink);
	}

	.fig {
		font-family: var(--font-num);
		font-weight: 700;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.beats {
		font-size: var(--t-xs);
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}

	.beats.gains {
		color: var(--ink);
	}

	/* The free agents under the member's players, one rule between them. */
	.free.first {
		border-top: 2px solid var(--line-strong);
	}

	.none {
		padding: var(--s-2) 0;
		font-size: var(--t-sm);
		color: var(--ink-3);
	}

	@media (max-width: 760px) {
		/* One row of cards, scrolled sideways inside the panel, the page never: the toggle leads it. */
		.row {
			display: flex;
			overflow-x: auto;
			scrollbar-width: none;
		}

		.head {
			flex: none;
		}

		.head .label {
			display: none;
		}

		/* The toggle's two chips stack, so it is as tall as a card and the panel stays one row. */
		.head :global([role='group']) {
			flex-direction: column;
			border-radius: var(--r-md);
		}

		.head :global([role='group'] button) {
			border-radius: calc(var(--r-md) - 2px);
		}

		.entry.heads {
			display: none;
		}

		.beats-word {
			display: inline;
		}

		.cards {
			grid-auto-columns: 8.5rem;
		}

		.entry {
			grid-template-columns: minmax(0, 1fr) auto auto;
			grid-template-areas:
				'who fig act'
				'mark mark act'
				'beats beats act';
			row-gap: 0;
			padding: 4px 0;
		}

		.who {
			grid-area: who;
		}

		.mark {
			grid-area: mark;
		}

		.fig {
			grid-area: fig;
		}

		.beats {
			grid-area: beats;
		}

		.act {
			grid-area: act;
		}
	}
</style>
