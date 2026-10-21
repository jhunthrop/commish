<script lang="ts">
	import type { Snippet } from 'svelte';
	import StatusPill from '#lib/ui/StatusPill.svelte';
	import type { StatusView } from '#lib/run/status-view.ts';
	import Face from '#lib/ui/Face.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { clubMark } from '#lib/ui/club-mark.ts';
	import type { Position } from '#lib/types/player.ts';
	import { CARD, type BasisTile, type CardHead, type CardTile } from './card.ts';
	import CardNext from './CardNext.svelte';
	import CardTiles from './CardTiles.svelte';
	import type { CardVerb, NextCell } from './week-words.ts';

	/** The player card (Lane 66h): his face, name, club and position with his status, whose roster he
	 * is on, the week ahead in the box's Game cell form, the one verb and Compare, then one row of
	 * tiles, each naming what it is in a caption. On a phone the verb is pinned above the tab bar. */
	interface Props {
		name: string;
		headshot: string;
		team: string;
		/** His club's city and nickname, and its page; null for a free agent (Lane 123), whose club cell
		 * is team ("FA") with no mark and no page. */
		club: { name: string; href: string } | null;
		position: Position;
		/** His designation as Lane 63 says it, null when the capture does not list him: the shared
		 * pill draws it with his rank (IR for a season-long list). */
		status: StatusView | null;
		/** His place at his position in our order. */
		positionRank: number;
		/** Whose roster he is on in the league, null with none or until read. */
		holder: string | null;
		/** Whether the page keeps the holder's line its room from the first paint. */
		holdRoom: boolean;
		/** The week the card shows: the read's once it is in, the build's before, with its game or
		 * "Bye"; and the game's cell once read. */
		next: CardHead | null;
		cell: NextCell | null;
		/** The league screens' verb, null with no league: the sheet's add stands in. */
		verb: CardVerb | null;
		tiles: readonly CardTile[];
		/** In season, the row under the tiles (Lane 100): his preseason figures and vs Avg. */
		basisTiles: readonly BasisTile[];
		/** His lineup verb no longer fits the week (Lane 100, B64): Compare is the one verb. */
		compareLeads: boolean;
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
		positionRank,
		holder,
		holdRoom,
		next,
		cell,
		verb,
		tiles,
		basisTiles,
		compareLeads,
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
				{#if club}<a class="club" href={club.href}
						><img src={clubMark(team)} alt="" width="20" height="20" />{club.name}</a
					>{:else}<span class="club">{team}</span>{/if}
				<StatusPill {position} {positionRank} {status} />
			</div>
			<p class="holder" class:room={holdRoom}>{holder ?? ''}</p>
		</div>
		{#if next}
			<div class="next"><CardNext week={next.week} opponent={next.opponent} {cell} /></div>
		{/if}
		<div class="act">
			{#if compareLeads}
				<Verb size="lg" fill expanded={comparing} controls="compare" onclick={oncompare}
					>{CARD.compare}</Verb
				>
			{:else if verb === null}
				{@render sheet()}
			{:else if verb.external}
				<Verb size="lg" fill onclick={() => openExternal(verb.href)}>{verb.label}</Verb>
			{:else}
				<Verb size="lg" fill href={verb.href}>{verb.label}</Verb>
			{/if}
			{#if !compareLeads}
				<Quiet size="md" fill expanded={comparing} controls="compare" onclick={oncompare}
					>{CARD.compare}</Quiet
				>
			{/if}
			{#if verb?.note}<p class="note">{verb.note}</p>{/if}
		</div>
	</div>
	<CardTiles {tiles} {basisTiles} />
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

	a.club:hover {
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
		min-width: 200px;
		padding-left: var(--s-5);
		border-left: 1px solid var(--line);
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
			min-width: 0;
			padding: var(--s-2) 0 0;
			border-left: 0;
			border-top: 1px solid var(--line);
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
	}
</style>
