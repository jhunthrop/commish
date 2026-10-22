<script lang="ts">
	import type { BasisTile, CardTile } from './card.ts';

	/** The player card's tiles (Lane 66h), shared by his page's card and the player shelf (Lane 113):
	 * one row of the week's tiles, each naming what it is in a caption, and in season the row under
	 * them (Lane 100). Three across on a phone, and at every width in the shelf (folded). */
	interface Props {
		tiles: readonly CardTile[];
		basisTiles?: readonly BasisTile[];
		/** Three across at every width: the shelf's 480 px. */
		folded?: boolean;
	}

	let { tiles, basisTiles = [], folded = false }: Props = $props();
</script>

<div class="tiles" class:folded style:--n={tiles.length}>
	{#each tiles as tile (tile.key)}
		<div class="tile {tile.tone ?? ''}">
			<span class="lb">{tile.label}</span>
			<span class="v"><span class="fig">{tile.value}</span></span>
			<span class="cap">{tile.caption}</span>
		</div>
	{/each}
</div>
{#if basisTiles.length > 0}
	<div class="tiles basis" class:folded style:--n={basisTiles.length}>
		{#each basisTiles as tile (tile.key)}
			<div class="tile">
				<span class="lb">{tile.label}</span>
				<span class="v"><span class="fig">{tile.value}</span></span>
				<span class="cap">{tile.caption}</span>
			</div>
		{/each}
	</div>
{/if}

<style>
	.tiles {
		--across: var(--n);
		--tile-pad: var(--s-3) var(--s-4);
		--tile-v: var(--t-2xl);
		--tile-lb: var(--t-xs);
		--tile-cap: var(--t-xs);

		display: grid;
		grid-template-columns: repeat(var(--across), minmax(0, 1fr));
		overflow: hidden;
		border-top: 1px solid var(--line);
		background: var(--bg);
	}

	/* Three across, set once for the shelf and once for a phone. */
	.tiles.folded {
		--across: 3;
		--tile-pad: var(--s-2) var(--s-3);
		--tile-v: var(--t-xl);
		--tile-lb: 10px;
		--tile-cap: 11px;
	}

	.tile {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
		padding: var(--tile-pad);
		/* The rule above and before each tile, at any number across: the tiles' edge clips the outer
		   ones. */
		box-shadow: -1px -1px 0 var(--line);
	}

	/* The row the figures above start from, quieter than the week's. */
	.basis {
		background: var(--surface);
	}

	.basis .v {
		font-size: var(--t-xl);
	}

	.lb {
		font-size: var(--tile-lb);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
		white-space: nowrap;
	}

	.v {
		font-family: var(--font-num);
		font-size: var(--tile-v);
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
		font-size: var(--tile-cap);
		line-height: 1.35;
		color: var(--ink-3);
	}

	@media (max-width: 760px) {
		.tiles {
			--across: 3;
			--tile-pad: var(--s-2) var(--s-3);
			--tile-v: var(--t-xl);
			--tile-lb: 10px;
			--tile-cap: 11px;
		}

		/* The row under the tiles one to a line, so our rate's steps from his Avg have the phone's width
		   (Lane 139 fix round 1). */
		.tiles.basis {
			--across: 1;
		}
	}

	.tiles.basis.folded {
		--across: 1;
	}
</style>
