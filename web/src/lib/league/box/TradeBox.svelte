<script lang="ts">
	import { memberZone } from '#lib/format/clock.ts';
	import type { PlayerLine } from '../inseason/api.ts';
	import { rosterRow } from '../inseason/builder.ts';
	import { BOX, boxRow, type BoxPick } from './box.ts';
	import BoxLine from './BoxLine.svelte';
	import TeamAvatar from './TeamAvatar.svelte';
	import { rosterOrder, TRADES } from './trades.ts';

	/** One roster of the trade builder as a box score (Lane 66g): the team over the columns (a tick,
	 * the player with his position and our rank under his name (Lane 260) and his game, Proj, Opp rank,
	 * Avg, Last, Rest of season), each row a tap that picks him for the trade. */
	interface Props {
		team: string;
		mine?: boolean;
		/** The team's record and place beside its name. */
		aside: string;
		/** What the side holds now, at the head's right: "You give 1", "Two picked, tap one to put him
		 * back". */
		holds: string;
		lines: readonly PlayerLine[];
		/** Each row's tick by his host id. */
		pickOf: (line: PlayerLine) => BoxPick;
		/** The instant the answer was read, in ms: the page's clock the rows draw at. */
		now: number;
	}

	let { team, mine = false, aside, holds, lines, pickOf, now }: Props = $props();
	const zone = memberZone();
	const rows = $derived(rosterOrder(lines));
</script>

<table class="box" class:mine aria-label={team}>
	<!-- The columns' widths, set once: the team's head spans them, so no row of cells sets them. -->
	<colgroup>
		<col class="c-tk" />
		<col />
		<col class="c-num" />
		<col class="c-rk" />
		<col class="c-ev" />
		<col class="c-ev" />
		<col class="c-season" />
	</colgroup>
	<thead>
		<tr class="team">
			<th colspan="7" scope="colgroup">
				<span class="tm">
					<TeamAvatar name={team} size={30} me={mine} />
					<span class="tn">{team}</span>
					{#if mine}<span class="you">{BOX.you}</span>{/if}
					<span class="aside">{aside}</span>
					<span class="holds">{holds}</span>
				</span>
			</th>
		</tr>
		<tr class="cols">
			<th class="tk" scope="col"><span class="vh">{BOX.pick}</span></th>
			<th scope="col">{BOX.player}</th>
			<th class="n num" scope="col">{BOX.proj}</th>
			<th class="n ev first" scope="col">{BOX.opp}</th>
			<th class="n ev" scope="col">{BOX.avg}</th>
			<th class="n ev" scope="col">{BOX.last}</th>
			<th class="n season" scope="col">{TRADES.perGame}</th>
		</tr>
	</thead>
	<tbody>
		{#each rows as line (line.player.host_id)}
			<BoxLine
				phoneFacts={false}
				phoneOpp={false}
				row={rosterRow(boxRow(line, '', zone, true, now))}
				compact
				evidence
				season
				bench
				pick={pickOf(line)}
			/>
		{/each}
	</tbody>
</table>

<style>
	.box {
		width: 100%;
		table-layout: fixed;
		border-collapse: separate;
		border-spacing: 0;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		overflow: hidden;
	}

	th {
		padding: 0 6px;
		text-align: left;
	}

	.team th {
		height: 52px;
		border-bottom: 2px solid var(--line-strong);
	}

	.mine .team th {
		border-bottom-color: var(--accent);
	}

	.tm {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		flex-wrap: wrap;
		min-width: 0;
	}

	.tn {
		font-weight: 700;
		font-size: var(--t-md);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.you {
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--accent-text);
	}

	.aside {
		font-size: var(--t-sm);
		font-weight: 500;
		color: var(--ink-3);
		white-space: nowrap;
	}

	.holds {
		margin-left: auto;
		font-size: var(--t-sm);
		font-weight: 600;
		color: var(--ink-2);
		white-space: nowrap;
	}

	.cols th {
		height: 34px;
		font-size: var(--t-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		line-height: 1.05;
		color: var(--ink-3);
		background: var(--bg);
		border-bottom: 1px solid var(--line);
	}

	.c-tk {
		width: 40px;
	}

	.c-num {
		width: 52px;
	}

	.c-ev {
		width: 48px;
	}

	.c-rk {
		width: 58px;
	}

	.c-season {
		width: 66px;
	}

	.cols .ev.first {
		border-left: 1px solid var(--line);
	}

	.n {
		text-align: right;
	}

	.vh {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	@media (max-width: 900px) {
		.c-ev,
		.c-rk {
			width: 0;
		}

		.cols .ev,
		.cols .ev.first {
			padding: 0;
			font-size: 0;
			border-left: 0;
		}
	}

	@media (max-width: 760px) {
		.holds {
			white-space: normal;
		}

		.c-tk {
			width: 34px;
		}

		.c-num {
			width: 44px;
		}

		.c-season {
			width: 52px;
		}
	}
</style>
