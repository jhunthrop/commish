<script lang="ts">
	import { DEFAULT_TEAMS, pickLabel } from '#lib/format/draft.ts';
	import type { TeamSlot } from '#lib/types/room.ts';
	import Face from './Face.svelte';
	import Label from './Label.svelte';
	import Panel from './Panel.svelte';
	import { ROOM, teamCount } from '#lib/room/words.ts';

	interface Props {
		title?: string;
		/** Starters in lineup order, then the bench. An open slot has no player. */
		slots: readonly TeamSlot[];
		/** Roster size for the draft: 14 in a standard redraft. */
		rosterSize: number;
		teams?: number;
	}

	let { title = ROOM.yourTeam, slots, rosterSize, teams = DEFAULT_TEAMS }: Props = $props();

	const drafted = $derived(slots.filter((slot) => slot.player !== null).length);
</script>

<Panel>
	<h3>{title}<span>{teamCount(drafted, rosterSize)}</span></h3>
	<ol>
		{#each slots as { slot, player, pick }, i (i)}
			{#if player}
				<li>
					<span class="slot">{slot}</span>
					<Face src={player.headshot} name={player.name} size={32} />
					<span class="who">
						{player.name}
						<Label>{player.position} {player.positionRank} · {player.team}</Label>
					</span>
					<span class="pk">{pick === null ? '' : pickLabel(pick, teams)}</span>
				</li>
			{:else}
				<li class="open">
					<span class="slot">{slot}</span>
					<span class="hole"></span>
					<Label>{ROOM.open}</Label>
				</li>
			{/if}
		{/each}
	</ol>
</Panel>

<style>
	h3 {
		margin: 0 0 var(--s-3);
		font-size: var(--t-md);
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}

	h3 span {
		font-size: var(--t-xs);
		color: var(--ink-3);
		font-weight: 500;
	}

	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	li {
		display: grid;
		grid-template-columns: 40px 32px 1fr auto;
		gap: var(--s-2);
		align-items: center;
		font-size: var(--t-sm);
		min-height: 32px;
	}

	.slot {
		font-size: var(--t-xs);
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--ink-3);
	}

	.who {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.open {
		color: var(--ink-3);
	}

	.open .slot {
		color: var(--accent-text);
	}

	.hole {
		grid-column: 2 / span 2;
		height: 28px;
		border: 1px dashed var(--line-strong);
		border-radius: var(--r-sm);
	}

	.pk {
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		font-size: var(--t-md);
		color: var(--ink-2);
	}
</style>
