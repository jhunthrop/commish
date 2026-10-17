<script lang="ts">
	import type { Snippet } from 'svelte';
	import WeatherGlyph from '#lib/league/box/WeatherGlyph.svelte';
	import Face from '#lib/ui/Face.svelte';
	import PositionPill from '#lib/ui/PositionPill.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import ToneChip from '#lib/ui/ToneChip.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { clubMark } from '#lib/ui/club-mark.ts';
	import type { Position } from '#lib/types/player.ts';
	import { CARD, type CardTile } from './card.ts';
	import type { CardVerb, NextCell } from './week-words.ts';

	/** The player card (Lane 66h): his face, name, club and position with his status, whose roster he
	 * is on, the week ahead in the box's Game cell form, the one verb and Compare, then one row of
	 * tiles, each naming what it is in a caption. On a phone the verb is pinned above the tab bar. */
	interface Props {
		name: string;
		headshot: string;
		team: string;
		/** His club's city and nickname, and its page. */
		club: { name: string; href: string };
		position: Position;
		/** His designation's mark, null when the capture does not list him. */
		status: { mark: string; sits: boolean } | null;
		/** Whose roster he is on in the league, null with none or until read. */
		holder: string | null;
		/** Whether the page keeps the holder's line its room from the first paint. */
		holdRoom: boolean;
		/** The week ahead as the build knows it, and its cell once read. */
		next: { week: number; opponent: string } | null;
		cell: NextCell | null;
		/** The league screens' verb, null with no league: the sheet's add stands in. */
		verb: CardVerb | null;
		tiles: readonly CardTile[];
		/** Whether Compare is open, and its toggle. */
		comparing: boolean;
		oncompare: () => void;
		/** The sheet's add, the verb with no league. */
		sheet: Snippet;
	}

	let {
		name,
		headshot,
		team,
		club,
		position,
		status,
		holder,
		holdRoom,
		next,
		cell,
		verb,
		tiles,
		comparing,
		oncompare,
		sheet
	}: Props = $props();

	/** The platform's page: his name on the clipboard first, so the platform's search takes it. */
	function openExternal(href: string): void {
		void navigator.clipboard.writeText(name).catch(() => undefined);
		window.open(href, '_blank', 'noopener');
	}
</script>

<section class="card" aria-label={name}>
	<div class="hd">
		<span class="face"><Face src={headshot} size={104} phoneSize={72} loading="eager" /></span>
		<div class="id">
			<h2>{name}</h2>
			<div class="sub">
				<a class="club" href={club.href}
					><img src={clubMark(team)} alt="" width="20" height="20" />{club.name}</a
				>
				<PositionPill {position} />
				{#if status}<ToneChip tone={status.sits ? 'loss' : 'even'}>{status.mark}</ToneChip>{/if}
			</div>
			<p class="holder" class:room={holdRoom}>{holder ?? ''}</p>
		</div>
		{#if next}
			<div class="next">
				<span class="wk">{CARD.week} {next.week}</span>
				<span class="opp"
					><b>{cell?.where ?? next.opponent}</b>{#if cell?.when}<span>{cell.when}</span>{/if}</span
				>
				<span class="facts"
					>{#if cell?.expected}<span class="exp">{cell.expected}</span>{/if}{#if cell?.weather}<span
							class="wx"><WeatherGlyph glyph={cell.weather.glyph} />{cell.weather.words}</span
						>{/if}</span
				>
			</div>
		{/if}
		<div class="act">
			{#if verb === null}
				{@render sheet()}
			{:else if verb.external}
				<Verb size="lg" fill onclick={() => openExternal(verb.href)}>{verb.label}</Verb>
			{:else}
				<Verb size="lg" fill href={verb.href}>{verb.label}</Verb>
			{/if}
			<Quiet size="md" fill expanded={comparing} controls="compare" onclick={oncompare}
				>{CARD.compare}</Quiet
			>
			{#if verb?.note}<p class="note">{verb.note}</p>{/if}
		</div>
	</div>
	<div class="tiles" style:--n={tiles.length}>
		{#each tiles as tile (tile.key)}
			<div class="tile {tile.tone ?? ''}">
				<span class="lb">{tile.label}</span>
				<span class="v"><span class="fig">{tile.value}</span></span>
				<span class="cap">{tile.caption}</span>
			</div>
		{/each}
	</div>
</section>

<style>
	.card {
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--surface);
		overflow: hidden;
	}

	.hd {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto 220px;
		align-items: center;
		gap: var(--s-5);
		padding: var(--s-4) var(--s-5);
	}

	.id {
		min-width: 0;
	}

	h2 {
		margin: 0;
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-display);
		line-height: 0.95;
		text-transform: uppercase;
		letter-spacing: 0.01em;
	}

	.sub {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		flex-wrap: wrap;
		margin-top: var(--s-2);
	}

	.club {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--t-sm);
		font-weight: 500;
		color: var(--ink-2);
		text-decoration: none;
	}

	.club:hover {
		color: var(--ink);
	}

	/* Whose roster he is on: its line kept from the first paint while a league is selected, so the
	   rosters arriving move nothing. */
	.holder {
		display: none;
		margin: var(--s-2) 0 0;
		min-height: 1lh;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.holder.room,
	.holder:not(:empty) {
		display: block;
	}

	.next {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 200px;
		padding-left: var(--s-5);
		border-left: 1px solid var(--line);
	}

	.wk {
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--accent-text);
	}

	.opp {
		display: flex;
		gap: 6px;
		font-size: var(--t-md);
	}

	.opp span {
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}

	.facts {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		min-height: 1lh;
		font-size: var(--t-xs);
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}

	.exp {
		font-family: var(--font-num);
		font-size: var(--t-md);
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--ink-2);
	}

	.wx {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}

	.act {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}

	.note {
		margin: 0;
		font-size: var(--t-xs);
		line-height: 1.4;
		color: var(--ink-3);
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(var(--n), minmax(0, 1fr));
		border-top: 1px solid var(--line);
		background: var(--bg);
	}

	.tile {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
		padding: var(--s-3) var(--s-4);
		border-left: 1px solid var(--line);
	}

	.tile:first-child {
		border-left: 0;
	}

	.lb {
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
		white-space: nowrap;
	}

	.v {
		font-family: var(--font-num);
		font-size: var(--t-2xl);
		font-weight: 800;
		line-height: 1;
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}

	.lead .v {
		color: var(--accent-text);
	}

	.quiet .v {
		font-size: var(--t-xl);
		font-weight: 700;
		color: var(--ink-2);
	}

	/* The opponent's ease: the rank carries it, the tint repeats it. */
	.easy .fig,
	.hard .fig {
		padding: 0 6px;
		border-radius: var(--r-sm);
	}

	.easy .fig {
		background: var(--gain-bg);
		color: var(--gain-ink);
	}

	.hard .fig {
		background: var(--loss-bg);
		color: var(--loss-ink);
	}

	.cap {
		font-size: var(--t-xs);
		line-height: 1.35;
		color: var(--ink-3);
	}

	@media (max-width: 1180px) {
		.hd {
			grid-template-columns: auto minmax(0, 1fr) auto;
		}

		.act {
			grid-column: 1 / -1;
			flex-direction: row;
			flex-wrap: wrap;
		}

		.act > :global(*) {
			flex: 1;
		}

		.note {
			flex-basis: 100%;
		}
	}

	@media (max-width: 760px) {
		.hd {
			grid-template-columns: auto minmax(0, 1fr);
			gap: var(--s-3);
			padding: var(--s-3);
		}

		h2 {
			font-size: var(--t-head);
		}

		.holder {
			font-size: var(--t-xs);
		}

		.next {
			grid-column: 1 / -1;
			flex-flow: row wrap;
			align-items: baseline;
			gap: 4px var(--s-3);
			min-width: 0;
			padding: var(--s-2) 0 0;
			border-left: 0;
			border-top: 1px solid var(--line);
		}

		.wk {
			flex-basis: 100%;
		}

		/* The verb pinned above the tab bar, Compare beside it. */
		.act {
			position: fixed;
			left: var(--s-3);
			right: var(--s-3);
			bottom: calc(var(--tab-bar-h) + var(--s-2));
			z-index: 6;
			flex-wrap: nowrap;
			padding: var(--s-2);
			border: 1px solid var(--line-strong);
			border-radius: var(--r-md);
			background: var(--shell);
			box-shadow: var(--shadow-pop);
		}

		.act > :global(:first-child) {
			flex: 1 1 0;
			min-width: 0;
		}

		.act > :global(:nth-child(2)) {
			flex: 0 0 auto;
			width: auto;
		}

		.note {
			display: none;
		}

		.tiles {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}

		.tile {
			padding: var(--s-2) var(--s-3);
			border-top: 1px solid var(--line);
		}

		.tile:nth-child(3n + 1) {
			border-left: 0;
		}

		.tile:nth-child(-n + 3) {
			border-top: 0;
		}

		.v {
			font-size: var(--t-xl);
		}

		.lb {
			font-size: 10px;
		}

		.cap {
			font-size: 11px;
		}
	}
</style>
