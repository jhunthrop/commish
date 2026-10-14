<script lang="ts">
	import Face from './Face.svelte';
	import type { ScheduleRow } from './schedule-grid.ts';

	/** Every club's slate, one row each: the club's face and name lead, its rank follows in the number
	 * face with the strength, then a week grid that scrolls sideways in its own frame, so the page
	 * never runs past its width. On the phone the rank leads the club's name and the strength stays
	 * pinned beside it, so only the weeks scroll. Each week names the opponent (at or vs) and his number, and a week
	 * against one of the strongest opponents is shaded; the page states that population. */
	interface Props {
		rows: readonly ScheduleRow[];
		weeks: readonly number[];
		/** Names the grid for assistive tech and as its caption. */
		caption: string;
		/** The strength column's head: "Opp. avg wins". */
		strengthLabel: string;
		/** The last week played, 0 before the first kickoff: weeks up to it are set back, so what is
		 * left reads at a glance. The page's lead says so. */
		played?: number;
	}

	let { rows, weeks, caption, strengthLabel, played = 0 }: Props = $props();
</script>

<!-- The frame scrolls, so it takes focus: a keyboard reaches week 18 with the arrow keys. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="frame" role="region" aria-label={caption} tabindex="0">
	<table>
		<caption>{caption}</caption>
		<thead>
			<tr>
				<th scope="col" class="club">Club</th>
				<th scope="col" class="rank">Rank</th>
				<th scope="col" class="strength">{strengthLabel}</th>
				{#each weeks as week (week)}
					<th scope="col" class="week" class:played={week <= played}>Wk {week}</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as row (row.abbr)}
				<tr>
					<th scope="row" class="club">
						<span class="who">
							<span class="rank-lead" aria-hidden="true">{row.rank}</span>
							<Face src={row.face?.src ?? null} size={32} />
							<span class="names">
								<a href={row.href}>{row.name}</a>
								{#if row.face}<span class="face-name">{row.face.name}</span>{/if}
							</span>
						</span>
					</th>
					<td class="rank"><b>{row.rank}</b></td>
					<td class="strength">{row.strength}</td>
					{#each row.cells as cell (cell.week)}
						{#if cell.opponent === null}
							<td class="week bye" class:played={cell.week <= played}>Bye</td>
						{:else}
							<td class="week" class:hard={cell.hard} class:played={cell.week <= played}>
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
	/* The sticky columns' widths, which the next column's offset is built from. */
	.frame {
		--club-w: 220px;
		--rank-w: 64px;
		--strength-w: 96px;
		overflow-x: auto;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
	}

	.frame:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
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
		width: var(--club-w);
		min-width: var(--club-w);
	}

	.rank {
		position: sticky;
		left: var(--club-w);
		z-index: 1;
		width: var(--rank-w);
		text-align: right;
	}

	.strength {
		position: sticky;
		left: calc(var(--club-w) + var(--rank-w));
		z-index: 1;
		width: var(--strength-w);
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

	.names {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.who a {
		text-decoration: none;
	}

	.face-name {
		font-size: var(--t-xs);
		font-weight: 500;
		color: var(--ink-3);
	}

	.who a:hover {
		text-decoration: underline;
	}

	/* The rank is quiet at body size; the strength it comes from carries the number face. */
	.rank b {
		font-weight: 500;
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}

	td.strength {
		font-family: var(--font-num);
		font-weight: 700;
		font-size: var(--t-lg);
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

	/* A played week steps back behind the weeks still to come in muted ink, which holds 4.5:1. */
	.played,
	.played .value {
		color: var(--played-ink);
		font-weight: 400;
	}

	.rank-lead {
		display: none;
	}

	/* The phone keeps the club and its strength in view and scrolls only the weeks: the rank becomes
	   a small lead before the face, the club's cell holds its width (a long name wraps), and the
	   strength pins right after it, so its head is never cut. */
	@media (max-width: 760px) {
		.frame {
			--club-w: 196px;
			--strength-w: 80px;
		}

		.club,
		.strength {
			padding-inline: var(--s-2);
		}

		.club .who {
			width: calc(var(--club-w) - 2 * var(--s-2));
			font-size: var(--t-sm);
		}

		.names a {
			white-space: normal;
		}

		.rank-lead {
			display: inline;
			flex: none;
			min-width: 2ch;
			font-size: var(--t-xs);
			font-weight: 500;
			color: var(--ink-3);
			font-variant-numeric: tabular-nums;
		}

		.rank {
			display: none;
		}

		.strength {
			left: var(--club-w);
			min-width: var(--strength-w);
		}
	}
</style>
