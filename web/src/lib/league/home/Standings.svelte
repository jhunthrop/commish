<script lang="ts">
	import { fixed } from '#lib/format/number.ts';
	import TeamAvatar from '../box/TeamAvatar.svelte';
	import { BOX } from '../box/box.ts';
	import { FIGURE_WORDS, chanceCell } from './figures.ts';
	import type { LeagueHost, LeagueTerms } from '../api.ts';
	import {
		HOME,
		playoffRule,
		recordCell,
		seedingWords,
		sortStandings,
		waiverCell,
		waiverColumn,
		type StandingsKey,
		type StandingsRow
	} from './home.ts';

	/** The standings as a box score (Lane 66i): rank, the team with its avatar and manager, W-L-T,
	 * points for and against, the streak, this week's projection and the waiver column (budget left
	 * or order), the drafter's row tinted, an orange rule under the last playoff spot. Each number
	 * column sorts, best first; the rank puts the platform's order back. A phone keeps rank, team,
	 * record, PF and Proj, the streak under the name. */
	interface Props {
		rows: readonly StandingsRow[];
		terms: LeagueTerms;
		/** The league's platform, named where it seeds the playoffs its own way. */
		host: LeagueHost;
		/** Whether a projection column shows: the week has one. */
		projected: boolean;
		/** The playoff chance's sentence when every team has one (Lane 298), null to draw no column. */
		chanceBasis?: string | null;
	}

	let { rows, terms, host, projected, chanceBasis = null }: Props = $props();
	const chance = $derived(chanceBasis !== null);

	/** How the platform seeds its playoffs, said under the table where no cut can show it. */
	const seeding = $derived(seedingWords(terms, host));

	let sortBy = $state<StandingsKey>('rank');
	const sorted = $derived(sortStandings(rows, sortBy, terms));
	const waiver = $derived(waiverColumn(terms));
	const rule = $derived(sortBy === 'rank' ? playoffRule(terms, rows.length) : null);
	const columns = $derived(6 + (chance ? 1 : 0) + (projected ? 1 : 0) + (waiver === null ? 0 : 1));

	function number(value: number | null): string {
		return value === null ? BOX.none : fixed(value, 1);
	}
</script>

{#snippet head(key: StandingsKey, label: string, cls: string)}
	<th
		class="n {cls}"
		scope="col"
		aria-sort={sortBy === key
			? key === 'rank' || key === 'pa'
				? 'ascending'
				: 'descending'
			: undefined}
	>
		<button type="button" class:on={sortBy === key} onclick={() => (sortBy = key)}>{label}</button>
	</th>
{/snippet}

<section class="stand" aria-label={HOME.standings}>
	<h2>{HOME.standings}</h2>
	<table class="standings">
		<thead>
			<tr>
				{@render head('rank', HOME.rank, 'rk')}
				<th class="tm" scope="col">{HOME.team}</th>
				{@render head('record', HOME.record, 'wl')}
				{#if chance}{@render head('chance', FIGURE_WORDS.chance, 'pc')}{/if}
				{@render head('pf', HOME.pointsFor, 'pf')}
				{@render head('pa', HOME.pointsAgainst, 'pa')}
				<th class="sk" scope="col">{HOME.streak}</th>
				{#if projected}{@render head('proj', BOX.proj, 'pj')}{/if}
				{#if waiver !== null}{@render head('waiver', waiver, 'wv')}{/if}
			</tr>
		</thead>
		<tbody>
			{#each sorted as row (row.team.roster_id)}
				<tr class:me={row.me} class:cut={rule !== null && row.rank === rule.after}>
					<td class="n rk">{row.rank}</td>
					<td class="tm">
						<span class="tmw">
							<TeamAvatar name={row.team.name} size={30} me={row.me} src={row.team.avatar} />
							<span class="tmn">
								<b>{row.team.name}</b>
								{#if row.team.owner !== '' && row.team.owner !== row.team.name}<span class="mg"
										>{row.team.owner}</span
									>{/if}
								{#if row.team.streak}<span class="phone-streak"
										><span class="stk" class:win={row.team.streak.startsWith('W')}
											>{row.team.streak}</span
										></span
									>{/if}
							</span>
						</span>
					</td>
					<td class="n wl">{recordCell(row.team)}</td>
					{#if chance}<td class="n pc" data-figure="playoff-chance">{chanceCell(row.team)}</td>{/if}
					<td class="n pf">{fixed(row.team.points_for, 1)}</td>
					<td class="n pa">{number(row.team.points_against)}</td>
					<td class="sk"
						>{#if row.team.streak}<span class="stk" class:win={row.team.streak.startsWith('W')}
								>{row.team.streak}</span
							>{:else}<span class="none">{BOX.none}</span>{/if}</td
					>
					{#if projected}<td class="n pj">{number(row.proj)}</td>{/if}
					{#if waiver !== null}<td class="n wv">{waiverCell(row.team, terms)}</td>{/if}
				</tr>
				{#if rule !== null && row.rank === rule.after}
					<tr class="rule" aria-hidden="true"
						><td colspan={columns}><span>{rule.words}</span></td></tr
					>
				{/if}
			{/each}
		</tbody>
	</table>
	{#if seeding}<p class="seeding">{seeding}</p>{/if}
	{#if chanceBasis !== null}<p class="chance" data-basis="playoff-chance">{chanceBasis}</p>{/if}
</section>

<style>
	h2 {
		margin: 0 0 var(--s-2);
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-xl);
		line-height: 1;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}

	.standings {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		overflow: hidden;
	}

	th,
	td {
		padding: 0 var(--s-2);
		border-bottom: 1px solid var(--line);
		text-align: left;
		vertical-align: middle;
	}

	thead th {
		height: 32px;
		font-size: var(--t-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
		background: var(--bg);
		white-space: nowrap;
	}

	th button {
		all: unset;
		cursor: pointer;
	}

	th button:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}

	th button.on {
		color: var(--ink);
	}

	.n {
		text-align: right;
	}

	.rk {
		width: 40px;
		text-align: center;
	}

	tbody tr:not(.rule) {
		height: 50px;
	}

	tbody tr:not(.rule):hover td {
		background: var(--surface-2);
	}

	td.rk {
		font-family: var(--font-num);
		font-weight: 700;
		font-size: var(--t-lg);
		color: var(--ink-3);
	}

	.tmw {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		min-width: 0;
	}

	.tmn {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.tmn b {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 26ch;
	}

	.mg {
		font-size: var(--t-xs);
		color: var(--ink-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.wl,
	.pc,
	.pf,
	.pa,
	.pj,
	.wv {
		font-family: var(--font-num);
		font-size: var(--t-lg);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	td.pa,
	td.pj,
	td.wv {
		color: var(--ink-2);
	}

	thead .pa,
	thead .pc,
	thead .pj,
	thead .wv,
	thead .wl,
	thead .pf {
		font-family: var(--font-ui);
		font-size: var(--t-xs);
		font-weight: 600;
	}

	.sk {
		width: 64px;
	}

	.stk {
		display: inline-flex;
		align-items: center;
		height: 22px;
		padding: 0 7px;
		border-radius: var(--r-sm);
		font-family: var(--font-num);
		font-weight: 700;
		font-size: var(--t-md);
		letter-spacing: 0.02em;
		background: var(--loss-bg);
		color: var(--loss-ink);
	}

	.stk.win {
		background: var(--gain-bg);
		color: var(--gain-ink);
	}

	.none {
		color: var(--ink-3);
	}

	.phone-streak {
		display: none;
	}

	tr.me td {
		background: var(--accent-wash);
	}

	tr.me td:first-child {
		box-shadow: inset 3px 0 0 var(--accent);
		color: var(--accent-text);
	}

	tr.cut td {
		border-bottom: 2px solid var(--accent);
	}

	.seeding {
		margin: var(--s-2) 0 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	/* The chance's head wraps to two short lines over its narrow column. */
	thead th.pc {
		white-space: normal;
		width: 64px;
		line-height: 1.1;
	}

	td.pc {
		font-weight: 700;
	}

	.chance {
		margin: var(--s-2) 0 0;
		font-size: var(--t-sm);
		color: var(--ink-3);
		line-height: 1.5;
	}

	tr.rule td {
		height: 0;
		padding: 0;
		border: 0;
		position: relative;
	}

	tr.rule span {
		position: absolute;
		right: var(--s-2);
		top: -9px;
		padding: 0 6px;
		background: var(--surface);
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--accent-text);
		line-height: 16px;
		border-radius: var(--r-sm);
	}

	@media (max-width: 760px) {
		.pa,
		.sk,
		.wv,
		.mg {
			display: none;
		}

		th,
		td {
			padding: 0 4px;
		}

		.rk {
			width: 28px;
		}

		tbody tr:not(.rule) {
			height: auto;
		}

		tbody td {
			padding-block: 7px;
		}

		.wl,
		.pc,
		.pf,
		.pj {
			font-size: var(--t-md);
		}

		thead th.pc {
			width: 50px;
		}

		.chance {
			font-size: var(--t-xs);
			line-height: 1.45;
		}

		.tmn b {
			font-size: var(--t-sm);
			max-width: 16ch;
		}

		.phone-streak {
			display: block;
			margin-top: 2px;
		}

		.phone-streak .stk {
			height: 16px;
			font-size: var(--t-xs);
			padding: 0 4px;
		}
	}
</style>
