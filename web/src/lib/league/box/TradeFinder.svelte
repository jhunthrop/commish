<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import Face from '#lib/ui/Face.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import ToneChip from '#lib/ui/ToneChip.svelte';
	import { memberZone } from '#lib/format/clock.ts';
	import type { PlayerLine } from '../inseason/api.ts';
	import { hostTab } from '../inseason/attach.ts';
	import { CLOSE_FOR_THEM, teamAside } from '../inseason/words.ts';
	import { BOX, boxRow, positionWord } from './box.ts';
	import BoxLine from './BoxLine.svelte';
	import TeamAvatar from './TeamAvatar.svelte';
	import TradeCopied from './TradeCopied.svelte';
	import {
		fromWords,
		gainWord,
		phoneWith,
		roomWords,
		shortSide,
		sideRows,
		toneOf,
		TRADES,
		weekLine,
		weekWord,
		type CopiedTrade,
		type FinderRow,
		type SideRow,
		type SortKey
	} from './trades.ts';

	/** The trade finder as a table (Lane 66g): one trade a row, what you give and get with faces, the
	 * other team, then two ruled-off groups, each side's gain over the rest of the season a week and
	 * each side's change in this week's Proj, then the room each roster has. A head sorts by its
	 * column. One tap opens the trade's players in the box score's columns (Proj, Pts, Opp rank, Avg,
	 * Last, Rest of season), the member's give and drop, then theirs, under the trade's week in one
	 * line, with Build from this and the trade verb under them: the verb copies the offer and opens
	 * the platform's trade page, as the strip's does. */
	interface Props {
		rows: readonly FinderRow[];
		sort: SortKey;
		onsort: (by: SortKey) => void;
		/** The member's team, for the opened trade's first group. */
		me: string;
		/** The platform's trade page, the verb's second half; empty when the API knows none, and the
		 * verb stands disabled with reason under it. */
		href: string;
		verb: string;
		/** Why the verb cannot open the platform's page: the API's note, said when href is empty. */
		reason: string | null;
		/** Copies a trade's offer, answering the line under its verb. */
		propose: (row: FinderRow) => Promise<CopiedTrade>;
		/** Opens the builder with the trade filled; null when a player in it has no host id. */
		build: (row: FinderRow) => (() => void) | null;
		/** The builder's id, which Build from this opens. */
		builderId: string;
		/** Told whether any trade is open, its players drawn: the page's basis then says their columns. */
		onopen?: (anyOpen: boolean) => void;
		/** The instant the answer was read, in ms: the page's clock the rows draw at. */
		now: number;
	}

	let {
		rows,
		sort,
		onsort,
		me,
		href,
		verb,
		reason,
		propose,
		build,
		builderId,
		now,
		onopen = () => undefined
	}: Props = $props();

	const COLUMNS = 9;
	const zone = memberZone();
	const opened = new SvelteSet<string>();
	let said = $state<Readonly<Record<string, CopiedTrade>>>({});

	function toggle(key: string): void {
		if (opened.has(key)) opened.delete(key);
		else opened.add(key);
		onopen(opened.size > 0);
	}

	async function press(entry: FinderRow): Promise<void> {
		said = { ...said, [entry.key]: await propose(entry) };
	}

	const heads: readonly { by: SortKey; desk: string; phone: string; first?: boolean }[] = [
		{ by: 'mine', desk: TRADES.you, phone: TRADES.yourGain, first: true },
		{ by: 'theirs', desk: TRADES.them, phone: TRADES.theirGain },
		{ by: 'weekMine', desk: TRADES.you, phone: TRADES.you, first: true },
		{ by: 'weekTheirs', desk: TRADES.them, phone: TRADES.them }
	];
</script>

{#snippet players(side: readonly PlayerLine[])}
	{#each side as line (line.player.host_id)}
		<span class="mp"
			><Face src={line.headshot} name={line.player.name} size={26} /><span class="mn"
				><b>{line.player.name}</b><small
					>{positionWord(line.player.position)} {line.player.team}</small
				></span
			></span
		>
	{/each}
{/snippet}

{#snippet group(label: string, side: readonly SideRow[])}
	<tr class="grp"><th colspan={COLUMNS} scope="rowgroup">{label}</th></tr>
	{#each side as entry (entry.line.player.host_id)}
		<BoxLine
			row={boxRow(entry.line, entry.side, zone, false, now)}
			move={entry.move}
			evidence
			season
			bench
			shortOnPhone
		/>
	{/each}
{/snippet}

<table class="finder" aria-label={TRADES.every}>
	<colgroup>
		<col class="c-op" />
		<col class="c-give" />
		<col class="c-get" />
		<col class="c-with" />
		<col class="c-g" />
		<col class="c-g" />
		<col class="c-w" />
		<col class="c-w" />
		<col class="c-room" />
	</colgroup>
	<thead>
		<tr class="groups">
			<td colspan="4"></td>
			<th colspan="2" scope="colgroup" class="gh first">{TRADES.gainHead}</th>
			<th colspan="2" scope="colgroup" class="gh first">{TRADES.weekHead}</th>
			<td></td>
		</tr>
		<tr class="cols">
			<th class="op" scope="col"><span class="vh">{TRADES.why}</span></th>
			<th class="give" scope="col">{TRADES.give}</th>
			<th class="get" scope="col">{TRADES.get}</th>
			<th class="with" scope="col">{TRADES.with}</th>
			{#each heads as head (head.by)}
				<th
					class="n fig"
					class:first={head.first}
					class:week={head.by.startsWith('week')}
					scope="col"
					aria-sort={sort === head.by ? 'descending' : 'none'}
				>
					<button type="button" class="sort" onclick={() => onsort(head.by)}
						><span class="desk">{head.desk}</span><span class="phone">{head.phone}</span
						>{#if sort === head.by}<Icon name="chevron" size={12} />{/if}</button
					>
				</th>
			{/each}
			<th class="room" scope="col">{TRADES.room}</th>
		</tr>
	</thead>
	<tbody>
		{#each rows as entry (entry.key)}
			{@const open = opened.has(entry.key)}
			{@const room = roomWords(entry.row)}
			{@const id = `trade-${entry.key}`}
			<tr class="trade" class:open>
				<td class="op"
					><button
						type="button"
						class="why"
						aria-expanded={open}
						aria-controls={id}
						aria-label={TRADES.why}
						onclick={() => toggle(entry.key)}><Icon name="chevron" size={16} /></button
					></td
				>
				<td class="give"
					>{@render players(entry.row.give)}<span class="ph-deal"
						><b>{shortSide(entry.row.give)}</b><Icon name="chevron" size={12} /><b class="in"
							>{shortSide(entry.row.get)}</b
						></span
					><span class="ph-with">{phoneWith(entry.team, entry.row)}</span></td
				>
				<td class="get">{@render players(entry.row.get)}</td>
				<td class="with"
					><span class="wt"
						><TeamAvatar name={entry.team.name} size={28} /><span
							><b>{entry.team.name}</b><small>{teamAside(entry.team)}</small
							>{#if entry.row.drop}<small class="drop-mid">{room.yours}</small
								>{/if}{#if entry.row.close_for_them}<ToneChip tone="even">{CLOSE_FOR_THEM}</ToneChip
								>{/if}</span
						></span
					></td
				>
				<td class="n g first {toneOf(entry.row.my_gain)}" class:sorted={sort === 'mine'}
					>{gainWord(entry.row.my_gain)}</td
				>
				<td class="n g {toneOf(entry.row.their_gain)}" class:sorted={sort === 'theirs'}
					>{gainWord(entry.row.their_gain)}</td
				>
				<td class="n w first {toneOf(entry.row.my_proj_change)}" class:sorted={sort === 'weekMine'}
					>{weekWord(entry.row.my_proj_change)}</td
				>
				<td class="n w {toneOf(entry.row.their_proj_change)}" class:sorted={sort === 'weekTheirs'}
					>{weekWord(entry.row.their_proj_change)}</td
				>
				<td class="room"
					><span class:wraps={entry.row.drop_reason !== null}>{room.yours}</span><span
						>{room.theirs}</span
					></td
				>
			</tr>
			{#if open}
				{@const sides = sideRows(entry.row)}
				{@const filled = build(entry)}
				{@const line = said[entry.key]}
				{@const week = weekLine(entry.row)}
				<tr class="opened" {id}>
					<td class="edge"></td>
					<td colspan={COLUMNS - 1}>
						{#if week}<p class="week-line">{week}</p>{/if}
						{#if entry.row.drop_reason}<p class="drop-why">{entry.row.drop_reason}</p>{/if}
						<table class="inner" aria-label={TRADES.why}>
							<colgroup>
								<col class="i-side" />
								<col />
								<col class="i-game" />
								<col class="i-num" />
								<col class="i-pts" />
								<col class="i-rk" />
								<col class="i-ev" />
								<col class="i-ev" />
								<col class="i-season" />
							</colgroup>
							<thead>
								<tr class="cols">
									<th class="side" scope="col"><span class="vh">{TRADES.sideGive}</span></th>
									<th scope="col">{BOX.player}</th>
									<th class="game" scope="col">{BOX.game}</th>
									<th class="n num" scope="col">{BOX.proj}</th>
									<th class="n num pts" scope="col">{BOX.pts}</th>
									<th class="n ev first" scope="col">{BOX.oppRank}</th>
									<th class="n ev" scope="col">{BOX.avg}</th>
									<th class="n ev" scope="col">{BOX.last}</th>
									<th class="n season" scope="col">{TRADES.perGame}</th>
								</tr>
							</thead>
							<tbody>
								{@render group(fromWords(me, true), sides.yours)}
								{@render group(fromWords(entry.team.name, false), sides.theirs)}
							</tbody>
						</table>
						<div class="acts">
							{#if filled}<Quiet size="sm" controls={builderId} onclick={filled}
									>{TRADES.fromThis}</Quiet
								>{/if}
							<span class="go" {@attach hostTab(href)}
								><Quiet
									size="sm"
									href={href === '' ? undefined : href}
									disabled={href === ''}
									onclick={() => void press(entry)}>{verb}</Quiet
								></span
							>
						</div>
						{#if line}<p class="said">
								<TradeCopied {line} {href} />
							</p>{:else if href === '' && reason}<p class="said">
								{reason}
							</p>{/if}
					</td>
				</tr>
			{/if}
		{/each}
	</tbody>
</table>

<style>
	.finder {
		width: 100%;
		table-layout: fixed;
		border-collapse: separate;
		border-spacing: 0;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		overflow: hidden;
	}

	.finder > thead th,
	.finder > thead td {
		padding: 0 var(--s-2);
		text-align: left;
		background: var(--bg);
	}

	.groups th,
	.groups td {
		height: 26px;
	}

	.gh {
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-2);
		text-align: center !important;
		box-shadow: inset 0 -2px 0 var(--line-strong);
	}

	.first {
		border-left: 1px solid var(--line);
	}

	.cols th {
		height: 30px;
		font-size: var(--t-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
		border-bottom: 1px solid var(--line);
		white-space: nowrap;
	}

	/* The columns' widths, set once: the group heads' row spans them, so no row of cells sets them. */
	.c-op {
		width: 48px;
	}

	.c-give {
		width: 210px;
	}

	.c-with {
		width: 200px;
	}

	.c-g {
		width: 100px;
	}

	.c-w {
		width: 72px;
	}

	.c-room {
		width: 140px;
	}

	.cols .n,
	.n {
		text-align: right;
	}

	.sort {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: inherit;
		text-transform: inherit;
		letter-spacing: inherit;
		cursor: pointer;
	}

	[aria-sort='descending'] .sort {
		color: var(--ink);
	}

	.phone {
		display: none;
	}

	.vh {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.trade > td {
		padding: var(--s-2);
		border-bottom: 1px solid var(--line);
		vertical-align: middle;
	}

	.trade:hover > td {
		background: var(--surface-2);
	}

	.trade.open > td,
	.opened > td {
		background: color-mix(in srgb, var(--accent) 8%, var(--surface));
	}

	.trade.open > td {
		border-bottom-color: transparent;
	}

	.trade.open > td:first-child,
	.opened > td:first-child {
		box-shadow: inset 3px 0 0 var(--accent);
	}

	.op {
		text-align: center;
	}

	.why {
		display: inline-grid;
		place-items: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: transparent;
		color: var(--ink-2);
		cursor: pointer;
	}

	.why[aria-expanded='true'] {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--bg);
	}

	.why[aria-expanded='true'] :global(svg) {
		transform: rotate(180deg);
	}

	.mp {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		min-width: 0;
	}

	.mp + .mp {
		margin-top: 6px;
	}

	.mn {
		display: flex;
		flex-direction: column;
		min-width: 0;
		line-height: 1.15;
	}

	.mn b {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mn small {
		font-size: var(--t-xs);
		color: var(--ink-3);
		letter-spacing: 0.03em;
	}

	.ph-deal,
	.ph-with {
		display: none;
	}

	.wt {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		min-width: 0;
	}

	.wt > span {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		min-width: 0;
	}

	.wt b {
		font-weight: 600;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.wt small {
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.g,
	.w {
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.g {
		font-size: var(--t-xl);
		font-weight: 800;
	}

	.w {
		font-size: var(--t-lg);
		font-weight: 700;
		color: var(--ink-2);
	}

	.gain {
		color: var(--gain-ink);
	}

	.loss {
		color: var(--loss-ink);
	}

	.sorted {
		background: color-mix(in srgb, var(--gain-bg) 40%, transparent);
	}

	.room {
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	td.room span {
		display: block;
		white-space: nowrap;
	}

	/* A starter's drop says so, on a second line where the column is narrow (Lane 66u). */
	td.room span.wraps {
		white-space: normal;
	}

	td.room span + span {
		color: var(--ink-3);
	}

	.opened > td {
		padding: 0 var(--s-3) var(--s-3) 0;
		border-bottom: 1px solid var(--line);
	}

	.inner {
		width: 100%;
		table-layout: fixed;
		border-collapse: separate;
		border-spacing: 0;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		overflow: hidden;
	}

	.inner th {
		padding: 0 var(--s-2);
		text-align: left;
		background: var(--bg);
	}

	/* The opened trade's widths, set once in its colgroup, so a phone can fold a column to nothing
	   and give its width to the name. */
	.i-side {
		width: 76px;
	}

	.i-game {
		width: 200px;
	}

	.i-num,
	.i-pts {
		width: 64px;
	}

	.i-ev {
		width: 60px;
	}

	.i-rk {
		width: 88px;
	}

	.i-season {
		width: 120px;
	}

	.inner .cols .ev.first {
		padding-left: var(--s-3);
	}

	/* The trade's week in one line, over its players (review H2). */
	.week-line {
		margin: var(--s-2) 0;
		font-size: var(--t-sm);
		font-weight: 600;
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}

	/* The API's sentence when the drop starts this week: who takes his spot (Lane 66u). */
	.drop-why {
		margin: 0 0 var(--s-2);
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	/* The member's drop, said in the With cell once the Room column folds (review M3). */
	.drop-mid {
		display: none;
	}

	.grp th {
		height: 28px;
		padding-left: var(--s-3);
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
		border-bottom: 1px solid var(--line);
	}

	.acts {
		display: flex;
		justify-content: flex-end;
		gap: var(--s-2);
		padding-top: var(--s-3);
	}

	.said {
		margin: var(--s-2) 0 0;
		text-align: right;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	@media (max-width: 1180px) {
		.c-room {
			width: 0;
		}

		.cols .room {
			padding: 0;
			font-size: 0;
		}

		td.room {
			width: 0;
			max-width: 0;
			padding: 0;
			overflow: hidden;
		}

		td.room > * {
			display: none;
		}

		.wt small.drop-mid {
			display: block;
			color: var(--ink-2);
		}

		.groups td:last-child {
			padding: 0;
		}
	}

	@media (max-width: 900px) {
		.i-ev,
		.i-rk {
			width: 0;
		}

		.inner .cols .ev,
		.inner .cols .ev.first {
			padding: 0;
			font-size: 0;
		}
	}

	/* Below 900 px, as on a phone, a trade folds to its two sides and the other team under them, then both gains; the
	   week's change and the room wait in the opened rows and the builder. */
	@media (max-width: 900px) {
		.finder {
			table-layout: fixed;
		}

		.groups {
			display: none;
		}

		.c-op {
			width: 36px;
		}

		.c-give {
			width: auto;
		}

		.c-get,
		.c-with,
		.c-w {
			width: 0;
		}

		.cols .get,
		.cols .with,
		.cols .fig.week {
			padding: 0;
			font-size: 0;
		}

		.c-g {
			width: 60px;
		}

		.desk {
			display: none;
		}

		.phone {
			display: inline;
			white-space: normal;
			text-transform: none;
			letter-spacing: 0;
		}

		.cols th {
			height: auto;
			padding-block: 6px;
			white-space: normal;
		}

		.trade > td {
			padding: var(--s-2) 4px;
		}

		td.get,
		td.with,
		td.w {
			width: 0;
			max-width: 0;
			padding: 0 !important;
			overflow: hidden;
			font-size: 0;
		}

		td.get > *,
		td.with > * {
			display: none;
		}

		.give .mp {
			display: none;
		}

		.ph-deal {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 4px;
			font-size: var(--t-sm);
			line-height: 1.25;
		}

		.ph-deal :global(svg) {
			transform: rotate(-90deg);
			color: var(--ink-3);
		}

		.ph-deal .in {
			color: var(--accent-text);
		}

		.ph-with {
			display: block;
			margin-top: 2px;
			font-size: var(--t-xs);
			color: var(--ink-3);
		}

		.g {
			font-size: var(--t-lg);
		}

		.why {
			width: 28px;
			height: 28px;
		}

		.opened > td {
			padding: 0 var(--s-2) var(--s-2);
		}

		.opened > td.edge {
			width: 0;
			padding: 0;
		}

		.i-side {
			width: 54px;
		}

		.i-game {
			width: 150px;
		}

		.i-pts {
			width: 30px;
		}

		.i-num {
			width: 44px;
		}

		.i-season {
			width: 56px;
		}

		.inner .cols .season {
			white-space: normal;
		}

		.week-line {
			font-size: var(--t-xs);
		}

		.acts {
			flex-direction: column;
		}

		.said {
			text-align: left;
			font-size: var(--t-xs);
		}

		/* The opened rows keep the opponent and kickoff under the name on a phone; the expected score
		   and weather wait on the Lineup and Matchup. */
		.inner :global(.phone-game .facts) {
			display: none;
		}
	}

	/* On a phone the opened rows read cleanly (review H2): the game folds under the name in one line,
	   Pts (nothing before kickoff) gives its width to the name, and a name keeps to one line. */
	@media (max-width: 760px) {
		.i-game,
		.i-pts {
			width: 0;
		}

		.inner .cols .game,
		.inner .cols .pts,
		.inner :global(td.pts) {
			padding: 0;
			font-size: 0;
		}

		.inner :global(.nm) {
			flex-wrap: nowrap;
		}

		.inner :global(.nm a),
		.inner :global(.nm b) {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.inner :global(.phone-game .opp) {
			white-space: nowrap;
		}
	}
</style>
