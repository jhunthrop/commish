<script lang="ts">
	import { onMount } from 'svelte';
	import { memberZone } from '#lib/format/clock.ts';
	import { BUILD_ZONE } from '#lib/format/day-time.ts';
	import { asOfLine, stateWord, type CurrentWeek } from '#lib/run/schedule-state.ts';
	import { CLUB_PAGE, SCHEDULE_PAGE } from '#lib/site/reference-words.ts';
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
		/** The strength column's head: "Rest of season". Null with no strength to show: no rank or
		 * strength column is drawn (Lane 80's honest empty state). */
		strengthLabel: string | null;
		/** The last complete week, 0 before the first kickoff: its week heads are set back, as each
		 * game in is (its cell's played), so what is left reads at a glance. The lead says so. */
		played?: number;
		/** The week whose cells say their game's state as the run read it, named once under the
		 * grid with the run's read (Lane 223, B187); the grid opens on it where the weeks scroll. */
		current?: CurrentWeek;
	}

	let { rows, weeks, caption, strengthLabel, played = 0, current }: Props = $props();

	/** The member's zone once the page is live, the build's before. */
	let zone = $state(BUILD_ZONE);
	let frame = $state<HTMLDivElement>();
	onMount(() => {
		zone = memberZone();
		openOnCurrent();
	});

	/** Scrolls the weeks so the current week sits first after the pinned columns, measured where they
	 * stick (their sticky `left` plus their width), not where they sit in the flow, which a wider
	 * laid-out club column pushes right (Lane 223 review M1): no sliver of the week before shows. */
	function openOnCurrent(): void {
		if (!frame || current === undefined) return;
		const heads = frame.querySelectorAll<HTMLElement>('thead th');
		const week = frame.querySelector<HTMLElement>(`thead th[data-week="${String(current.week)}"]`);
		const pinnedRight = Math.max(
			0,
			...[...heads].flatMap((head) => {
				const style = getComputedStyle(head);
				return style.position === 'sticky' && style.display !== 'none'
					? [parseFloat(style.left) + head.getBoundingClientRect().width]
					: [];
			})
		);
		if (week) frame.scrollLeft = Math.max(0, week.offsetLeft - pinnedRight);
	}
</script>

<!-- The frame scrolls, so it takes focus: a keyboard reaches week 18 with the arrow keys. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="frame" role="region" aria-label={caption} tabindex="0" bind:this={frame}>
	<table>
		<caption>{caption}</caption>
		<thead>
			<tr>
				<th scope="col" class="club">{SCHEDULE_PAGE.club}</th>
				{#if strengthLabel !== null}
					<th scope="col" class="rank">{SCHEDULE_PAGE.rank}</th>
					<th scope="col" class="strength">{strengthLabel}</th>
				{/if}
				{#each weeks as week (week)}
					<th scope="col" class="week" class:played={week <= played} data-week={week}
						>{SCHEDULE_PAGE.week} {week}</th
					>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as row (row.abbr)}
				<tr>
					<th scope="row" class="club">
						<span class="who">
							{#if row.rank !== null}<span class="rank-lead" aria-hidden="true">{row.rank}</span
								>{/if}
							<Face src={row.face?.src ?? null} size={32} />
							<span class="names">
								<a href={row.href}>{row.name}</a>
								{#if row.face}<span class="face-name">{row.face.name}</span>{/if}
							</span>
						</span>
					</th>
					{#if strengthLabel !== null}
						<td class="rank"><b>{row.rank}</b></td>
						<td class="strength">{row.strength}</td>
					{/if}
					{#each row.cells as cell (cell.week)}
						{#if cell.opponent === null}
							<td class="week bye" class:played={cell.played}>{SCHEDULE_PAGE.bye}</td>
						{:else}
							<td class="week" class:hard={cell.hard} class:played={cell.played}>
								<span class="opp"
									>{cell.home ? CLUB_PAGE.home : CLUB_PAGE.away} {cell.opponent}</span
								>
								<span class="value">{cell.value}</span>
								{#if cell.game}<span class="state">{stateWord(cell.game, zone)}</span>{/if}
							</td>
						{/if}
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>
{#if current}<p class="as-of">{asOfLine(current, zone)}</p>{/if}

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
	.value,
	.state {
		display: block;
	}

	/* The run's state of the current week's game, small under its opponent's number. */
	.state {
		font-size: var(--t-xs);
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}

	.as-of {
		margin: 0;
		font-size: var(--t-xs);
		color: var(--ink-3);
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
	.played .value,
	.played .state {
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
			/* Narrow enough that one whole week, the current one's kickoff with its zone, shows
			   beside the pinned columns at 390 (Lane 223). */
			--club-w: 160px;
			--strength-w: 72px;
		}

		/* Each pinned column is exactly its width, padding inside it, so the next one sticks flush
		   against it and the weeks scroll in from that edge (Lane 223 review M1). */
		.club,
		.strength {
			box-sizing: border-box;
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

		/* Its head wraps to two lines in the narrower pinned column, never cut. */
		thead .strength {
			white-space: normal;
		}
	}
</style>
