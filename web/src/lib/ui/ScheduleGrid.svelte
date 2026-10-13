<script lang="ts">
	import Face from './Face.svelte';
	import type { ScheduleRow } from './schedule-grid.ts';

	/** Every club's slate, one row each: the club's face and name lead, its rank follows in the number
	 * face with the strength, then a week grid that scrolls sideways in its own frame, so the page
	 * never runs past its width. Each week names the opponent (at or vs) and his number, and a week
	 * against one of the strongest opponents is shaded; the page states that population. */
	interface Props {
		rows: readonly ScheduleRow[];
		weeks: readonly number[];
		/** Names the grid for assistive tech and as its caption. */
		caption: string;
		/** The strength column's head: "Opp. avg wins". */
		strengthLabel: string;
	}

	let { rows, weeks, caption, strengthLabel }: Props = $props();
</script>

<div class="frame" role="region" aria-label={caption} tabindex="-1">
	<table>
		<caption>{caption}</caption>
		<thead>
			<tr>
				<th scope="col" class="club">Club</th>
				<th scope="col" class="rank">Rank</th>
				<th scope="col" class="strength">{strengthLabel}</th>
				{#each weeks as week (week)}
					<th scope="col" class="week">Wk {week}</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as row (row.abbr)}
				<tr>
					<th scope="row" class="club">
						<span class="who">
							<Face src={row.face} size={32} />
							<a href={row.href}>{row.name}</a>
						</span>
					</th>
					<td class="rank"><b>{row.rank}</b></td>
					<td class="strength">{row.strength}</td>
					{#each row.cells as cell (cell.week)}
						{#if cell.opponent === null}
							<td class="week bye">Bye</td>
						{:else}
							<td class="week" class:hard={cell.hard}>
								<span class="opp">{cell.home ? 'vs' : 'at'} {cell.opponent}</span>
								<span class="value">{cell.value}</span>
							</td>
						{/if}
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.frame {
		overflow-x: auto;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
	}

	table {
		border-collapse: separate;
		border-spacing: 0;
		width: max-content;
		min-width: 100%;
		font-size: var(--t-sm);
	}

	caption {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}

	th,
	td {
		height: var(--row-h);
		padding: 0 var(--s-3);
		border-bottom: 1px solid var(--line);
		background: var(--bg);
		text-align: left;
		white-space: nowrap;
	}

	thead th {
		height: auto;
		padding-block: var(--s-2);
		font-size: var(--t-xs);
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
	}

	/* The club, its rank and its strength stay put while the weeks scroll under them. */
	.club {
		position: sticky;
		left: 0;
		z-index: 1;
		width: 220px;
		min-width: 220px;
	}

	.rank {
		position: sticky;
		left: 220px;
		z-index: 1;
		width: 64px;
		text-align: right;
	}

	.strength {
		position: sticky;
		left: 284px;
		z-index: 1;
		width: 96px;
		text-align: right;
		font-variant-numeric: tabular-nums;
		border-right: 1px solid var(--line-strong);
	}

	.who {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		font-size: var(--t-md);
		font-weight: 600;
	}

	.who a {
		text-decoration: none;
	}

	.who a:hover {
		text-decoration: underline;
	}

	.rank b {
		font-family: var(--font-num);
		font-weight: 700;
		font-size: var(--t-xl);
		font-variant-numeric: tabular-nums;
	}

	.week {
		min-width: 64px;
		text-align: center;
	}

	td.week {
		line-height: 1.2;
	}

	.opp,
	.value {
		display: block;
	}

	.value {
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}

	.hard {
		background: var(--surface-2);
		font-weight: 600;
	}

	.hard .value {
		color: var(--ink-2);
	}

	.bye {
		color: var(--ink-3);
	}

	@media (max-width: 760px) {
		.club {
			width: 168px;
			min-width: 168px;
		}

		.rank,
		.strength {
			position: static;
		}
	}
</style>
