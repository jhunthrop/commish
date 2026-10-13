<script lang="ts">
	import { adpWords } from '#lib/format/draft.ts';
	import { count } from '#lib/format/number.ts';
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
		/** No call, so no odds, is coming for this turn. */
		oddsGone?: boolean;
		/** Each player's chance of lasting to your next pick. */
		odds: Readonly<Record<string, number>>;
		/** What the odds are of: "still there at 6.05". */
		oddsLabel: string;
		/** The odds column is drawn only when there is a call to come with odds; a draft read without
		 * one (shared, or a lobby before your call) has no column promising them. */
		oddsShown: boolean;
		/** Whose points rank the pool and where the odds come from. */
		basis: string;
		/** The pick the ADP sentence is read against. */
		pickNumber: number;
		callId: string | null;
		selectedId: string | null;
		queue: ReadonlySet<string>;
		/** The pick is yours to make, so the rows carry Draft. */
		draftShown: boolean;
		canDraft: boolean;
		/** A draft read, never drafted in: no Queue or Draft on the rows. */
		readonly?: boolean;
		filter: PoolFilter;
		filters: readonly PoolFilter[];
		/** The search typed, for the empty pool's sentence. */
		search: string;
		onfilter: (filter: PoolFilter) => void;
		ondraft: (id: string) => void;
		onqueue: (id: string) => void;
		onselect: (id: string) => void;
	}

	let {
		rows,
		left,
		oddsGone = false,
		odds,
		oddsLabel,
		oddsShown,
		basis,
		pickNumber,
		callId,
		selectedId,
		queue,
		draftShown,
		canDraft,
		readonly = false,
		filter,
		filters,
		search,
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
	/** Under a row with no chance to show, in words that fit the column: not in this card's odds,
	 * on their way with the call, or none at all when no call is coming. */
	const oddsMissing = $derived(
		oddsGone ? 'no odds' : Object.keys(odds).length > 0 ? 'not in the odds' : 'odds to come'
	);
	const visible = $derived(Math.max(shown, rows.findIndex((p) => p.id === selectedId) + 1));
	const empty = $derived.by(() => {
		const needle = search.trim();
		const at = filter === 'All' || filter === 'Queue' ? '' : ` at ${filter}`;
		if (needle !== '') return `Nobody named ${needle}${at} in the pool.`;
		if (filter === 'Queue') return 'Nobody in your queue. Mark a player and press Q to add him.';
		return `Nobody left${at}.`;
	});
</script>

<section class="pool" class:no-odds={!oddsShown} class:readonly aria-label="Pool">
	<div class="head">
		<DisplayTitle size="panel">Pool</DisplayTitle>
		<Label>{count(left)} left, ranked by points over replacement</Label>
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
		<Label align="end"
			><span class="wide">Over replacement</span><span class="narrow">Over repl</span></Label
		>
		{#if oddsShown}<Label align="end">Still there</Label>{/if}
		<span class="adp"><Label align="end">ADP</Label></span>
		{#if !readonly}<span class="acts-head"></span>{/if}
	</div>
	{#each rows.slice(0, visible) as player (player.id)}
		<PoolRow
			{player}
			odds={oddsShown ? (odds[player.id] ?? null) : undefined}
			{oddsLabel}
			{oddsMissing}
			adp={adpWords(player.adp, pickNumber)}
			isCall={player.id === callId}
			selected={player.id === selectedId}
			queued={queue.has(player.id)}
			{draftShown}
			{canDraft}
			{readonly}
			ondraft={() => ondraft(player.id)}
			onqueue={() => onqueue(player.id)}
			onselect={() => onselect(player.id)}
		/>
	{:else}
		<p class="empty">{empty}</p>
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
	/* The columns: face, player, over replacement, odds, ADP, actions. A draft with no odds drops the
	   odds column, a read-only draft drops the actions. */
	.pool {
		--col-odds: 136px;
		--col-acts: 150px;
		--pool-cols: 40px minmax(0, 1fr) 118px var(--col-odds) 118px var(--col-acts);
		min-width: 0;
	}

	.no-odds {
		--pool-cols: 40px minmax(0, 1fr) 118px 118px var(--col-acts);
	}

	.readonly {
		--pool-cols: 40px minmax(0, 1fr) 118px var(--col-odds) 118px;
	}

	.no-odds.readonly {
		--pool-cols: 40px minmax(0, 1fr) 118px 118px;
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

	.cols > .adp {
		display: flex;
		justify-content: flex-end;
	}

	.narrow {
		display: none;
	}

	.more {
		padding: var(--s-3) 0;
	}

	.empty {
		color: var(--ink-2);
		font-size: var(--t-sm);
	}

	@media (max-width: 1180px) {
		.pool {
			--col-odds: 126px;
			--col-acts: 64px;
			--pool-cols: 40px minmax(0, 1fr) 108px var(--col-odds) 108px var(--col-acts);
		}

		.no-odds {
			--pool-cols: 40px minmax(0, 1fr) 108px 108px var(--col-acts);
		}

		.readonly {
			--pool-cols: 40px minmax(0, 1fr) 108px var(--col-odds) 108px;
		}

		.no-odds.readonly {
			--pool-cols: 40px minmax(0, 1fr) 108px 108px;
		}
	}

	@media (max-width: 760px) {
		.pool,
		.readonly {
			--pool-cols: 36px minmax(0, 1fr) 84px 84px;
		}

		.no-odds,
		.no-odds.readonly {
			--pool-cols: 36px minmax(0, 1fr) 84px;
		}

		/* On the phone the head names the over replacement column, whose cells print the number
		   alone, the board's rows' treatment. The odds cells still name what they are. */
		.cols {
			column-gap: var(--s-2);
			padding: var(--s-2) 0;
		}

		.cols > .adp,
		.acts-head,
		.wide {
			display: none;
		}

		.narrow {
			display: inline;
		}

		.chips {
			margin-left: 0;
		}
	}
</style>
