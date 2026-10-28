<script lang="ts">
	import type { StatusView } from '#lib/run/status-view.ts';
	import { pillRank } from '#lib/run/held-places.ts';
	import PositionPill from './PositionPill.svelte';
	import StatusChip from './StatusChip.svelte';
	import type { Position } from '#lib/types/player.ts';

	/** A league row's position pill and, when the injury capture lists him, its mark (Lane 63): a
	 * player on a season-long list shows "RB IR", never the rank his figure would earn. The league
	 * row and the box score's player cell (Lane 66d) draw it. Without a rank (a player our order does
	 * not rank) the pill is his position alone. The board row (Lane 66n) and the player card draw it
	 * too; its chip is StatusChip. */
	interface Props {
		position: Position;
		positionRank?: number;
		status: StatusView | null;
	}

	let { position, positionRank, status }: Props = $props();
</script>

<!-- The trade rows' tight cell (BoxPlayer tight, Lane 268) draws this pill's rank rule itself, beside
     its short chip: a change to the rule here is made there too. -->
<PositionPill
	{position}
	rank={positionRank === undefined ? (status?.rank ?? undefined) : pillRank(status, positionRank)}
/>
{#if status}<StatusChip {status} />{/if}
