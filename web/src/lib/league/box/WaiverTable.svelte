<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import StatusChip from '#lib/ui/StatusChip.svelte';
	import { LINES } from '../inseason/words.ts';
	import { BOX, boxNumber } from './box.ts';
	import BoxLine from './BoxLine.svelte';
	import {
		dropLead,
		dropTitle,
		gainWord,
		sameWeekGain,
		WAIVERS,
		type DropRow,
		type PoolRow,
		type Sort,
		type SortKey
	} from './waivers.ts';

	/** The Waivers table (Lane 66f): the players free to add in the Lineup's columns (player, game,
	 * Proj, Opp rank, Avg, Last, Δ Proj), then Rest of season and Beats, and an Add on each row. Every
	 * head sorts. Add opens the players of the member's he could replace under his row, in the same
	 * columns, the advice's drop first, with the screen's verb for the pair. */
	interface Props {
		label: string;
		rows: readonly PoolRow[];
		sort: Sort;
		onsort: (key: SortKey) => void;
		/** The row whose drops are open, null for none. */
		open: string | null;
		ontoggle: (row: PoolRow) => void;
		drops: readonly DropRow[];
		/** The drop chosen in the panel, by host id. */
		chosen: string | null;
		onchoose: (drop: DropRow) => void;
		/** The panel's last row: the pair's verb and its line. */
		go: Snippet;
		/** Said in place of the rows when none is left (a search that finds no one). */
		empty: string;
	}

	let { label, rows, sort, onsort, open, ontoggle, drops, chosen, onchoose, go, empty }: Props =
		$props();

	const COLUMNS = 10;
	/** The panel's cells before its two last columns. */
	const LEAD_COLUMNS = 8;
	const HEADS: readonly { key: SortKey; label: string; cls: string }[] = [
		{ key: 'name', label: BOX.player, cls: 'player' },
		{ key: 'game', label: BOX.game, cls: 'game' },
		{ key: 'proj', label: BOX.proj, cls: 'n num' },
		{ key: 'opp', label: BOX.oppRank, cls: 'n ev first' },
		{ key: 'avg', label: BOX.avg, cls: 'n ev' },
		{ key: 'last', label: BOX.last, cls: 'n ev' },
		{ key: 'delta', label: BOX.delta, cls: 'n ev delta' },
		{ key: 'rest', label: WAIVERS.rest, cls: 'n rest' },
		{ key: 'beats', label: WAIVERS.beats, cls: 'n beats' }
	];
	const week = $derived(sameWeekGain(drops));

	/** The arrow keys move the drop chosen through the group, its focus with it (review 66f L11). */
	const NEXT = new Set(['ArrowDown', 'ArrowRight']);
	const PREVIOUS = new Set(['ArrowUp', 'ArrowLeft']);
	function step(event: KeyboardEvent, at: number): void {
		const move = NEXT.has(event.key) ? 1 : PREVIOUS.has(event.key) ? -1 : 0;
		if (move === 0 || drops.length === 0) return;
		event.preventDefault();
		const to = (at + move + drops.length) % drops.length;
		const next = drops[to];
		if (next === undefined) return;
		onchoose(next);
		const group = (event.currentTarget as HTMLElement).closest('[role="radiogroup"]');
		group?.querySelectorAll<HTMLElement>('[role="radio"]')[to]?.focus();
	}
	const ariaSort = (key: SortKey): 'ascending' | 'descending' | undefined =>
		sort.key === key ? (sort.down ? 'descending' : 'ascending') : undefined;
</script>

{#snippet restCell(value: number | null)}
	<td class="n rest">{boxNumber(value)}</td>
{/snippet}

<table class="pool" aria-label={label}>
	<thead>
		<tr class="cols">
			{#each HEADS as head (head.key)}
				<th class={head.cls} scope="col" aria-sort={ariaSort(head.key)}
					><button
						type="button"
						class="sort"
						class:on={sort.key === head.key}
						onclick={() => onsort(head.key)}
						>{head.label}{#if sort.key === head.key}<span class="caret" class:up={!sort.down}
								><Icon name="chevron" size={12} /></span
							>{/if}</button
					></th
				>
			{/each}
			<th class="act" scope="col"><span class="vh">{LINES.add}</span></th>
		</tr>
	</thead>
	{#each rows as entry (entry.key)}
		{@const isOpen = open === entry.key}
		<tbody>
			<BoxLine
				phoneFacts={false}
				row={entry.row}
				slotCell={false}
				ptsCell={false}
				evidence
				marked={entry.named}
				clears={entry.clears}
				phoneMore="{WAIVERS.rest} {boxNumber(entry.rest)}"
			>
				{#snippet tail()}
					{@render restCell(entry.rest)}
					<td class="n beats" class:starter={entry.beats?.starter === true}>
						{#if entry.beats}
							<span class="bt"
								><span class="who"
									><b>{entry.beats.name}</b><span
										>{entry.beats.starter ? WAIVERS.starter : WAIVERS.bench}</span
									></span
								><span class="gain" class:held={entry.beats.gain === null}
									>{entry.beats.gain === null ? BOX.none : gainWord(entry.beats.gain)}</span
								></span
							>
						{:else}<span class="none">{entry.row.game === 'bye' ? BOX.bye : BOX.none}</span>{/if}
					</td>
					<td class="act"
						><button
							type="button"
							class="add"
							class:on={isOpen}
							aria-expanded={isOpen}
							aria-controls="drops-{entry.key}"
							aria-label="{isOpen ? WAIVERS.close : LINES.add} {entry.row.name}"
							onclick={() => ontoggle(entry)}
							><Icon name={isOpen ? 'chevron' : 'plus'} size={14} /><span>{LINES.add}</span></button
						></td
					>
				{/snippet}
			</BoxLine>
		</tbody>
		{#if isOpen}
			<tbody class="panel" id="drops-{entry.key}">
				<tr class="dsect">
					<td colspan={LEAD_COLUMNS}
						><b id="drops-title-{entry.key}">{dropTitle(entry.row.name)}</b><span class="lead"
							>{dropLead(week)}</span
						></td
					>
					<td class="dhead" colspan={COLUMNS - LEAD_COLUMNS}>{WAIVERS.gain}</td>
				</tr>
			</tbody>
			<!-- ARIA in HTML allows any role on a tbody: the drop rows are one radio group with arrow keys
			     (review 66f L11), kept in the table so their columns stay the table's. -->
			<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
			<tbody class="panel" role="radiogroup" aria-labelledby="drops-title-{entry.key}">
				{#each drops as drop, i (drop.key)}
					{@const on = chosen === drop.key}
					<BoxLine
						phoneFacts={false}
						row={drop.row}
						slotCell={false}
						ptsCell={false}
						evidence
						nested
						marked={on}
						phoneMore="{WAIVERS.rest} {boxNumber(drop.rest)}"
					>
						{#snippet tail()}
							{@render restCell(drop.rest)}
							<td class="n beats"
								>{#if drop.starter}<span class="dmark"><StatusChip status={drop.starter} /></span
									>{/if}<span class="dgain" class:up={drop.gain > 0} class:down={drop.gain < 0}
									>{gainWord(drop.gain)}</span
								>{#if week === null && drop.weekGain !== null}<span class="dweek"
										>{gainWord(drop.weekGain)} {BOX.proj}</span
									>{/if}</td
							>
							<td class="act"
								><button
									type="button"
									role="radio"
									class="radio"
									class:on
									aria-checked={on}
									tabindex={on ? 0 : -1}
									aria-label="Drop {drop.row.name}"
									onclick={() => onchoose(drop)}
									onkeydown={(event) => step(event, i)}
								></button></td
							>
						{/snippet}
					</BoxLine>
				{/each}
			</tbody>
			<tbody class="panel">
				<tr class="dgo"><td colspan={COLUMNS}>{@render go()}</td></tr>
			</tbody>
		{/if}
	{:else}
		<tbody><tr><td class="empty" colspan={COLUMNS}>{empty}</td></tr></tbody>
	{/each}
</table>

<style>
	.pool {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		overflow: hidden;
	}

	th {
		padding: 0;
		text-align: left;
	}

	.cols th {
		height: 32px;
		background: var(--bg);
		border-bottom: 1px solid var(--line);
		white-space: nowrap;
	}

	.sort {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		width: 100%;
		height: 32px;
		padding: 0 var(--s-2);
		border: 0;
		background: transparent;
		font: inherit;
		font-family: var(--font-ui);
		font-size: var(--t-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
		cursor: pointer;
		white-space: nowrap;
	}

	.n .sort {
		justify-content: flex-end;
	}

	.sort.on {
		color: var(--ink);
	}

	.caret {
		display: inline-grid;
		color: var(--accent-text);
	}

	.caret.up {
		transform: rotate(180deg);
	}

	.cols .game {
		width: 200px;
	}

	.cols .num {
		width: 64px;
	}

	.cols .ev {
		width: 60px;
	}

	.cols .ev.first {
		width: 88px;
		border-left: 1px solid var(--line);
	}

	.cols .ev.first .sort {
		padding-left: var(--s-3);
	}

	.cols .delta {
		width: 68px;
	}

	.cols .rest {
		width: 76px;
		border-left: 1px solid var(--line);
	}

	.cols .rest .sort {
		white-space: normal;
		line-height: 1.1;
		text-align: right;
	}

	.cols .beats {
		width: 132px;
	}

	.cols .act {
		width: 84px;
	}

	.vh {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.n {
		text-align: right;
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	td {
		padding: 6px var(--s-2);
		border-bottom: 1px solid var(--line);
		vertical-align: middle;
	}

	td.rest {
		border-left: 1px solid var(--line);
		font-size: var(--t-lg);
		font-weight: 700;
	}

	.bt {
		display: inline-flex;
		align-items: center;
		gap: var(--s-2);
	}

	.who {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		font-family: var(--font-ui);
		line-height: 1.15;
	}

	.who b {
		font-size: var(--t-sm);
		font-weight: 600;
		color: var(--ink-2);
	}

	.who span {
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.gain {
		min-width: 40px;
		font-size: var(--t-lg);
		font-weight: 700;
		color: var(--ink-2);
	}

	.starter .gain {
		font-size: var(--t-xl);
		color: var(--gain-ink);
	}

	/* A week gain withheld past kickoff is no gain: drawn as an empty figure, never in the gain ink. */
	.starter .gain.held {
		color: var(--ink-3);
	}

	.starter .who b {
		color: var(--ink);
	}

	.none {
		color: var(--ink-3);
		font-weight: 600;
	}

	.act {
		text-align: center;
		padding: 0 var(--s-2);
	}

	.add {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 32px;
		padding: 0 var(--s-3) 0 var(--s-2);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: var(--t-sm);
		font-weight: 600;
		cursor: pointer;
	}

	.add.on {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--bg);
	}

	.add.on :global(svg) {
		transform: rotate(180deg);
	}

	/* The drop choice, drawn as a radio: a ring, filled in the accent when chosen. */
	.radio {
		width: 18px;
		height: 18px;
		padding: 0;
		border: 2px solid var(--line-strong);
		border-radius: 50%;
		background: transparent;
		cursor: pointer;
	}

	.radio.on {
		border-color: var(--accent);
		background: radial-gradient(circle, var(--accent) 0 4px, transparent 5px);
	}

	.dsect td {
		padding: var(--s-2) var(--s-3);
		background: var(--surface-2);
		border-top: 2px solid var(--line-strong);
		font-size: var(--t-sm);
	}

	.dsect b {
		margin-right: var(--s-3);
		color: var(--ink);
	}

	.lead {
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.dhead {
		text-align: center;
		font-size: var(--t-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
	}

	.dgain {
		font-size: var(--t-xl);
		font-weight: 700;
		color: var(--ink-2);
	}

	.dgain.up {
		color: var(--gain-ink);
	}

	.dgain.down {
		color: var(--loss-ink);
	}

	/* This week's starter, marked in the shared status chip beside his gain (Lane 66u). */
	.dmark {
		margin-right: var(--s-2);
		vertical-align: middle;
	}

	.dweek {
		display: block;
		font-family: var(--font-ui);
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.dgo td {
		padding: var(--s-3) var(--s-3) var(--s-3) var(--s-5);
		background: var(--surface-2);
		border-bottom: 2px solid var(--line-strong);
	}

	.empty {
		padding: var(--s-3);
		color: var(--ink-2);
	}

	@media (max-width: 900px) {
		/* Rest of season folds into the phone's evidence line under the name, as the evidence does. */
		.cols .ev,
		.cols .ev.first,
		.cols .delta,
		.cols .rest,
		td.rest {
			width: 0;
			max-width: 0;
			padding: 0;
			overflow: hidden;
			font-size: 0;
			border-left: 0;
		}

		.cols .ev .sort,
		.cols .rest .sort {
			display: none;
		}
	}

	@media (max-width: 760px) {
		.pool {
			table-layout: fixed;
		}

		.cols .game {
			width: 0;
			padding: 0;
			font-size: 0;
		}

		.cols .game .sort {
			display: none;
		}

		.cols .num {
			width: 46px;
		}

		.cols .beats {
			width: 88px;
		}

		.cols .act {
			width: 44px;
		}

		.sort {
			padding: 0 4px;
		}

		td {
			padding: 7px 4px;
		}

		.bt {
			gap: 4px;
		}

		.who b {
			font-size: var(--t-xs);
		}

		.gain,
		.starter .gain {
			min-width: 0;
			font-size: var(--t-md);
		}

		.add {
			width: 32px;
			padding: 0;
			justify-content: center;
		}

		.add span {
			display: none;
		}

		.dsect td {
			padding: var(--s-2);
		}

		.lead {
			display: block;
		}

		.dhead {
			font-size: 10px;
			white-space: normal;
			line-height: 1.2;
		}

		.dgain {
			font-size: var(--t-md);
		}

		.dgo td {
			padding: var(--s-3);
		}
	}
</style>
