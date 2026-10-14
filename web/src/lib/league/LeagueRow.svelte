<script lang="ts">
	import type { Snippet } from 'svelte';
	import { plural } from '#lib/format/number.ts';
	import { tagMarks } from '#lib/sheet/tags.ts';
	import { links } from '#lib/site/links.ts';
	import Face from '#lib/ui/Face.svelte';
	import type { FaceStatus } from '#lib/ui/face-status.ts';
	import Label from '#lib/ui/Label.svelte';
	import NameWords from '#lib/ui/NameWords.svelte';
	import PositionPill from '#lib/ui/PositionPill.svelte';
	import TagChip from '#lib/ui/TagChip.svelte';
	import ValueCell from '#lib/ui/ValueCell.svelte';
	import { vorCell } from '#lib/ui/heat.ts';
	import type { LeaguePlayer } from './api.ts';
	import type { LeagueBoardPlayer } from './board.ts';
	import { projectionWords, seasonWords } from './model.ts';

	/** One player of the league as a board row: his name, which opens his game log, his place on our
	 * board at his position, his team and bye, his preseason projection, your sheet's tags on him,
	 * and the row's number at its end: his points a game this season, unless the row ends on its own
	 * number or on his value over replacement, when his season sits beside the projection. A player
	 * we could not place on our board keeps the host's name, position and team, and says so. */
	interface Props {
		/** The board's row for him, null when we could not place him. */
		player: LeagueBoardPlayer | null;
		/** The host's own words for him. */
		host: LeaguePlayer;
		/** Your sheet's tags on him. */
		tags?: readonly string[];
		/** A slot label before the row: "Bench", "IR". */
		slot?: string;
		/** His roster status, marked on his face: on injured reserve. */
		status?: FaceStatus | null;
		/** The row's number, at its end. Left out, the row ends on his points a game this season. */
		trailing?: Snippet;
		/** End on his value over replacement, the order of a list ranked by it (the waiver pool). */
		endsOnValue?: boolean;
	}

	let {
		player,
		host,
		tags = [],
		slot,
		status = null,
		trailing,
		endsOnValue = false
	}: Props = $props();

	const name = $derived(player?.name ?? host.name);
	/** His value cell when the row ends on it, null otherwise or without a value. */
	const valueEnd = $derived.by(() => {
		if (!endsOnValue || player === null) return null;
		const { vor, vorRound } = player;
		return vor !== null && vorRound !== null ? vorCell(vor, vorRound) : null;
	});
	/** The season moves beside the projection whenever the end holds another number. */
	const seasonInMeta = $derived(trailing !== undefined || endsOnValue);
</script>

<div class="row" class:slotted={slot !== undefined}>
	{#if slot !== undefined}<span class="slot"><Label size="cell">{slot}</Label></span>{/if}
	<Face src={player?.headshot ?? null} {name} size={32} {status} />
	<span class="who">
		{#if player}
			<a href={links.playerSeason(player.slug)}><b><NameWords {name} /></b></a>
		{:else}
			<b><NameWords {name} /></b>
		{/if}
		<span class="meta">
			{#if player}
				<PositionPill position={player.position} rank={player.positionRank} />
				<span>{player.team}</span>
				{#if player.bye !== null}<span>bye {player.bye}</span>{/if}
				{#if seasonInMeta}<span class="figures">{seasonWords(player.season)}</span>{/if}
				<span class="figures"
					>{projectionWords(
						endsOnValue
							? { points: player.points, vor: null, belowDepth: player.belowDepth }
							: player
					)}</span
				>
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
		{:else if valueEnd}
			<ValueCell {...valueEnd} />
		{:else if endsOnValue && player?.points == null}
			<Label size="cell">No projection</Label>
		{:else if player?.season.pointsPerGame != null}
			<ValueCell
				value={player.season.pointsPerGame}
				label="a game, {plural(player.season.games, 'game')}"
			/>
		{:else if player}
			<Label size="cell">No games yet</Label>
		{/if}
	</span>
</div>

<style>
	.row {
		position: relative;
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

	.who a {
		color: inherit;
		text-decoration: none;
	}

	.who a:hover b {
		text-decoration: underline;
	}

	/* The whole row is the link's target, so a thumb anywhere on it opens his game log. */
	.who a::after {
		content: '';
		position: absolute;
		inset: 0;
	}

	.meta {
		display: flex;
		align-items: center;
		column-gap: var(--s-2);
		font-size: var(--t-sm);
		color: var(--ink-2);
		flex-wrap: wrap;
	}

	.figures {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
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
