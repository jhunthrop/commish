<script lang="ts">
	import { fixed } from '#lib/format/number.ts';
	import type { Snippet } from 'svelte';
	import type { ShownMark } from '#lib/context/held-words.ts';
	import { HELD_FRAMING, framedVorCell, type RowFraming } from '#lib/run/row-framing.ts';
	import type { IndexSeason } from '#lib/run/schema.ts';
	import type { StatusView } from '#lib/run/status-view.ts';
	import type { BoardPlayer, MarketPosition, RangeScale } from '#lib/types/player.ts';
	import AdpCell from './AdpCell.svelte';
	import Face from './Face.svelte';
	import NameWords from './NameWords.svelte';
	import PositionPill from './PositionPill.svelte';
	import RangeBar from './RangeBar.svelte';
	import TierChip from './TierChip.svelte';
	import ToneChip from './ToneChip.svelte';
	import ValueCell from './ValueCell.svelte';
	import { seasonFigures } from './season-figures.ts';

	/** A kicker or a defense in draft order (Lane 66m, the 2026-09-05 ruling): his place among the
	 * players the drafts take, the format's ADP, his face (a defense's is its club's mark), and no
	 * projected points, no tier and no range. */
	interface DraftOrderPlayer {
		orderBasis: 'market';
		name: string;
		position: MarketPosition;
		positionRank: number;
		team: string;
		adp: number;
		ourRank: number;
		face: string | null;
	}

	interface Props {
		/** A ranked player, or a kicker or a defense in draft order. */
		player: BoardPlayer | DraftOrderPlayer;
		/** The player's page. */
		href: string;
		/** The range scale every row in this view shares. */
		scale?: RangeScale;
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
		/** The league's mark, with the component that draws it (HeldMark, loaded with the rosters):
		 * yours, which tints the row with your wash, or a free agent. */
		held?: ShownMark | null;
		/** How the row frames his rank against the drafts, the page's one rule (run/row-framing.ts):
		 * in season the ADP alone and no round. Match the RowHead's. */
		framing: RowFraming;
		/** His injury status when the run's capture lists him (run/status-view.ts): a season-long one
		 * shows as his rank and carries its sentence on a line of its own, a week's carries its mark. */
		status?: StatusView | null;
		/** A kicker's or a defense's place: under a Draft order head (RowHead's market heads) the bare
		 * number in the over replacement track; under a ranked row's heads (ADP) on his position pill,
		 * "K 3", as a ranked row's place is. */
		orderColumn?: boolean;
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
		held = null,
		framing,
		status = null,
		orderColumn = true
	}: Props = $props();

	function inDraftOrder(row: BoardPlayer | DraftOrderPlayer): row is DraftOrderPlayer {
		// A ranked row read from the run carries orderBasis "projection" though its type does not name it.
		return (row as { orderBasis?: unknown }).orderBasis === 'market';
	}

	const ranked = $derived(inDraftOrder(player) ? null : player);
	const drafted = $derived(inDraftOrder(player) ? player : null);
	/** A kicker's or a defense's place, the word standing in for it on a season-long list. */
	const place = $derived(status?.rank ?? drafted?.positionRank ?? null);

	/** A player on a season-long list: his rank is the word, so no tier and no framed rank. */
	const heldOut = $derived(status !== null && status.rank !== null);
	const shownFraming = $derived(heldOut ? HELD_FRAMING : framing);

	const lead = $derived(
		order === 'adp' && player.adp !== null
			? fixed(player.adp)
			: ranked === null
				? ''
				: String(ranked.ourRank)
	);
</script>

<div
	class="row"
	class:mine={held?.kind === 'mine'}
	class:flat={!range}
	class:act={action !== undefined}
	class:act-flat={action !== undefined && !range}
	class:games={season !== undefined}
>
	<!-- A held player's rank shows as the word; in ADP order the lead is the drafters' ADP, kept. -->
	<span class="rk">{order === 'board' ? (status?.rank ?? lead) : lead}</span>
	<span class="face"
		><Face
			src={drafted === null ? (ranked?.headshot ?? null) : drafted.face}
			name={player.name}
			size={40}
			loading={eager ? 'eager' : 'lazy'}
		/>{#if held}<held.Mark words={held.words} kind={held.kind} />{/if}</span
	>
	<span class="who">
		<a class="name" {href}><NameWords name={player.name} /></a>
		<span class="meta" class:seasoned={season !== undefined}>
			{#if ranked}
				<PositionPill position={ranked.position} rank={status?.rank ?? ranked.positionRank} />
				{#if showTier && !heldOut}<span class="wide tier"><TierChip tier={ranked.tier} /></span
					>{/if}
				<span class="wide team">{ranked.team}</span>
				{#if season === undefined}
					<span class="wide">{fixed(ranked.expectedGames)} games</span>
				{:else}
					{@const figures = seasonFigures(season)}
					<span class="season">{figures.perGame}<span class="count">{figures.games}</span></span>
				{/if}
				<span class="narrow">{fixed(ranked.projected)} pts</span>
			{:else if drafted}
				<PositionPill
					position={drafted.position}
					rank={orderColumn ? (status?.rank ?? undefined) : (place ?? undefined)}
				/>
				<span class="wide team">{drafted.team}</span>
			{/if}
		</span>
		{#if status}
			<span class="status">
				{#if status.line}{status.line}{:else}<ToneChip tone={status.sits ? 'loss' : 'even'}
						>{status.mark}</ToneChip
					>{/if}
			</span>
		{/if}
	</span>
	<span class="gp">{season?.games}</span>
	{#if ranked}
		<span class="proj"><ValueCell value={ranked.projected} label={unit} /></span>
		<ValueCell {...framedVorCell(ranked.vor, ranked.vorRound, shownFraming)} phoneLabel={false} />
		{#if range && scale}
			<span class="rng">
				<RangeBar
					floor={ranked.floor ?? 0}
					median={ranked.median ?? 0}
					ceiling={ranked.ceiling ?? 0}
					{scale}
				/>
			</span>
		{/if}
		<AdpCell
			adp={ranked.adp}
			ourRank={ranked.ourRank}
			under={order === 'adp' ? 'rank' : 'adp'}
			compare={shownFraming.compare}
			rankWord={status?.rank ?? null}
		/>
	{:else if drafted}
		<span class="proj"></span>
		<span class="order"
			>{#if orderColumn && status?.rank == null}<b>{drafted.positionRank}</b>{/if}</span
		>
		{#if range}<span class="rng"></span>{/if}
		<!-- In ADP order the lead already prints his ADP, so the drafters' cell is left empty. -->
		<AdpCell
			adp={drafted.adp}
			ourRank={drafted.ourRank}
			under="adp"
			compare={false}
			figure={order !== 'adp'}
			rankWord={status?.rank ?? null}
		/>
	{/if}
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

	.games {
		grid-template-columns: var(--board-cols-games);
	}

	.games.flat {
		grid-template-columns: var(--board-cols-games-flat);
	}

	.games.act {
		grid-template-columns: var(--board-cols-games-act);
	}

	.games.act-flat {
		grid-template-columns: var(--board-cols-games-act-flat);
	}

	/* This season's games, a bare count under the Games head, in a row that carries the season. */
	.gp {
		display: none;
		text-align: right;
		font-family: var(--font-num);
		font-size: var(--t-lg);
		font-variant-numeric: tabular-nums;
	}

	/* A kicker's or a defense's place in draft order, in a ranked row's figure type (ValueCell's), its
	   column head naming it. */
	.order {
		display: flex;
		justify-content: flex-end;
		align-items: center;
	}

	.order b {
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.01em;
		font-weight: 700;
		font-size: var(--t-xl);
		line-height: 1;
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

	/* Your own player's row takes your wash, the one tint that means you. */
	.mine,
	.mine:hover {
		background: var(--accent-wash);
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

	/* A listed player's status, a line of its own under the meta: the season-long sentence wraps. */
	.status {
		font-size: var(--t-sm);
		color: var(--ink-2);
		line-height: 1.3;
	}

	/* His season so far takes the projected games' place. On a desk (1181 px and up) the count has
	   its own Games column and the line prints "25.9 a game"; below it the line prints the count too,
	   "8.2 a game, 3 games", taking a line of its own where the column is under the widest such line
	   (256px, measured on the real run's 536 rows), wrapping its words rather than losing its end. */
	.season {
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}

	@media (min-width: 1181px) {
		.count {
			display: none;
		}

		.games > .gp {
			display: block;
		}
	}

	@media (min-width: 961px) and (max-width: 1439px) {
		.games > .rng {
			display: none;
		}
	}

	/* A 32px mark track holds the disc alone: his place on your sheet is in its name. */
	@media (min-width: 961px) and (max-width: 1180px) {
		.action :global(.place) {
			display: none;
		}

		.action :global(.add) {
			padding-left: 2px;
		}
	}

	@media (min-width: 1181px) and (max-width: 1439px) {
		.games > .action :global(.place) {
			display: none;
		}

		.games > .action :global(.add) {
			padding-left: 2px;
		}
	}

	/* iPad landscape: tighter columns and a 32px face, so the tier chip keeps its room. */
	@media (min-width: 1181px) and (max-width: 1253px) {
		.games {
			column-gap: 9px;
		}

		.games > .face :global(.face) {
			width: 32px;
			height: 32px;
		}
	}

	@media (max-width: 1180px) {
		.gp {
			display: none;
		}

		@container (max-width: 259px) {
			.seasoned {
				flex-wrap: wrap;
				row-gap: 2px;
			}

			.seasoned > .season {
				order: 1;
				flex: 0 0 100%;
				white-space: normal;
			}
		}
	}

	@container (max-width: 204px) {
		.team {
			display: none;
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
		.rng,
		.action {
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
