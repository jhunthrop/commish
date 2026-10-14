<script lang="ts">
	import type { LeagueBoard } from './board.ts';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import type { LeagueHost, RosterSpot } from './api.ts';
	import LeagueRow from './LeagueRow.svelte';
	import { hostWords, rowOf, spotStatus } from './model.ts';

	/** Your roster as the host has it set: starters in lineup order, then the bench, injured reserve
	 * and the taxi squad, each player with his place on our board, his bye and your sheet's tags. The
	 * slot words are where he is on the host, never advice: our start and sit call is its own tool. */
	interface Props {
		roster: readonly RosterSpot[];
		board: LeagueBoard;
		tagsOf: (boardId: string | null) => readonly string[];
		host: LeagueHost;
	}

	let { roster, board, tagsOf, host }: Props = $props();

	const SLOT_WORDS: Readonly<Record<RosterSpot['slot'], string>> = {
		starter: 'Starting',
		bench: 'Bench',
		reserve: 'IR',
		taxi: 'Taxi'
	};
</script>

<Panel as="section" label="Your roster" padding="none">
	<div class="head">
		<PanelHead title={`Your roster as set on ${hostWords(host)}`} aside="Points a game" level={2} />
	</div>
	{#each roster as spot (spot.player.host_id)}
		<LeagueRow
			player={rowOf(board, spot.player)}
			host={spot.player}
			tags={tagsOf(spot.player.board_id)}
			slot={SLOT_WORDS[spot.slot]}
			status={spotStatus(spot)}
		/>
	{/each}
</Panel>

<style>
	.head {
		padding: var(--s-3) var(--s-3) var(--s-2);
	}
</style>
