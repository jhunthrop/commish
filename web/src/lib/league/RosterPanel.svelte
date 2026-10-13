<script lang="ts">
	import type { LeagueBoard } from './board.ts';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import type { RosterSpot } from './api.ts';
	import LeagueRow from './LeagueRow.svelte';
	import { rowOf } from './model.ts';

	/** Your roster as the host has it: starters in lineup order, then the bench, injured reserve and
	 * the taxi squad, each player with his place on our board, his bye and your sheet's tags. */
	interface Props {
		roster: readonly RosterSpot[];
		board: LeagueBoard;
		tagsOf: (boardId: string | null) => readonly string[];
		/** Whose numbers the rows carry. */
		basis: string;
	}

	let { roster, board, tagsOf, basis }: Props = $props();

	const SLOT_WORDS: Readonly<Record<RosterSpot['slot'], string>> = {
		starter: 'Start',
		bench: 'Bench',
		reserve: 'IR',
		taxi: 'Taxi'
	};
</script>

<Panel as="section" label="Your roster" padding="none">
	<div class="head">
		<PanelHead title="Your roster" aside="Points a game" level={2} />
		<p class="basis">{basis}</p>
	</div>
	{#each roster as spot (spot.player.host_id)}
		<LeagueRow
			player={rowOf(board, spot.player)}
			host={spot.player}
			tags={tagsOf(spot.player.board_id)}
			slot={SLOT_WORDS[spot.slot]}
		/>
	{/each}
</Panel>

<style>
	.head {
		padding: var(--s-3) var(--s-3) var(--s-2);
	}

	.basis {
		margin: var(--s-1) 0 0;
		font-size: var(--t-xs);
		color: var(--ink-3);
	}
</style>
