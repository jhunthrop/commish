<script lang="ts">
	import { fixed } from '#lib/format/number.ts';
	import type { Snippet } from 'svelte';
	import type { IndexSeason } from '#lib/run/schema.ts';
	import type { BoardPlayer, RangeScale } from '#lib/types/player.ts';
	import AdpCell from './AdpCell.svelte';
	import Face from './Face.svelte';
	import HeldMark from './HeldMark.svelte';
	import NameWords from './NameWords.svelte';
	import PositionPill from './PositionPill.svelte';
	import RangeBar from './RangeBar.svelte';
	import TierChip from './TierChip.svelte';
	import ValueCell from './ValueCell.svelte';
	import { vorCell } from './heat.ts';
	import { seasonParts } from './season-figures.ts';

	interface Props {
		player: BoardPlayer;
		/** The player's page. */
		href: string;
		/** The range scale every row in this view shares. */
		scale: RangeScale;
		/** The All view carries the tier as a chip. A position view draws tier strips instead. */
		showTier: boolean;
		/** The scoring the points are in, as the cell label prints it: "PPR pts". */
		unit: string;
		/** Faces in the first screen of a prerendered board load eagerly. */
		eager?: boolean;
		/** The floor to ceiling column, on unless the view switches it off. Match the RowHead above. */
		range?: boolean;
		/** The row's sheet control at its end (SheetMark). Off the phone, where the whole row opens his
		 * page and the page carries the verb. Anything in it marked data-reveal shows only while the row is
		 * hovered or holds focus, so a board of 400 rows does not print 400 verbs. Match the RowHead's action. */
		action?: Snippet;
		/** What the row is ordered by. board leads with our rank and names his ADP at the end. adp
		 * leads with his ADP, the order drafters take players in, and names our rank at the end. */
		order?: 'board' | 'adp';
		/** His season so far, passed once the run is past the season's first kickoff: the meta line
		 * prints "18.4 a game, 5 games" in place of his projected games, and the page's basis line
		 * names it. Left out, the row is the preseason row. */
		season?: IndexSeason;
		/** A team in your league holds him (HeldMark): whose, in words, and whether it is yours. */
		held?: { words: string; mine: boolean } | null;
	}

	let {
		player,
		href,
		scale,
		showTier,
		unit,
		eager = false,
		range = true,
		action,
		order = 'board',
		season,
		held = null
	}: Props = $props();

	const lead = $derived(
		order === 'adp' && player.adp !== null ? fixed(player.adp) : String(player.ourRank)
	);
</script>

<div
	class="row"
	class:flat={!range}
	class:act={action !== undefined}
	class:act-flat={action !== undefined && !range}
>
	<span class="rk">{lead}</span>
	<span class="face"
		><Face src={player.headshot} size={40} loading={eager ? 'eager' : 'lazy'} />{#if held}<HeldMark
				{...held}
			/>{/if}</span
	>
	<span class="who">
		<a class="name" {href}><NameWords name={player.name} /></a>
		<span class="meta" class:seasoned={season !== undefined}>
			<PositionPill position={player.position} rank={player.positionRank} />
			{#if showTier}<span class="wide tier"><TierChip tier={player.tier} /></span>{/if}
			<span class="wide team">{player.team}</span>
			{#if season === undefined}
				<span class="wide">{fixed(player.expectedGames)} games</span>
			{:else}
				{@const parts = seasonParts(season)}
				<span class="season"
					>{parts.perGame}{#if parts.games !== null}<span class="games">{parts.games}</span
						>{/if}</span
				>
			{/if}
			<span class="narrow">{fixed(player.projected)} pts</span>
		</span>
	</span>
	<span class="proj"><ValueCell value={player.projected} label={unit} /></span>
	<ValueCell {...vorCell(player.vor, player.vorRound)} phoneLabel={false} />
	{#if range}
		<span class="rng">
			<RangeBar floor={player.floor} median={player.median} ceiling={player.ceiling} {scale} />
		</span>
	{/if}
	<AdpCell adp={player.adp} ourRank={player.ourRank} under={order === 'adp' ? 'rank' : 'adp'} />
	{#if action}<span class="action">{@render action()}</span>{/if}
</div>

<style>
	/* The name's link stretches over the whole row, so the face, the numbers and the empty space all
	   open his page. The action sits above it. */
	.row {
		position: relative;
		display: grid;
		grid-template-columns: var(--board-cols);
		align-items: center;
		column-gap: var(--s-3);
		min-height: var(--row-h);
		padding: 4px var(--s-3);
		border-bottom: 1px solid var(--line);
	}

	.flat {
		grid-template-columns: var(--board-cols-flat);
	}

	.act {
		grid-template-columns: var(--board-cols-act);
	}

	.act-flat {
		grid-template-columns: var(--board-cols-act-flat);
	}

	.action {
		position: relative;
		z-index: 1;
		display: flex;
		justify-content: flex-end;
	}

	.action :global([data-reveal]) {
		opacity: 0;
	}

	.row:hover .action :global([data-reveal]),
	.row:focus-within .action :global([data-reveal]) {
		opacity: 1;
	}

	@media (hover: none) {
		.action :global([data-reveal]) {
			opacity: 1;
		}
	}

	.row:hover {
		background: var(--surface);
	}

	/* The face's box, kept for every row, so a held mark arriving over its edge moves nothing. */
	.face {
		position: relative;
		display: inline-grid;
	}

	.rk {
		font-size: var(--t-sm);
		color: var(--ink-3);
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.who {
		min-width: 0;
		container-type: inline-size;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.name {
		font-weight: 600;
		font-size: var(--t-md);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-decoration: none;
	}

	.name::after {
		content: '';
		position: absolute;
		inset: 0;
	}

	.row:hover .name {
		text-decoration: underline;
	}

	/* Every item keeps its whole width: a unit is never clipped. The widest line with the club
	   ("WR 6 · T3 · NO · 14.6 games") needs 201px, so only a narrower column drops the club (his page
	   still names it), and below 170px the tier chip goes too. */
	.meta {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--t-sm);
		color: var(--ink-3);
		white-space: nowrap;
	}

	.meta > :global(*) {
		flex: none;
	}

	/* His season so far takes the projected games' place: "18.4 a game". The count after it prints
	   only where the figures have a line of their own; on the meta line the basis line's "through
	   week 5" and his page carry it. */
	.season {
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}

	.games {
		display: none;
	}

	@container (max-width: 204px) {
		.team {
			display: none;
		}
	}

	/* In season the meta line with the club and the tier chip ("WR 12 · T3 · LAR · 18.4 a game") fits
	   the 210px player column of the board at 1440, measured on the stand-in's 400 rows. A column
	   under the pill and the figures (the phone, and 760 to 960px) gives the figures a line of their
	   own with the games count, wrapping their words rather than losing their end. */
	@container (max-width: 196px) {
		.seasoned {
			flex-wrap: wrap;
			row-gap: 2px;
		}

		.seasoned > .season {
			order: 1;
			flex: 0 0 100%;
			white-space: normal;
		}

		.seasoned .games {
			display: inline;
		}
	}

	@container (max-width: 170px) {
		.tier {
			display: none;
		}
	}

	.narrow {
		display: none;
	}

	@media (max-width: 960px) {
		.rng {
			display: none;
		}
	}

	@media (max-width: 760px) {
		.row {
			column-gap: var(--s-2);
			padding: 4px 0;
		}

		.rk,
		.proj,
		.wide,
		.action {
			display: none;
		}

		.narrow {
			display: inline;
		}

		/* A long name takes a second line rather than losing its end: "Jaxon Smith-Njigba". */
		.name {
			white-space: normal;
			display: -webkit-box;
			-webkit-box-orient: vertical;
			-webkit-line-clamp: 2;
			line-clamp: 2;
			line-height: 1.2;
		}
	}
</style>
