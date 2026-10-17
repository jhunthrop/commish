<script lang="ts">
	import { firstSentence } from '#lib/format/sentence.ts';
	import type { RoomCard } from '#lib/room/api.ts';
	import type { Board } from '#lib/room/model.ts';
	import StillThereCell from '#lib/ui/StillThereCell.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import PlayerLine from '#lib/ui/PlayerLine.svelte';
	import RangeBar from '#lib/ui/RangeBar.svelte';
	import type { OutcomeRange } from './api.ts';

	/** The players we would take next, in order, each with his chance of lasting to your next pick.
	 * With full_reasoning each carries our why; with range_of_outcomes his floor, median and ceiling
	 * on one shared scale. */
	interface Props {
		card: RoomCard;
		board: Board;
		/** What the chances are of: "still there at 6.05". */
		chanceLabel: string;
		ranges: Readonly<Record<string, OutcomeRange>> | null;
	}

	let { card, board, chanceLabel, ranges }: Props = $props();

	const rows = $derived(
		// The call has its own panel: the list is who comes after him.
		card.shortlist
			.filter((c) => c.player_id !== card.call)
			.flatMap((c) => {
				const player = board.byId.get(c.player_id);
				const why = c.why ? firstSentence(c.why) : null;
				return player ? [{ player, why, range: ranges?.[c.player_id] ?? null }] : [];
			})
	);
	const scale = $derived.by(() => {
		const all = rows.flatMap((r) => (r.range ? [r.range.floor, r.range.ceiling] : []));
		return all.length === 0 ? null : { lo: Math.min(...all), hi: Math.max(...all) };
	});
</script>

<Panel as="section" label="Who we would take next">
	<div class="list">
		<PanelHead title="Who we would take next" aside="Chance he lasts" />
		{#each rows as row (row.player.id)}
			<div class="row">
				<div class="who">
					<PlayerLine
						name={row.player.name}
						position={row.player.position}
						positionRank={row.player.positionRank}
						team={row.player.team}
						headshot={row.player.headshot}
						size={40}
					/>
					{#if row.why}<p class="why">{row.why}</p>{/if}
					{#if row.range && scale}
						<div class="range">
							<RangeBar
								floor={row.range.floor}
								median={row.range.median}
								ceiling={row.range.ceiling}
								{scale}
							/>
						</div>
					{/if}
				</div>
				<StillThereCell chance={card.still_there[row.player.id] ?? null} label={chanceLabel} />
			</div>
		{/each}
	</div>
</Panel>

<style>
	.list {
		display: flex;
		flex-direction: column;
	}

	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 132px;
		gap: var(--s-3);
		align-items: center;
		padding: var(--s-2) 0;
		border-top: 1px solid var(--line);
	}

	.who {
		display: flex;
		flex-direction: column;
		gap: var(--s-1);
		min-width: 0;
	}

	.why {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.range {
		display: flex;
		flex-direction: column;
		gap: var(--s-1);
		max-width: 360px;
	}

	@media (max-width: 760px) {
		.row {
			grid-template-columns: minmax(0, 1fr) 96px;
		}
	}
</style>
