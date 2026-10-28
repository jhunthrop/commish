<script lang="ts">
	import type { Snippet } from 'svelte';
	import { memberZone } from '#lib/format/clock.ts';
	import type { PlayerLine } from '../inseason/api.ts';
	import { rosterRow } from '../inseason/builder.ts';
	import { BOX, boxRow, type BoxPick } from './box.ts';
	import BoxLine from './BoxLine.svelte';
	import TeamAvatar from './TeamAvatar.svelte';
	import { rosterOrder, TRADES } from './trades.ts';

	/** One roster of the trade builder as a box score (Lane 66g; the Lineup's rows since Lane 268): the
	 * team over the columns (a tick, the player with his position and our rank under his name (Lane
	 * 260), his game, Proj, Opp rank, Avg, Last, Rest of season), each row a tap that picks him for the
	 * trade, at the Lineup table's row height and type. */
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
		/** Drawn in place of the team's name and record: the other side's team choice (Lane 268). */
		choose?: Snippet;
	}

	let { team, mine = false, aside, holds, lines, pickOf, now, choose }: Props = $props();
	const zone = memberZone();
	const rows = $derived(rosterOrder(lines));
	/** The columns: the tick, the player, his game, Proj, Opp rank, Avg, Last and Rest of season. */
	const COLUMNS = 8;
</script>

<table class="box" class:mine aria-label={team === '' ? undefined : team}>
	<!-- The columns' widths, set once: the team's head spans them, so no row of cells sets them. -->
	<colgroup>
		<col class="c-tk" />
		<col />
		<col class="c-game" />
		<col class="c-num" />
		<col class="c-rk" />
		<col class="c-ev" />
		<col class="c-ev" />
		<col class="c-season" />
	</colgroup>
	<thead>
		<tr class="team">
			<th colspan={COLUMNS} scope="colgroup">
				<span class="tm">
					{#if choose}
						{@render choose()}
					{:else}
						<TeamAvatar name={team} size={20} me={mine} />
						<span class="tn">{team}</span>
						{#if mine}<span class="you">{BOX.you}</span>{/if}
						<span class="aside">{aside}</span>
					{/if}
					<span class="holds">{holds}</span>
				</span>
			</th>
		</tr>
		<tr class="cols">
			<th class="tk" scope="col"><span class="vh">{BOX.pick}</span></th>
			<th scope="col">{BOX.player}</th>
			<th class="game" scope="col">{BOX.game}</th>
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
				slotCell={false}
				ptsCell={false}
				gameFacts={false}
				evidence
				season
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
		height: 28px;
		border-bottom: 2px solid var(--line-strong);
	}

	.mine .team th {
		border-bottom-color: var(--accent);
	}

	.tm {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		min-width: 0;
	}

	.tn {
		min-width: 0;
		font-weight: 700;
		font-size: var(--t-sm);
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
		font-size: var(--t-xs);
		font-weight: 500;
		color: var(--ink-3);
		white-space: nowrap;
	}

	.holds {
		flex: none;
		margin-left: auto;
		font-size: var(--t-xs);
		font-weight: 600;
		color: var(--ink-2);
		white-space: nowrap;
	}

	.cols th {
		height: 22px;
		white-space: nowrap;
		font-size: var(--t-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		line-height: 1.05;
		color: var(--ink-3);
		background: var(--bg);
		border-bottom: 1px solid var(--line);
	}

	/* The Lineup's row height (52px, Lane 268): the cells' padding a little tighter, as the pill
	   rides the club line here where the Lineup gives it a cell of its own. */
	.box :global(tbody td) {
		padding-block: 4px;
	}

	/* The face a little closer to the name, so a status as long as Questionable keeps its line. */
	.box :global(.pl) {
		gap: 6px;
	}

	/* His club, pill and status on one line, the status giving way last, so a row keeps its height. */
	.box :global(.club) {
		flex-wrap: nowrap;
		min-width: 0;
		white-space: nowrap;
	}

	.box :global(.club .status-chip) {
		display: inline-block;
		min-width: 0;
		height: 20px;
		line-height: 20px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* The game in two short lines, opponent over kickoff, so the player keeps his room. */
	.box :global(td.game .opp) {
		flex-direction: column;
		gap: 0;
		font-size: var(--t-xs);
	}

	.c-tk {
		width: 36px;
	}

	.c-game {
		width: 76px;
	}

	.c-num {
		width: 46px;
	}

	.c-ev {
		width: 40px;
	}

	.c-rk {
		width: 50px;
	}

	.c-season {
		width: 64px;
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
			text-align: right;
		}

		.c-tk {
			width: 30px;
		}

		.c-game {
			width: 0;
		}

		.cols .game {
			padding: 0;
			font-size: 0;
		}

		.c-num {
			width: 42px;
		}

		.c-season {
			width: 56px;
		}

		.cols .season {
			padding: 0 4px 0 0;
		}

		/* A phone's row is two lines, his name over his club, pill and game: Avg and Last stay the
		   desk's, so seven rows and more show above the pinned verdict (Lane 268). */
		.box :global(.phone-ev) {
			display: none;
		}

		.box :global(.who) {
			flex-direction: row;
			flex-wrap: wrap;
			align-items: center;
			column-gap: 6px;
		}

		.box :global(.who .nm) {
			flex-basis: 100%;
		}

		.box :global(.who .phone-game) {
			flex-direction: row;
		}
	}
</style>
