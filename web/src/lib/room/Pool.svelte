<script lang="ts">
	import { adpWords } from '#lib/format/draft.ts';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import DisplayTitle from '#lib/ui/DisplayTitle.svelte';
	import Label from '#lib/ui/Label.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import PoolRow from './PoolRow.svelte';
	import type { PoolFilter, RoomPlayer } from './model.ts';

	interface Props {
		rows: readonly RoomPlayer[];
		/** Players left in the pool, before the filter. */
		left: number;
		/** Each player's chance of lasting to your next pick. */
		odds: Readonly<Record<string, number>>;
		/** What the odds are of: "still there at 6.05". */
		oddsLabel: string;
		/** Whose points rank the pool and where the odds come from. */
		basis: string;
		/** The pick the ADP sentence is read against. */
		pickNumber: number;
		callId: string | null;
		selectedId: string | null;
		queue: ReadonlySet<string>;
		canDraft: boolean;
		filter: PoolFilter;
		filters: readonly PoolFilter[];
		onfilter: (filter: PoolFilter) => void;
		ondraft: (id: string) => void;
		onqueue: (id: string) => void;
		onselect: (id: string) => void;
	}

	let {
		rows,
		left,
		odds,
		oddsLabel,
		basis,
		pickNumber,
		callId,
		selectedId,
		queue,
		canDraft,
		filter,
		filters,
		onfilter,
		ondraft,
		onqueue,
		onselect
	}: Props = $props();

	/** The rows drawn first, the room's first screen, and how many more each "Show more" adds. The
	 * arrow keys reach past them on their own. */
	const FIRST_ROWS = 14;
	const MORE_ROWS = 25;

	let shown = $state(FIRST_ROWS);
	const oddsMissing = $derived(
		Object.keys(odds).length > 0 ? 'not in the odds' : 'odds come with the call'
	);
	const visible = $derived(Math.max(shown, rows.findIndex((p) => p.id === selectedId) + 1));
</script>

<section class="pool" aria-label="Pool">
	<div class="head">
		<DisplayTitle size="panel">Pool</DisplayTitle>
		<Label>{left} left, ranked by points over replacement</Label>
		<div class="chips">
			<ChipGroup label="Position">
				{#each filters as f (f)}
					<Chip pressed={filter === f} onclick={() => onfilter(f)}>{f}</Chip>
				{/each}
			</ChipGroup>
		</div>
	</div>
	<p class="basis">{basis}</p>
	<div class="cols" aria-hidden="true">
		<span></span>
		<Label>Player</Label>
		<Label align="end">Over replacement</Label>
		<Label align="end">Still there</Label>
		<span class="adp"><Label align="end">ADP</Label></span>
		<span></span>
	</div>
	{#each rows.slice(0, visible) as player (player.id)}
		<PoolRow
			{player}
			odds={odds[player.id] ?? null}
			{oddsLabel}
			{oddsMissing}
			adp={adpWords(player.adp, pickNumber)}
			isCall={player.id === callId}
			selected={player.id === selectedId}
			queued={queue.has(player.id)}
			{canDraft}
			ondraft={() => ondraft(player.id)}
			onqueue={() => onqueue(player.id)}
			onselect={() => onselect(player.id)}
		/>
	{:else}
		<p class="empty">Nobody left here.</p>
	{/each}
	{#if rows.length > visible}
		<div class="more">
			<Quiet size="sm" onclick={() => (shown = visible + MORE_ROWS)}
				>Show {Math.min(MORE_ROWS, rows.length - visible)} more</Quiet
			>
		</div>
	{/if}
</section>

<style>
	.pool {
		--pool-cols: 40px minmax(0, 1fr) 118px 136px 118px 150px;
		min-width: 0;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-3);
	}

	.chips {
		margin-left: auto;
		max-width: 100%;
		overflow-x: auto;
	}

	.basis {
		margin: var(--s-2) 0 0;
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.cols {
		display: grid;
		grid-template-columns: var(--pool-cols);
		column-gap: var(--s-3);
		padding: var(--s-3) var(--s-3) var(--s-2);
		border-bottom: 1px solid var(--line-strong);
	}

	.more {
		padding: var(--s-3) 0;
	}

	.empty {
		color: var(--ink-3);
		font-size: var(--t-sm);
	}

	@media (max-width: 1180px) {
		.pool {
			--pool-cols: 40px minmax(0, 1fr) 108px 126px 108px 64px;
		}
	}

	@media (max-width: 760px) {
		.pool {
			--pool-cols: 36px minmax(0, 1fr) 84px 84px;
		}

		/* On a phone each cell names itself under its number. */
		.cols {
			display: none;
		}

		.chips {
			margin-left: 0;
		}
	}
</style>
