<script lang="ts">
	import type { LeagueHost } from '#lib/league/api.ts';
	import { BOX, boxNumber, easeOf, oppRankWord } from '#lib/league/box/box.ts';
	import BoxGame from '#lib/league/box/BoxGame.svelte';
	import BoxPlayer from '#lib/league/box/BoxPlayer.svelte';
	import { tabHref } from '#lib/league/inseason/tabs.ts';
	import MoveLink from '#lib/ui/MoveLink.svelte';
	import OppRank from '#lib/ui/OppRank.svelte';
	import RosterChip from '#lib/ui/RosterChip.svelte';
	import type { WeekOrderAdvice } from './api.ts';
	import { ORDER, moveHref, moveWords } from './order.ts';
	import { foldedEvidence, WEEK_TAB, type WeekSection, type WeekView } from './week.ts';

	/** The kickers' or defenses' week as a box score (Lane 66w): the player (his face or the club's
	 * mark), his game, Proj big when the week's projection is in, then Opp rank, Avg and Last ruled off,
	 * and in a league his roster and the add the API sets. Games kicked off sit under their own head
	 * with a muted Proj, the byes last. Below 1100 px the evidence folds under the name; below 900 the
	 * roster mark moves onto his club line and the add keeps its glyph; on a phone the game folds too. */
	interface Props {
		label: string;
		sections: readonly WeekSection[];
		/** The Proj column: drawn only once a row has one. */
		proj: boolean;
		league: { id: string; host: LeagueHost; moves: WeekOrderAdvice['moves'] } | null;
	}

	let { label, sections, proj, league }: Props = $props();

	const marked = $derived(league !== null);
	/** Every column, for a section head across the row. */
	const span = $derived(2 + (proj ? 1 : 0) + 3 + (marked ? 2 : 0));
</script>

<table class="week" class:marked aria-label={label}>
	<thead>
		<tr>
			<th scope="col">{BOX.player}</th>
			<th class="game" scope="col">{BOX.game}</th>
			{#if proj}<th class="n proj" scope="col">{BOX.proj}</th>{/if}
			<th class="n ev first opp" scope="col">{BOX.oppRank}</th>
			<th class="n ev" scope="col">{BOX.avg}</th>
			<th class="n ev" scope="col">{BOX.last}</th>
			{#if marked}
				<th class="roster" scope="col">{ORDER.roster}</th>
				<th class="act" scope="col"><span class="vh">{WEEK_TAB.add}</span></th>
			{/if}
		</tr>
	</thead>
	{#each sections as section (section.key)}
		<tbody class={section.key}>
			{#if section.head}
				<tr class="sec"><th colspan={span} scope="colgroup">{section.head}</th></tr>
			{/if}
			{#each section.rows as row (row.key)}
				{@render line(row)}
			{/each}
		</tbody>
	{/each}
</table>

{#snippet line(row: WeekView)}
	{@const rank = row.box.evidence.oppRank}
	{@const href = moveHref(row, league?.id ?? null, tabHref)}
	<tr class:mine={row.roster?.kind === 'yours'}>
		<td class="player">
			<BoxPlayer row={row.box}>
				{#snippet after()}{#if row.roster}<span class="ph-mark"
							><RosterChip kind={row.roster.kind} words={row.roster.words} size="fold" /></span
						>{/if}{/snippet}
				<span class="ph-ev">{foldedEvidence(row)}</span>
			</BoxPlayer>
		</td>
		<td class="game"><BoxGame row={row.box} /></td>
		{#if proj}<td class="n proj">{boxNumber(row.box.proj)}</td>{/if}
		<td class="n ev first opp"
			><OppRank
				text={oppRankWord(rank)}
				ease={rank === null ? null : easeOf(rank, row.box.evidence.oppOf)}
			/></td
		>
		<td class="n ev">{boxNumber(row.box.evidence.avg)}</td>
		<td class="n ev">{boxNumber(row.box.evidence.last)}</td>
		{#if league !== null}
			<td class="roster"
				>{#if row.roster}<RosterChip kind={row.roster.kind} words={row.roster.words} />{/if}</td
			>
			<td class="act">
				{#if href !== null && row.move !== null}
					<MoveLink
						{href}
						move={row.move}
						said={moveWords(row, league.moves, league.host)}
						name={row.box.name}
					/>
				{/if}
			</td>
		{/if}
	</tr>
{/snippet}

<style>
	.week {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		overflow: hidden;
	}

	thead th {
		height: 30px;
		padding: 0 var(--s-2);
		text-align: left;
		background: var(--bg);
		font-size: var(--t-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
		border-bottom: 1px solid var(--line);
		white-space: nowrap;
	}

	thead .n {
		text-align: right;
	}

	thead .game {
		width: 220px;
	}

	thead .proj {
		width: 72px;
	}

	thead .ev {
		width: 64px;
	}

	thead .opp {
		width: 92px;
	}

	thead .roster {
		width: 168px;
		padding-left: var(--s-4);
	}

	thead .act {
		width: 148px;
	}

	.sec th {
		height: 26px;
		padding: 0 var(--s-2);
		text-align: left;
		background: var(--bg);
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-2);
		border-bottom: 1px solid var(--line);
	}

	td {
		padding: 6px var(--s-2);
		border-bottom: 1px solid var(--line);
		vertical-align: middle;
	}

	tr {
		height: var(--row-h);
	}

	tbody tr:not(.sec):hover td {
		background: var(--surface-2);
	}

	tbody:last-child tr:last-child td {
		border-bottom: 0;
	}

	.mine td {
		background: color-mix(in srgb, var(--accent) 7%, var(--surface));
	}

	.mine td:first-child {
		box-shadow: inset 3px 0 0 var(--accent);
	}

	.n {
		text-align: right;
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	td.game {
		font-size: var(--t-sm);
	}

	/* Proj is the big figure the rows sort on. */
	td.proj {
		font-size: var(--t-xl);
		font-weight: 800;
		color: var(--ink);
	}

	/* A game kicked off keeps the Proj it had, muted: its row no longer sorts on it. */
	.kicked_off td.proj {
		font-size: var(--t-lg);
		font-weight: 600;
		color: var(--ink-3);
	}

	.ev {
		font-size: var(--t-md);
		font-weight: 600;
		color: var(--ink-2);
	}

	.ev.first {
		border-left: 1px solid var(--line);
	}

	td.roster {
		max-width: 168px;
		padding-left: var(--s-4);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.act {
		text-align: right;
		white-space: nowrap;
	}

	.ph-mark,
	.ph-ev {
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

	/* Below a wide screen the season's figures fold under the name, as the order's do. */
	@media (max-width: 1100px) {
		.ev {
			display: none;
		}

		.ph-ev {
			display: block;
			font-size: var(--t-xs);
			color: var(--ink-3);
			font-variant-numeric: tabular-nums;
		}
	}

	/* Below 900 px the roster mark moves onto his club line. */
	@media (max-width: 900px) {
		.roster {
			display: none;
		}

		.ph-mark {
			display: inline-flex;
			min-width: 0;
			max-width: 132px;
		}

		thead .act {
			width: 40px;
		}
	}

	@media (max-width: 760px) {
		td {
			padding: 7px 6px;
		}

		tr {
			height: auto;
		}

		.game {
			display: none;
		}

		thead .proj {
			width: 52px;
		}

		td.proj {
			font-size: var(--t-lg);
		}

		.kicked_off td.proj {
			font-size: var(--t-md);
		}
	}
</style>
