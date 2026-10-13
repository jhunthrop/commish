<script lang="ts">
	import { onMount, tick } from 'svelte';
	import SheetRow from '#lib/ui/SheetRow.svelte';
	import SheetTier from '#lib/ui/SheetTier.svelte';
	import type { Position } from '#lib/types/player.ts';
	import { attachDrag, type RowDrop, type StripDrop } from './drag.ts';
	import type { Ranks, SheetRow as Row } from './model.ts';
	import { POSITION_NAMES } from '#lib/run/derive.ts';
	import RowEditor from './RowEditor.svelte';
	import type { SheetStore } from './store.svelte.ts';
	import { tagLabel } from './tags.ts';
	import { canStartTierAt, startsTier, tierRuns, tierStartRange } from './tiers.ts';

	interface Props {
		store: SheetStore;
		/** The rows this view shows, in your order. */
		rows: readonly Row[];
		/** A position view draws your tier strips. All draws tiers as chips. */
		position: Position | null;
		ranks: ReadonlyMap<string, Ranks>;
		/** Our board's rank by id, or null until our board is loaded. */
		ourRanks: ReadonlyMap<string, number> | null;
		/** False while a search narrows the sheet: an order is set on the whole list. */
		movable: boolean;
		/** Your own tags anywhere on the sheet. */
		ownTags: readonly string[];
		/** Words for the screen reader after a move. */
		onannounce: (words: string) => void;
	}

	let { store, rows, position, ranks, ourRanks, movable, ownTags, onannounce }: Props = $props();

	/** How many rows load their faces at once: the first screen on a tall desktop. */
	const EAGER_ROWS = 14;

	let list: HTMLElement | undefined = $state();
	let openId = $state<string | null>(null);
	let liftedRow = $state<{ id: string; from: number } | null>(null);
	/** The tier number lifted by the keyboard. */
	let liftedTier = $state<number | null>(null);

	const ids = $derived(rows.map((row) => row.id));
	const runs = $derived(position === null ? [] : tierRuns(rows));
	const runByStart = $derived(new Map(runs.map((run) => [run.startId, run])));

	function restIndex(playerId: string, neighbour: string): number {
		return store.sheet.rows
			.filter((row) => row.id !== playerId)
			.findIndex((row) => row.id === neighbour);
	}

	/** A drop among this view's rows, as a place in the whole order. */
	function onRowDrop({ playerId, rowsAbove, side }: RowDrop): void {
		const others = ids.filter((id) => id !== playerId);
		const before = others[rowsAbove];
		const after = others[rowsAbove - 1];
		let to: number;
		if (side === 'below' && before !== undefined) to = restIndex(playerId, before);
		else if (after !== undefined) to = restIndex(playerId, after) + 1;
		else if (before !== undefined) to = restIndex(playerId, before);
		else return;
		store.move(playerId, to, side);
		announceRank(playerId);
	}

	function onStripDrop({ startId, rowIndex }: StripDrop): void {
		store.moveTier(startId, rowIndex);
	}

	function announceRank(playerId: string): void {
		void tick().then(() => {
			const row = store.sheet.rows.findIndex((candidate) => candidate.id === playerId);
			const name = store.sheet.rows[row]?.name ?? '';
			onannounce(`${name} now at ${String(row + 1)}`);
		});
	}

	async function refocus(selector: string): Promise<void> {
		await tick();
		list?.querySelector<HTMLElement>(selector)?.focus();
	}

	const LIFT_KEYS = new Set([' ', 'Enter']);

	function onRowKey(event: KeyboardEvent, row: Row): void {
		if (LIFT_KEYS.has(event.key)) {
			event.preventDefault();
			if (liftedRow?.id === row.id) {
				liftedRow = null;
				announceRank(row.id);
			} else {
				liftedRow = { id: row.id, from: store.sheet.rows.indexOf(row) };
				onannounce(`${row.name} lifted at ${String(ranks.get(row.id)?.overall ?? 0)}`);
			}
			return;
		}
		if (liftedRow?.id !== row.id) return;
		const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
		if (delta !== 0) {
			event.preventDefault();
			store.nudge(row.id, delta, ids);
			announceRank(row.id);
			void refocus(`[data-grip="${CSS.escape(row.id)}"]`);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			store.move(row.id, liftedRow.from);
			liftedRow = null;
			announceRank(row.id);
			void refocus(`[data-grip="${CSS.escape(row.id)}"]`);
		}
	}

	function onTierKey(event: KeyboardEvent, startId: string, tier: number): void {
		if (LIFT_KEYS.has(event.key)) {
			event.preventDefault();
			liftedTier = liftedTier === tier ? null : tier;
			return;
		}
		if (liftedTier !== tier) return;
		const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
		if (delta === 0) {
			if (event.key === 'Escape') liftedTier = null;
			return;
		}
		event.preventDefault();
		store.moveTier(startId, ids.indexOf(startId) + delta);
		void tick().then(() => {
			const moved = runs.find((run) => run.tier === tier);
			if (moved) void refocus(`[data-strip-grip="${CSS.escape(moved.startId)}"]`);
		});
	}

	onMount(() => {
		if (!list) return;
		return attachDrag(list, {
			onRowDrop,
			onStripDrop,
			stripRange: (startId) => tierStartRange(store.sheet.rows, startId),
			onActive: (active) => {
				if (active) openId = null;
			}
		});
	});
</script>

<div class="list" bind:this={list}>
	{#each rows as row, index (row.id)}
		{@const run = runByStart.get(row.id)}
		{@const rank = ranks.get(row.id)}
		{#if run && position}
			<SheetTier
				tier={run.tier}
				count={run.count}
				group={POSITION_NAMES[position]}
				startId={row.id}
				movable={movable && run.tier > 1}
				lifted={liftedTier === run.tier}
				ongripkeydown={(event: KeyboardEvent) => onTierKey(event, row.id, run.tier)}
				onjoin={() => store.removeTier(row.id)}
			/>
		{/if}
		<SheetRow
			id={row.id}
			name={row.name}
			position={row.position}
			positionRank={rank?.position ?? 0}
			team={row.team}
			headshot={row.headshot}
			rank={rank?.overall ?? index + 1}
			tier={position === null ? row.tier : null}
			tags={row.tags.map(tagLabel)}
			note={row.note}
			ourRank={ourRanks ? (ourRanks.get(row.id) ?? null) : undefined}
			open={openId === row.id}
			lifted={liftedRow?.id === row.id}
			{movable}
			eager={index < EAGER_ROWS}
			ontoggle={() => (openId = openId === row.id ? null : row.id)}
			ongripkeydown={(event: KeyboardEvent) => onRowKey(event, row)}
		>
			{#snippet editor()}
				<RowEditor
					{row}
					{ownTags}
					canStartTier={canStartTierAt(store.sheet.rows, row.id)}
					startsTier={startsTier(store.sheet.rows, row.id)}
					onnote={(note: string) => store.setNote(row.id, note)}
					ontags={(tags: readonly string[]) => store.setTags(row.id, tags)}
					onstarttier={() => store.startTier(row.id)}
					onremove={() => {
						openId = null;
						store.remove(row.id);
					}}
				/>
			{/snippet}
		</SheetRow>
	{/each}
</div>

<style>
	.list {
		display: flex;
		flex-direction: column;
	}
</style>
