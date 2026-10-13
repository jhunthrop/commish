<script lang="ts">
	import Label from './Label.svelte';
	import type { AheadRow, LogHead, LogRow, SeasonLine } from './game-log.ts';

	/** A player's season week by week: the season line first, each number captioned with its full
	 * words, then every week so far with its opponent, his points and his line, then the weeks still
	 * to play, one compact line each. The week, the opponent and the points stay put while the stat
	 * columns scroll sideways in their own frame on a phone, and a fade at the frame's end says there
	 * is more until the last column is in view. A week he did not play says so under its opponent, so
	 * it never scrolls away. A player with no line yet gets one sentence instead of the table. */
	interface Props {
		/** Names the log for assistive tech. */
		caption: string;
		/** The stat columns, in order. */
		heads: readonly LogHead[];
		/** The points column, pinned after the opponent. */
		pointsHead: LogHead;
		/** Null when he has no game yet. */
		line: SeasonLine | null;
		/** The weeks so far. */
		rows: readonly LogRow[];
		/** The weeks still to play. */
		ahead: readonly AheadRow[];
		/** The sentence printed in the table's place when there is no line. */
		none: string;
	}

	let { caption, heads, pointsHead, line, rows, ahead, none }: Props = $props();
</script>

{#if line}
	<div class="log">
		<!-- The frame scrolls, so it takes focus: a keyboard reaches the last column with the arrow keys. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div class="frame" role="region" aria-label={caption} tabindex="0">
			<table>
				<caption>{caption}</caption>
				<thead>
					<tr>
						<th scope="col" class="pin wk">Wk</th>
						<th scope="col" class="pin opp">Opp</th>
						<th scope="col" class="pin pts"
							><span aria-hidden="true">{pointsHead.short}</span><span class="sr"
								>{pointsHead.full}</span
							></th
						>
						{#each heads as head, i (i)}
							<th scope="col"
								><span aria-hidden="true">{head.short}</span><span class="sr">{head.full}</span></th
							>
						{/each}
					</tr>
				</thead>
				<tbody>
					<tr class="season">
						<th scope="row" colspan="2" class="pin lead"
							><b>{line.lead}</b><span>{line.sub}</span></th
						>
						<td class="pin pts"><b>{line.points.value}</b><span>{line.points.caption}</span></td>
						{#each line.cells as cell, i (i)}
							<td><b>{cell.value}</b><span>{cell.caption}</span></td>
						{/each}
					</tr>
					{#each rows as row (row.week)}
						<tr class={row.tone}>
							<th scope="row" class="pin wk">{row.week}</th>
							<td class="pin opp"
								>{row.opponent}{#if row.note}<span class="note">{row.note}</span>{/if}</td
							>
							<td class="pin pts n">{row.points ?? ''}</td>
							{#if row.cells}
								{#each row.cells as cell, i (i)}
									<td class="n">{cell}</td>
								{/each}
							{:else}
								<td class="rest" colspan={heads.length}></td>
							{/if}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{:else}
	<p class="none">{none}</p>
{/if}

{#if ahead.length > 0}
	<section class="ahead" aria-label="Still to play">
		<h3><Label>Still to play</Label></h3>
		<ol>
			{#each ahead as week (week.week)}
				<li class:bye={week.bye}>
					<span class="aw">Wk {week.week}</span>
					<span class="ao">{week.opponent}</span>
					<span class="ad">{week.day}</span>
				</li>
			{/each}
		</ol>
	</section>
{/if}

<style>
	.none {
		margin: 0;
		font-size: var(--t-md);
		color: var(--ink-2);
	}

	/* The end fade rides the frame's own scroll: shown while more columns wait to the right, gone at
	 * the last one, and never drawn when the table fits or the browser has no scroll timelines. */
	.log {
		position: relative;
		timeline-scope: --log-scroll;
	}

	.log::after {
		content: '';
		position: absolute;
		inset: 1px 1px 1px auto;
		width: var(--s-6);
		border-radius: 0 var(--r-md) var(--r-md) 0;
		background: linear-gradient(to right, transparent, var(--bg));
		pointer-events: none;
		opacity: 0;
	}

	@supports (animation-timeline: scroll()) {
		.frame {
			scroll-timeline: --log-scroll inline;
		}

		.log::after {
			animation: log-more linear both;
			animation-timeline: --log-scroll;
		}
	}

	@keyframes log-more {
		0%,
		90% {
			opacity: 1;
		}

		100% {
			opacity: 0;
		}
	}

	/* The pinned columns' widths, which each one's offset is built from. The frame is the containing
	 * block of the table's hidden words (caption, .sr), so its scroll clips them: held by .log
	 * instead, they sat out at the last column's edge and widened the phone's page past the viewport,
	 * and the fixed rail moved when the browser widened its layout to match. */
	.frame {
		--wk-w: 52px;
		--opp-w: 104px;
		--pts-w: 84px;
		position: relative;
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
		width: 100%;
		min-width: max-content;
		font-size: var(--t-sm);
	}

	caption,
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	th,
	td {
		height: 44px;
		padding: 0 var(--s-3);
		border-bottom: 1px solid var(--line);
		background: var(--bg);
		text-align: end;
		white-space: nowrap;
	}

	tbody tr:last-child > * {
		border-bottom: 0;
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

	/* The week, the opponent and the points stay put while the stat columns scroll under them. */
	.pin {
		position: sticky;
		z-index: 1;
		text-align: start;
	}

	.wk {
		left: 0;
		width: var(--wk-w);
		min-width: var(--wk-w);
		font-variant-numeric: tabular-nums;
	}

	.opp {
		left: var(--wk-w);
		width: var(--opp-w);
		min-width: var(--opp-w);
		line-height: 1.2;
	}

	.lead {
		left: 0;
	}

	/* Points sit right after the opponent, set off from it by a rule and from the counts that make
	 * them by the pinned edge. */
	.pts {
		left: calc(var(--wk-w) + var(--opp-w));
		width: var(--pts-w);
		min-width: var(--pts-w);
		text-align: end;
		border-left: 1px solid var(--line);
		border-right: 1px solid var(--line-strong);
	}

	/* The season line: each total or rate over the full words of its column. */
	.season > * {
		height: auto;
		padding-block: var(--s-3);
		background: var(--surface);
		border-bottom: 1px solid var(--line-strong);
		vertical-align: top;
	}

	.season b,
	.season span {
		display: block;
	}

	.lead b {
		font-size: var(--t-md);
	}

	.lead span {
		font-weight: 400;
		color: var(--ink-2);
	}

	.season td b {
		font-family: var(--font-num);
		font-size: var(--t-xl);
		font-weight: 700;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	.season td span {
		max-width: 11ch;
		margin: 4px 0 0 auto;
		font-size: var(--t-xs);
		line-height: 1.2;
		color: var(--ink-3);
		white-space: normal;
	}

	.n {
		font-family: var(--font-num);
		font-size: var(--t-lg);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.played .opp {
		font-weight: 600;
	}

	.quiet .wk,
	.quiet .opp,
	.bye .wk,
	.bye .opp {
		color: var(--ink-3);
	}

	/* Why a week has no line, under its opponent in the pinned column. */
	.note {
		display: block;
		font-size: var(--t-xs);
	}

	.bye > * {
		background: var(--surface);
	}

	/* The weeks still to play: one compact line each, as many across as the width holds. */
	.ahead h3 {
		margin: var(--s-4) 0 var(--s-2);
		line-height: 1;
	}

	.ahead ol {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(208px, 1fr));
		column-gap: var(--s-5);
		margin: 0;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--line);
	}

	.ahead li {
		display: grid;
		grid-template-columns: 3.5em 1fr auto;
		align-items: center;
		white-space: nowrap;
		gap: var(--s-2);
		min-height: 32px;
		padding: 0 var(--s-2);
		border-bottom: 1px solid var(--line);
		font-size: var(--t-sm);
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}

	.ahead li.bye {
		color: var(--ink-3);
		background: var(--surface);
	}

	.aw {
		color: var(--ink-3);
	}

	.ad {
		color: var(--ink-3);
	}

	@media (max-width: 760px) {
		.frame {
			--wk-w: 40px;
			--opp-w: 84px;
			--pts-w: 60px;
		}

		th,
		td {
			padding-inline: var(--s-2);
		}

		.ahead ol {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
