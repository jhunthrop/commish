<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { RoomPlayer } from '#lib/room/model.ts';
	import { tagMarks } from '#lib/sheet/tags.ts';
	import Face from '#lib/ui/Face.svelte';
	import Label from '#lib/ui/Label.svelte';
	import NameWords from '#lib/ui/NameWords.svelte';
	import PositionPill from '#lib/ui/PositionPill.svelte';
	import TagChip from '#lib/ui/TagChip.svelte';
	import ValueCell from '#lib/ui/ValueCell.svelte';
	import { vorCell } from '#lib/ui/heat.ts';
	import type { LeaguePlayer } from './api.ts';

	/** One player of the league as a board row: his face, his place on our board at his position, his
	 * team and bye, your sheet's tags on him, and the row's number at its end. A player we could not
	 * place on our board keeps the host's name, position and team, and says so. */
	interface Props {
		/** The board's row for him, null when we could not place him. */
		player: RoomPlayer | null;
		/** The host's own words for him. */
		host: LeaguePlayer;
		/** Your sheet's tags on him. */
		tags?: readonly string[];
		/** A slot label before the row: "Bench", "IR". */
		slot?: string;
		/** The row's number, at its end. Left out, the row shows his value over replacement. */
		trailing?: Snippet;
	}

	let { player, host, tags = [], slot, trailing }: Props = $props();

	/** His value cell, null with no projection or when we could not place him. */
	const cell = $derived.by(() => {
		if (player === null) return null;
		const { vor, vorRound } = player;
		return vor !== null && vorRound !== null ? vorCell(vor, vorRound) : null;
	});
</script>

<div class="row" class:slotted={slot !== undefined}>
	{#if slot !== undefined}<span class="slot"><Label size="cell">{slot}</Label></span>{/if}
	<Face src={player?.headshot ?? null} name={player?.name ?? host.name} size={32} />
	<span class="who">
		<b><NameWords name={player?.name ?? host.name} /></b>
		<span class="meta">
			{#if player}
				<PositionPill position={player.position} rank={player.positionRank} />
				<span>{player.team}</span>
				{#if player.bye !== null}<span>bye {player.bye}</span>{/if}
			{:else}
				<span>{host.position} {host.team}</span>
				<span>not on our board</span>
			{/if}
		</span>
		{#if tags.length > 0}
			<span class="tags">
				{#each tagMarks(tags) as mark (mark.label)}<TagChip
						label={mark.label}
						tone={mark.tone}
					/>{/each}
			</span>
		{/if}
	</span>
	<span class="end">
		{#if trailing}
			{@render trailing()}
		{:else if cell}
			<ValueCell {...cell} phoneLabel={false} />
		{:else}
			<Label size="cell">no projection</Label>
		{/if}
	</span>
</div>

<style>
	.row {
		display: grid;
		grid-template-columns: 32px minmax(0, 1fr) auto;
		align-items: center;
		column-gap: var(--s-3);
		min-height: var(--row-h);
		padding: 4px var(--s-3);
		border-bottom: 1px solid var(--line);
	}

	.slotted {
		grid-template-columns: 3.5em 32px minmax(0, 1fr) auto;
	}

	.who {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.who b {
		font-weight: 600;
		overflow: hidden;
	}

	.meta {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		font-size: var(--t-sm);
		color: var(--ink-2);
		flex-wrap: wrap;
	}

	.tags {
		display: flex;
		gap: var(--s-1);
		flex-wrap: wrap;
	}

	.end {
		justify-self: end;
		text-align: right;
	}
</style>
