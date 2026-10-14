<script lang="ts">
	import { count } from '#lib/format/number.ts';
	import type { LeagueBoardPlayer } from './board.ts';
	import { POSITIONS, type Position } from '#lib/types/player.ts';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import LeagueRow from './LeagueRow.svelte';

	/** Our board with only the players nobody in your league holds: the waiver pool, ranked by points
	 * over replacement for your league, a position at a time if you like, with your sheet's tags. */
	interface Props {
		rows: readonly LeagueBoardPlayer[];
		tagsOf: (boardId: string | null) => readonly string[];
		/** How the rows are ranked, said once above them. */
		basis: string;
		/** Once the season is on the rows end on points a game, the projection beside them. */
		inSeason: boolean;
		/** Positions the league starts that the run does not rank: "No kickers on this run." */
		missing: readonly string[];
	}

	let { rows, tagsOf, basis, inSeason, missing }: Props = $props();

	const FIRST_ROWS = 25;
	const MORE_ROWS = 25;

	let position = $state<Position | null>(null);
	let shown = $state(FIRST_ROWS);

	/** The rows' own order, as basis says. */
	const visible = $derived(position === null ? rows : rows.filter((r) => r.position === position));

	/** Only the positions the board ranks: a run without kickers offers no K chip. */
	const positions = $derived(POSITIONS.filter((p) => rows.some((r) => r.position === p)));

	function choose(next: Position | null): void {
		position = next;
		shown = FIRST_ROWS;
	}
</script>

<Panel as="section" label="Waiver pool" padding="none">
	<div class="head">
		<PanelHead title="Waiver pool" aside={`${count(visible.length)} players`} level={2} />
		<p class="basis">{basis}</p>
		<ChipGroup label="Position">
			<Chip size="sm" pressed={position === null} onclick={() => choose(null)}>All</Chip>
			{#each positions as p (p)}
				<Chip size="sm" pressed={position === p} onclick={() => choose(p)}>{p}</Chip>
			{/each}
		</ChipGroup>
		{#each missing as line (line)}<p class="basis">{line}</p>{/each}
	</div>
	{#each visible.slice(0, shown) as player (player.id)}
		<LeagueRow
			{player}
			host={{
				host_id: player.id,
				board_id: player.id,
				name: player.name,
				position: player.position,
				team: player.team,
				injured_reserve: false
			}}
			tags={tagsOf(player.id)}
			endsOnValue={!inSeason}
		/>
	{:else}
		<p class="none">Every player we rank at this position is on a roster in your league.</p>
	{/each}
	{#if visible.length > shown}
		<div class="more">
			<Quiet size="sm" onclick={() => (shown += MORE_ROWS)}>Show {MORE_ROWS} more</Quiet>
		</div>
	{/if}
</Panel>

<style>
	.head {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		padding: var(--s-3);
	}

	.basis {
		margin: 0;
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.none {
		margin: 0;
		padding: var(--s-3);
		color: var(--ink-2);
	}

	.more {
		padding: var(--s-3);
	}
</style>
