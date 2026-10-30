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
		beatsPlace,
		beatsWeekWord,
		beatsWord,
		gainGroups,
		gainWord,
		HEAD_SEPARATOR,
		sameWeekGain,
		STASH,
		WAIVERS,
		type DropRow,
		type HeadBasisPart,
		type PoolRow,
		type Sort,
		type SortKey
	} from './waivers.ts';
	import type { YoursRow } from './position-nav.ts';

	/** The Waivers table (Lane 66f): the players free to add in the Lineup's columns (player, game,
	 * Proj, Opp rank, Avg, Last, Δ Proj), then Rest of season and Beats, and an Add on each row, the
	 * columns' basis in one line under the heads, the rows that gain first and the rest under one
	 * divider, quiet (Lane 98). Every head sorts, within each group. Add opens the players of the
	 * member's he could replace under his row, in the same columns, the advice's drop first, with the
	 * screen's verb for the pair. */
	interface Props {
		label: string;
		rows: readonly PoolRow[];
		/** The line under the heads (headBasis). */
		heads: readonly HeadBasisPart[];
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
		/** Whether Proj and Δ Proj are drawn: not until the week's published projection is read
		 * (Lane 95), as Trades drops its week group. */
		projected?: boolean;
		/** The Stash group's rows (Lane 118, B79), under its own divider after the rest. */
		stash?: readonly PoolRow[];
		/** The Stash group's line under its divider (stashBasis); the group is drawn when it has rows
		 * or a line. */
		stashLine?: readonly string[];
		/** A stash's verb where an open IR slot takes him: the platform's page with his name. */
		onstash?: (row: PoolRow) => void;
		/** A chosen position (Lane 305): the member's players there over the free agents, one
		 * comparison in the same columns, each under its own head; null for every position. */
		compare?: { yours: string; free: string; rows: readonly YoursRow[] } | null;
	}

	let {
		label,
		rows,
		heads,
		sort,
		onsort,
		open,
		ontoggle,
		drops,
		chosen,
		onchoose,
		go,
		empty,
		projected = true,
		stash = [],
		stashLine = [],
		onstash = () => undefined,
		compare = null
	}: Props = $props();

	/** The week's two projection columns, left out while no projection is read. */
	const PROJ_KEYS = new Set<SortKey>(['proj', 'delta']);
	const COLUMNS = $derived(projected ? 10 : 8);
	/** The panel's cells before its two last columns. */
	const LEAD_COLUMNS = $derived(projected ? 8 : 6);
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
	const shownHeads = $derived(HEADS.filter((head) => projected || !PROJ_KEYS.has(head.key)));
	const week = $derived(sameWeekGain(drops));
	const groups = $derived(gainGroups(rows));

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

{#snippet entryRows(entry: PoolRow)}
	{@const isOpen = open === entry.key}
	{@const quiet = !entry.gains}
	{@const stashed = entry.stash}
	{@const verbWord = stashed?.verb === 'stash' ? STASH.verb : LINES.add}
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
			projCells={projected}
			away={stashed?.back ?? null}
		>
			{#snippet tail()}
				{@render restCell(entry.rest)}
				{#if stashed}
					<!-- A stash names the open IR slot or his drop, as the gaining rows name a player, and no
					     Gain: he plays no game until the week he is back (Lane 118, B79). -->
					<td class="n beats"
						>{#if stashed.who}<span class="bt"
								><span class="who"><b>{stashed.who.name}</b><span>{stashed.who.place}</span></span
								></span
							>{/if}</td
					>
				{:else}
					<td class="n beats" class:loud={!quiet && (entry.beats.gain ?? 0) > 0}>
						<span class="bt"
							>{#if entry.beats.who}<span class="who"
									><b>{entry.beats.who.name}</b><span>{beatsPlace(entry.beats.who)}</span></span
								>{/if}<span class="figs"
								><span class="gain" class:quiet>{beatsWord(entry.beats)}</span
								>{#if entry.beats.week !== null}<span class="bweek"
										>{beatsWeekWord(entry.beats.week)}</span
									>{/if}</span
							></span
						>
					</td>
				{/if}
				<td class="act"
					>{#if stashed?.verb === 'stash' && !stashed.drops}<button
							type="button"
							class="add quiet word"
							aria-label="{STASH.verb} {entry.row.name}"
							onclick={() => onstash(entry)}><span>{STASH.verb}</span></button
						>{:else}<button
							type="button"
							class="add"
							class:quiet
							class:word={stashed?.verb === 'stash'}
							class:on={isOpen}
							aria-expanded={isOpen}
							aria-controls="drops-{entry.key}"
							aria-label="{isOpen ? WAIVERS.close : verbWord} {entry.row.name}"
							onclick={() => ontoggle(entry)}
							>{#if stashed?.verb !== 'stash'}<Icon
									name={isOpen ? 'chevron' : 'plus'}
									size={14}
								/>{/if}<span>{verbWord}</span></button
						>{/if}</td
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
					projCells={projected}
					reserve={drop.row.reserve && drop.starter === null ? 'bench' : null}
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
{/snippet}

<table class="pool" aria-label={label}>
	<thead>
		<tr class="cols">
			{#each shownHeads as head (head.key)}
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
		<!-- The columns' basis, said once under their heads (Lane 98, B35). -->
		<tr class="heads-basis">
			<td colspan={COLUMNS}
				>{#each heads as part, i (part.head)}{#if i > 0}{HEAD_SEPARATOR}{/if}<b>{part.head}</b>
					{part.words}{/each}.</td
			>
		</tr>
	</thead>
	{#if compare}
		<!-- The member's players at the chosen position, then the free agents there (Lane 305): their
		     Beats cell holds their role, so a free agent's Beats reads against the row above. -->
		<tbody>
			<tr class="group"><th colspan={COLUMNS} scope="rowgroup">{compare.yours}</th></tr>
		</tbody>
		<tbody class="yours">
			{#each compare.rows as mine (mine.key)}
				<BoxLine
					phoneFacts={false}
					row={mine.row}
					slotCell={false}
					ptsCell={false}
					evidence
					phoneMore="{WAIVERS.rest} {boxNumber(mine.rest)}"
					projCells={projected}
				>
					{#snippet tail()}
						{@render restCell(mine.rest)}
						<td class="n beats"><span class="role" class:on={mine.starts}>{mine.role}</span></td>
						<td class="act"></td>
					{/snippet}
				</BoxLine>
			{/each}
		</tbody>
		<tbody>
			<tr class="group free-at"><th colspan={COLUMNS} scope="rowgroup">{compare.free}</th></tr>
		</tbody>
	{/if}
	{#each groups.gaining as entry (entry.key)}
		{@render entryRows(entry)}
	{/each}
	{#if groups.rest.length > 0}
		<tbody>
			<tr class="divider"><th colspan={COLUMNS} scope="rowgroup">{WAIVERS.noGain}</th></tr>
		</tbody>
		{#each groups.rest as entry (entry.key)}
			{@render entryRows(entry)}
		{/each}
	{/if}
	{#if rows.length === 0}
		<tbody><tr><td class="empty" colspan={COLUMNS}>{empty}</td></tr></tbody>
	{/if}
	{#if stash.length > 0 || stashLine.length > 0}
		<!-- The Stash group (Lane 118, B79): its own divider and its own line, never counted with the
		     rows that gain. -->
		<tbody>
			<tr class="divider"><th colspan={COLUMNS} scope="rowgroup">{STASH.head}</th></tr>
			{#if stashLine.length > 0}
				<tr class="stash-basis"><td colspan={COLUMNS}>{stashLine.join(' ')}</td></tr>
			{/if}
		</tbody>
		{#each stash as entry (entry.key)}
			{@render entryRows(entry)}
		{/each}
	{/if}
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

	/* A row that gains: its Gain the loud cell, in the gain ink; a zero never is (B13). */
	.loud .gain {
		font-size: var(--t-xl);
		color: var(--gain-ink);
	}

	.loud .who b {
		color: var(--ink);
	}

	.gain.quiet {
		font-size: var(--t-sm);
		font-weight: 600;
		color: var(--ink-3);
	}

	/* The columns' basis under the heads, one line at a desk (B35). */
	.heads-basis td {
		padding: 4px var(--s-2) 6px;
		background: var(--bg);
		border-bottom: 1px solid var(--line);
		font-size: var(--t-xs);
		line-height: 1.35;
		color: var(--ink-3);
	}

	.heads-basis b {
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-2);
	}

	/* The Stash group's line under its divider (Lane 118, B79), as the heads' line is drawn. */
	.stash-basis td {
		padding: 4px var(--s-2) 6px;
		background: var(--bg);
		border-bottom: 1px solid var(--line);
		font-size: var(--t-xs);
		line-height: 1.35;
		color: var(--ink-3);
	}

	/* The rows with no gain over the roster, under one divider (B13). */
	.divider th {
		padding: var(--s-3) var(--s-2) var(--s-1);
		background: var(--bg);
		border-top: 2px solid var(--line-strong);
		border-bottom: 1px solid var(--line);
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
		text-align: left;
	}

	/* The chosen position's comparison (Lane 305): the member's players under their head on a quieter
	   ground, their role where a free agent's Beats is; the free agents' head under them. */
	.group th {
		padding: var(--s-3) var(--s-2) var(--s-1);
		background: var(--bg);
		border-bottom: 1px solid var(--line);
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink);
		text-align: left;
	}

	.yours :global(td) {
		background: var(--surface-2);
	}

	.free-at th {
		color: var(--gain-ink);
	}

	.role {
		display: inline-block;
		padding: 1px 8px;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-pill);
		font-family: var(--font-ui);
		font-size: var(--t-xs);
		font-weight: 600;
		color: var(--ink-2);
	}

	.role.on {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--bg);
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

	.add.quiet {
		border-color: var(--line);
		color: var(--ink-3);
		font-weight: 500;
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

	/* The strip's move on its row: its week figure under the season Gain (review M1). */
	.figs {
		display: inline-flex;
		flex-direction: column;
		align-items: flex-end;
	}

	.bweek {
		font-family: var(--font-ui);
		font-size: var(--t-xs);
		color: var(--ink-3);
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

		/* The gain under whom he tops, so "+1.8 Gain" stays whole left of the Add button (review M-J). */
		.bt {
			flex-direction: column;
			align-items: flex-end;
			gap: 0;
		}

		.who b {
			font-size: var(--t-xs);
		}

		.gain,
		.loud .gain {
			min-width: 0;
			font-size: var(--t-md);
		}

		.gain.quiet {
			font-size: var(--t-sm);
		}

		.add {
			width: 32px;
			padding: 0;
			justify-content: center;
		}

		.add span {
			display: none;
		}

		/* The Stash verb keeps its word: it has no icon to stand in for it (Lane 118, B79). */
		.act:has(.add.word) {
			padding: 0 2px;
		}

		.add.word {
			width: auto;
			padding: 0 3px;
			font-size: var(--t-xs);
		}

		.add.word span {
			display: inline;
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
