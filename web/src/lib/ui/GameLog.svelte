<script lang="ts">
	import type { LogHead, LogRow, SeasonLine } from './game-log.ts';

	/** A player's season week by week: the season line first, each number captioned with its full
	 * words, then every week of the regular season with its opponent and his line. The week and the
	 * opponent stay put while the stat columns scroll sideways in their own frame on a phone, and a
	 * fade at the frame's end says there is more until the last column is in view. A player with no
	 * line yet gets one sentence instead of a table. */
	interface Props {
		/** Names the log for assistive tech. */
		caption: string;
		heads: readonly LogHead[];
		/** Null when he has no game yet. */
		line: SeasonLine | null;
		rows: readonly LogRow[];
		/** The sentence printed in the table's place when there is no line. */
		none: string;
	}

	let { caption, heads, line, rows, none }: Props = $props();
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
						{#each line.cells as cell, i (i)}
							<td><b>{cell.value}</b><span>{cell.caption}</span></td>
						{/each}
					</tr>
					{#each rows as row (row.week)}
						<tr class={row.tone}>
							<th scope="row" class="pin wk">{row.week}</th>
							<td class="pin opp">{row.opponent}</td>
							{#if row.cells}
								{#each row.cells as cell, i (i)}
									<td class="n">{cell}</td>
								{/each}
							{:else}
								<td class="note" colspan={heads.length}>{row.note}</td>
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

	/* The pinned columns' widths, which the opponent's offset is built from. */
	.frame {
		--wk-w: 52px;
		--opp-w: 84px;
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

	/* The week and the opponent stay put while the stat columns scroll under them. */
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

	.opp,
	.lead {
		border-right: 1px solid var(--line-strong);
	}

	.opp {
		left: var(--wk-w);
		width: var(--opp-w);
		min-width: var(--opp-w);
	}

	.lead {
		left: 0;
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
		font-size: 20px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	/* Points close the line, set off from the counts that make them. */
	.n:last-child,
	.season td:last-child {
		border-left: 1px solid var(--line);
	}

	.played .opp {
		font-weight: 600;
	}

	.quiet .wk,
	.quiet .opp,
	.bye .wk,
	.bye .opp,
	.note {
		color: var(--ink-3);
	}

	.note {
		text-align: start;
	}

	.bye > * {
		background: var(--surface);
	}

	@media (max-width: 760px) {
		.frame {
			--wk-w: 40px;
			--opp-w: 72px;
		}

		th,
		td {
			padding-inline: var(--s-2);
		}
	}
</style>
