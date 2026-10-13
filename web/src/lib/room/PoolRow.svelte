<script lang="ts">
	import Face from '#lib/ui/Face.svelte';
	import Label from '#lib/ui/Label.svelte';
	import OddsCell from '#lib/ui/OddsCell.svelte';
	import PositionPill from '#lib/ui/PositionPill.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import ValueCell from '#lib/ui/ValueCell.svelte';
	import { vorCell } from '#lib/ui/heat.ts';
	import type { RoomPlayer } from './model.ts';

	interface Props {
		player: RoomPlayer;
		/** His chance of lasting to your next pick, null past the card's depth; undefined draws no odds
		 * cell at all. */
		odds: number | null | undefined;
		/** What the odds are of: "still there at 6.05". */
		oddsLabel: string;
		/** What the odds cell says with no chance to show. */
		oddsMissing: string;
		/** Where drafters take him against the pick on the clock, in words. */
		adp: string;
		/** Our call's row, washed in the accent. */
		isCall: boolean;
		/** The row the arrow keys are on. */
		selected: boolean;
		queued: boolean;
		/** Draft is drawn only when the pick is yours to make (P3: no verb for a decision you cannot
		 * make yet), and pressable while nothing else is in flight. */
		draftShown: boolean;
		canDraft: boolean;
		/** A draft read, never drafted in: no Queue or Draft. */
		readonly: boolean;
		ondraft: () => void;
		onqueue: () => void;
		/** A tap marks the row; on a phone the marked row shows its Queue and Draft. */
		onselect: () => void;
	}

	let {
		player,
		odds,
		oddsLabel,
		oddsMissing,
		adp,
		isCall,
		selected,
		queued,
		draftShown,
		canDraft,
		readonly,
		ondraft,
		onqueue,
		onselect
	}: Props = $props();
</script>

<!-- The row's own click marks it, the way the arrow keys do; its buttons act. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
	class="row"
	class:call={isCall}
	class:selected
	aria-current={selected ? 'true' : undefined}
	onclick={readonly ? undefined : onselect}
>
	<Face src={player.headshot} name={player.name} size={40} />
	<span class="who">
		<b>{player.name}</b>
		<span class="meta">
			<PositionPill position={player.position} rank={player.positionRank} />{player.team}
		</span>
	</span>
	{#if player.vor !== null && player.vorRound !== null}
		<ValueCell {...vorCell(player.vor, player.vorRound)} />
	{:else}
		<span class="none"><b>–</b><Label size="cell">no projection</Label></span>
	{/if}
	{#if odds !== undefined}<OddsCell {odds} label={oddsLabel} missing={oddsMissing} />{/if}
	<span class="adp">{adp}</span>
	{#if !readonly}
		<span class="acts">
			<span class="q"><Quiet size="sm" onclick={onqueue}>{queued ? 'Queued' : 'Queue'}</Quiet></span
			>
			{#if draftShown}<Quiet size="sm" disabled={!canDraft} onclick={ondraft}>Draft</Quiet>{/if}
		</span>
	{/if}
</div>

<style>
	.row {
		display: grid;
		grid-template-columns: var(--pool-cols);
		align-items: center;
		column-gap: var(--s-3);
		min-height: var(--row-h);
		padding: 4px var(--s-3);
		border-bottom: 1px solid var(--line);
	}

	.call {
		background: var(--accent-wash);
	}

	.selected {
		outline: 2px solid var(--focus);
		outline-offset: -2px;
	}

	.who {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.who b {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.meta {
		display: flex;
		gap: 6px;
		align-items: center;
		font-size: var(--t-sm);
		color: var(--ink-3);
	}

	.none {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		padding: 0 var(--s-3);
		color: var(--ink-3);
	}

	.none b {
		font-family: var(--font-num);
		font-size: var(--t-xl);
		line-height: 1;
	}

	.adp {
		text-align: right;
		font-size: var(--t-xs);
		line-height: 1.25;
		color: var(--ink-2);
	}

	.acts {
		display: flex;
		gap: 6px;
		justify-content: flex-end;
	}

	@media (max-width: 1180px) {
		.q {
			display: none;
		}
	}

	@media (max-width: 760px) {
		.row {
			padding: 4px 0;
			column-gap: var(--s-2);
		}

		.adp,
		.acts {
			display: none;
		}

		.selected .acts {
			display: flex;
			grid-column: 1 / -1;
			padding: var(--s-2) 0;
		}

		.selected .q {
			display: inline;
		}
	}
</style>
