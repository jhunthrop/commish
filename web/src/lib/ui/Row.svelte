<script lang="ts">
	import { draftersGap } from '#lib/format/draft.ts';
	import { fixed } from '#lib/format/number.ts';
	import type { BoardPlayer, RangeScale } from '#lib/types/player.ts';
	import Face from './Face.svelte';
	import GapChip from './GapChip.svelte';
	import Label from './Label.svelte';
	import PositionPill from './PositionPill.svelte';
	import RangeBar from './RangeBar.svelte';
	import TierChip from './TierChip.svelte';
	import ValueCell from './ValueCell.svelte';
	import { vorCell } from './heat.ts';

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
	}

	let { player, href, scale, showTier, unit, eager = false, range = true }: Props = $props();

	const adpLabel = $derived(player.adp === null ? 'Not in ADP' : `ADP ${fixed(player.adp)}`);
</script>

<div class="row" class:flat={!range}>
	<span class="rk">{player.ourRank}</span>
	<Face src={player.headshot} size={40} loading={eager ? 'eager' : 'lazy'} />
	<span class="who">
		<a class="name" {href}>{player.name}</a>
		<span class="meta">
			<PositionPill position={player.position} rank={player.positionRank} />
			{#if showTier}<TierChip tier={player.tier} />{/if}
			<span class="wide">{player.team}</span>
			<span class="wide">{fixed(player.expectedGames)} games</span>
			<span class="narrow">{fixed(player.projected)} pts</span>
		</span>
	</span>
	<span class="proj"><ValueCell value={player.projected} label={unit} /></span>
	<ValueCell {...vorCell(player.vor, player.vorRound)} />
	{#if range}
		<span class="rng">
			<RangeBar floor={player.floor} median={player.median} ceiling={player.ceiling} {scale} />
		</span>
	{/if}
	<span class="adp">
		<GapChip gap={draftersGap(player.adp, player.ourRank)} />
		<Label size="cell">{adpLabel}</Label>
	</span>
</div>

<style>
	.row {
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

	.row:hover {
		background: var(--surface);
	}

	.rk {
		font-size: var(--t-sm);
		color: var(--ink-3);
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.who {
		min-width: 0;
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

	.name:hover {
		text-decoration: underline;
	}

	.meta {
		display: flex;
		align-items: center;
		gap: 6px;
		overflow: hidden;
		font-size: var(--t-sm);
		color: var(--ink-3);
		white-space: nowrap;
	}

	.narrow {
		display: none;
	}

	.adp {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: flex-start;
		gap: 3px;
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
		.wide {
			display: none;
		}

		.narrow {
			display: inline;
		}
	}
</style>
