<script lang="ts">
	import type { StatusView } from '#lib/run/status-view.ts';
	import { pillRank } from '#lib/run/held-places.ts';
	import PositionPill from './PositionPill.svelte';
	import ToneChip from './ToneChip.svelte';
	import type { Position } from '#lib/types/player.ts';

	/** A league row's position pill and, when the injury capture lists him, its mark (Lane 63): a
	 * player on a season-long list shows "RB IR", never the rank his figure would earn. The league
	 * row and the box score's player cell (Lane 66d) draw it. Without a rank (a player our order does
	 * not rank) the pill is his position alone. */
	interface Props {
		position: Position;
		positionRank?: number;
		status: StatusView | null;
	}

	let { position, positionRank, status }: Props = $props();
</script>

<PositionPill
	{position}
	rank={positionRank === undefined ? (status?.rank ?? undefined) : pillRank(status, positionRank)}
/>
{#if status}<ToneChip tone={status.sits ? 'loss' : 'even'}>{status.mark}</ToneChip>{/if}
