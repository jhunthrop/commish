<script lang="ts">
	import { fixed } from '#lib/format/number.ts';
	import type { Snippet } from 'svelte';
	import type { ShownMark } from '#lib/context/held-words.ts';
	import type { StatusView } from '#lib/run/status-view.ts';
	import type { MarketPosition } from '#lib/types/player.ts';
	import AdpCell from './AdpCell.svelte';
	import Face from './Face.svelte';
	import NameWords from './NameWords.svelte';
	import PositionPill from './PositionPill.svelte';
	import ToneChip from './ToneChip.svelte';

	/**
	 * A kicker or a defense on a board (Lane 66m, the 2026-09-05 ruling), in the house row on the
	 * Row's grid: his place in the drafters' order where a ranked row's number sits, under the
	 * Draft order head, and no projected points, no tier and no range. A player the drafts do not
	 * take has no place to print, and his ADP cell says so.
	 */
	interface Props {
		player: {
			name: string;
			position: MarketPosition;
			positionRank: number;
			team: string;
			adp: number | null;
			ourRank: number;
		};
		/** His face: a kicker's headshot, a defense's club mark. */
		face: string | null;
		/** Where the name leads: his club's page, which lists him. */
		href: string;
		eager?: boolean;
		/** The page's grid: match the Row and RowHead beside it. */
		range?: boolean;
		games?: boolean;
		/** In ADP order the lead is his ADP, as a Row's. */
		order?: 'board' | 'adp';
		held?: ShownMark | null;
		/** His injury status (a season-long one shows as his place). */
		status?: StatusView | null;
		action?: Snippet;
		/** Under a Draft order head (RowHead's market heads: a board's kicker or defense view, a club
		 * page) his place is that column's bare number. Under a ranked row's heads (ADP) it rides his
		 * position pill, "K 3", as a ranked row's place does. */
		orderColumn?: boolean;
	}

	let {
		player,
		face,
		href,
		eager = false,
		range = false,
		games = false,
		order = 'board',
		held = null,
		status = null,
		action,
		orderColumn = true
	}: Props = $props();

	/** A player on a season-long list has no place in the order: the word stands in for it. A player
	 * the drafts do not take has none either. */
	const word = $derived(status?.rank ?? null);
	const place = $derived(player.adp !== null && word === null ? player.positionRank : null);
	const pillRank = $derived(word ?? (orderColumn ? undefined : (place ?? undefined)));
	const lead = $derived(order === 'adp' && player.adp !== null ? fixed(player.adp) : '');
</script>

<div
	class="row"
	class:mine={held?.kind === 'mine'}
	class:flat={!range}
	class:act={action !== undefined}
	class:act-flat={action !== undefined && !range}
	class:games
>
	<span class="rk">{lead}</span>
	<span class="face"
		><Face
			src={face}
			name={player.name}
			size={40}
			loading={eager ? 'eager' : 'lazy'}
		/>{#if held}<held.Mark words={held.words} kind={held.kind} />{/if}</span
	>
	<span class="who">
		<a class="name" {href}><NameWords name={player.name} /></a>
		<span class="meta">
			<PositionPill position={player.position} rank={pillRank} />
			<span class="team">{player.team}</span>
		</span>
		{#if status}
			<span class="status">
				{#if status.line}{status.line}{:else}<ToneChip tone={status.sits ? 'loss' : 'even'}
						>{status.mark}</ToneChip
					>{/if}
			</span>
		{/if}
	</span>
	{#if games}<span class="gp"></span>{/if}
	<span class="proj"></span>
	<span class="order"
		>{#if orderColumn && place !== null}<b>{place}</b>{/if}</span
	>
	{#if range}<span class="rng"></span>{/if}
	<AdpCell adp={player.adp} ourRank={player.ourRank} under="adp" compare={false} rankWord={word} />
	{#if action}<span class="action">{@render action()}</span>{/if}
</div>

<style>
	/* The Row's grid, track for track, so a kicker sits under the same heads as every other row. */
	.row {
		position: relative;
		display: grid;
		grid-template-columns: var(--board-cols);
		align-items: center;
		column-gap: var(--s-3);
		min-height: var(--row-h);
		padding: 4px var(--s-3);
		border-bottom: 1px solid var(--line);
	}

	.flat {
		grid-template-columns: var(--board-cols-flat);
	}

	.act {
		grid-template-columns: var(--board-cols-act);
	}

	.act-flat {
		grid-template-columns: var(--board-cols-act-flat);
	}

	.games {
		grid-template-columns: var(--board-cols-games);
	}

	.games.flat {
		grid-template-columns: var(--board-cols-games-flat);
	}

	.games.act {
		grid-template-columns: var(--board-cols-games-act);
	}

	.games.act-flat {
		grid-template-columns: var(--board-cols-games-act-flat);
	}

	.row:hover {
		background: var(--surface);
	}

	.mine,
	.mine:hover {
		background: var(--accent-wash);
	}

	.face {
		position: relative;
		display: inline-grid;
	}

	.rk {
		font-size: var(--t-sm);
		color: var(--ink-3);
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.who {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.name {
		font-weight: 600;
		font-size: var(--t-md);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-decoration: none;
	}

	/* The name's link stretches over the row, as a Row's; the action sits above it. */
	.name::after {
		content: '';
		position: absolute;
		inset: 0;
	}

	.row:hover .name {
		text-decoration: underline;
	}

	.meta {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--t-sm);
		color: var(--ink-3);
		white-space: nowrap;
	}

	.status {
		font-size: var(--t-sm);
		color: var(--ink-2);
		line-height: 1.3;
	}

	/* The place, a ranked row's figure in its type (ValueCell's), its column head naming it. */
	.order {
		display: flex;
		justify-content: flex-end;
		align-items: center;
	}

	.order b {
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.01em;
		font-weight: 700;
		font-size: var(--t-xl);
		line-height: 1;
	}

	.gp {
		display: none;
	}

	@media (min-width: 1181px) {
		.games > .gp {
			display: block;
		}
	}

	@media (min-width: 961px) and (max-width: 1439px) {
		.games > .rng {
			display: none;
		}
	}

	.action {
		position: relative;
		z-index: 1;
		display: flex;
		justify-content: flex-end;
	}

	.action :global([data-reveal]) {
		opacity: 0;
	}

	.row:hover .action :global([data-reveal]),
	.row:focus-within .action :global([data-reveal]) {
		opacity: 1;
	}

	@media (hover: none) {
		.action :global([data-reveal]) {
			opacity: 1;
		}
	}

	@media (max-width: 960px) {
		.rng,
		.action {
			display: none;
		}
	}

	@media (max-width: 760px) {
		.row {
			column-gap: var(--s-2);
			padding: 4px 0;
		}

		.rk,
		.proj,
		.action {
			display: none;
		}

		.name {
			white-space: normal;
		}
	}
</style>
