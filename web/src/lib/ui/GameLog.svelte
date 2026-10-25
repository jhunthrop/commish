<script lang="ts">
	import { EMPTY_FIGURE } from '#lib/format/empty.ts';
	import WeatherGlyph from '#lib/league/box/WeatherGlyph.svelte';
	import Label from './Label.svelte';
	import { PLAYER_PAGE } from '#lib/player/page-words.ts';
	import {
		projShown,
		stillToPlay,
		type AheadRow,
		type LogHead,
		type LogNext,
		type LogRow,
		type PriorRow,
		type SeasonLine
	} from './game-log.ts';

	/** A player's season as a box score (Lane 66h): every week so far with its opponent, the
	 * projection we showed, his points and his line, the week ahead in the accent with this week's
	 * projection and the game's facts, then the season's totals on the scoreboard at the foot, and the
	 * weeks still to play one compact line each. The week and the opponent stay put while the other
	 * columns scroll sideways in their own frame on a phone, and a fade at the frame's end says there
	 * is more until the last column is in view. A week he did not play says so under its opponent. A
	 * player with no line yet gets one sentence instead of the table. */
	interface Props {
		/** Names the log for assistive tech. */
		caption: string;
		/** The stat columns, in order. */
		heads: readonly LogHead[];
		/** The projection column. */
		projHead: LogHead;
		/** The points column. */
		pointsHead: LogHead;
		/** Null when he has no game yet. */
		line: SeasonLine | null;
		/** The weeks so far. */
		rows: readonly LogRow[];
		/** The week ahead, once read; null before or without one. */
		next: LogNext | null;
		/** The weeks still to play. */
		ahead: readonly AheadRow[];
		/** The sentence printed in the table's place when there is no line. */
		none: string;
		/** The projection a past week shows: "--" until our record holds the one we showed. */
		pastProj: string;
		/** His earlier seasons, newest first, collapsed under the totals until opened. */
		prior: readonly PriorRow[];
		/** The toggle's words: "Earlier seasons". */
		priorLabel: string;
	}

	let {
		caption,
		heads,
		projHead,
		pointsHead,
		line,
		rows,
		next,
		ahead,
		none,
		pastProj,
		prior,
		priorLabel
	}: Props = $props();

	/** The earlier seasons start collapsed, as the box's mock had them. */
	let opened = $state(false);
	/** The run's weeks still to play, the read's week shown once in the accent row (Lane 80). */
	const toPlay = $derived(stillToPlay(ahead, next));
	/** No column until a past week keeps its projection (Lane 139, C10). */
	const showProj = $derived(projShown(pastProj, EMPTY_FIGURE));
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
						{#if showProj}
							<th scope="col" class="proj"
								><span aria-hidden="true">{projHead.short}</span><span class="sr"
									>{projHead.full}</span
								></th
							>
						{/if}
						<th scope="col" class="pts"
							><span aria-hidden="true">{pointsHead.short}</span><span class="sr"
								>{pointsHead.full}</span
							></th
						>
						{#each heads as head, i (i)}
							<th scope="col" class:first={i === 0}
								><span aria-hidden="true">{head.short}</span><span class="sr">{head.full}</span></th
							>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.week)}
						<tr class={row.tone}>
							<th scope="row" class="pin wk">{row.week}</th>
							<td class="pin opp"
								>{row.opponent}{#if row.note}<span class="note">{row.note}</span>{/if}</td
							>
							{#if showProj}<td class="proj n dim">{row.tone === 'bye' ? '' : pastProj}</td>{/if}
							<td class="pts n">{row.points ?? ''}</td>
							{#if row.cells}
								{#each row.cells as cell, i (i)}
									<td class="n" class:first={i === 0}>{cell}</td>
								{/each}
							{:else}
								<td class="rest first" colspan={heads.length}></td>
							{/if}
						</tr>
					{/each}
					{#if next}
						<tr class="next">
							<th scope="row" class="pin wk">{next.week}</th>
							<td class="pin opp">{next.opponent}<span class="note">{next.when}</span></td>
							{#if showProj}<td class="proj n">{next.proj}</td>{/if}
							<td class="pts n dim">{EMPTY_FIGURE}</td>
							<td class="facts first" colspan={heads.length}>
								{#if next.expected}<span class="exp">{next.expected}</span>{/if}
								{#if next.weather}<span class="wx"
										><WeatherGlyph glyph={next.weather.glyph} />{next.weather.words}</span
									>{/if}
							</td>
						</tr>
					{/if}
					<tr class="totals">
						<th scope="row" colspan="2" class="pin lead"
							><b>{line.lead}</b><span>{line.sub}</span></th
						>
						{#if showProj}<td class="proj"></td>{/if}
						<td class="pts n">{line.total}</td>
						{#each line.cells as cell, i (i)}
							<td class="n" class:first={i === 0}>{cell.value}</td>
						{/each}
					</tr>
				</tbody>
				{#if prior.length > 0}
					<tbody class="earlier">
						<tr class="toggle">
							<td class="pin lead" colspan="2"
								><button
									type="button"
									aria-expanded={opened}
									aria-controls="earlier-seasons"
									onclick={() => (opened = !opened)}
									><span class="chev" class:open={opened} aria-hidden="true"
									></span>{priorLabel}</button
								></td
							>
							<td class="rest" colspan={heads.length + (showProj ? 2 : 1)}></td>
						</tr>
					</tbody>
					<tbody id="earlier-seasons" hidden={!opened}>
						{#each prior as season (season.season)}
							<tr class="prior">
								<th scope="row" colspan="2" class="pin lead"
									><b>{season.season}</b><span>{season.sub}</span></th
								>
								{#if showProj}<td class="proj"></td>{/if}
								<td class="pts n">{season.total}</td>
								{#each season.cells as cell, i (i)}
									<td class="n" class:first={i === 0}>{cell}</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				{/if}
			</table>
		</div>
	</div>
{:else}
	<p class="none">{none}</p>
{/if}

{#if toPlay.length > 0}
	<section class="ahead" aria-label={PLAYER_PAGE.stillToPlay}>
		<h3><Label>{PLAYER_PAGE.stillToPlay}</Label></h3>
		<ol>
			{#each toPlay as week (week.week)}
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
		background: linear-gradient(to right, transparent, var(--surface));
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
	 * block of the table's hidden words (caption, .sr), so its scroll clips them. */
	.frame {
		--wk-w: 52px;
		--opp-w: 112px;
		position: relative;
		overflow-x: auto;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--surface);
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
		height: var(--row-h);
		padding: 0 var(--s-3);
		border-bottom: 1px solid var(--line);
		background: var(--surface);
		text-align: end;
		white-space: nowrap;
	}

	thead th {
		height: 32px;
		font-size: var(--t-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
		background: var(--bg);
	}

	/* The week and the opponent stay put while the other columns scroll under them. */
	.pin {
		position: sticky;
		z-index: 1;
		text-align: start;
	}

	.wk {
		left: 0;
		width: var(--wk-w);
		min-width: var(--wk-w);
		font-family: var(--font-num);
		font-weight: 700;
		color: var(--ink-2);
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

	/* The stat columns are ruled off from the projection and the points that sum them. */
	.first {
		border-left: 1px solid var(--line);
	}

	.n {
		font-family: var(--font-num);
		font-size: var(--t-lg);
		font-weight: 600;
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}

	.pts.n {
		font-size: var(--t-xl);
		font-weight: 700;
		color: var(--ink);
	}

	.proj.n {
		font-weight: 700;
	}

	.dim {
		color: var(--ink-3);
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

	/* Why a week has no line, or when the week ahead kicks off, under its opponent. */
	.note {
		display: block;
		font-size: var(--t-xs);
		font-weight: 400;
		color: var(--ink-3);
	}

	.bye > * {
		background: var(--bg);
	}

	/* The week ahead: the accent's wash and rule, its projection in the accent, the game's facts. */
	.next > * {
		background: color-mix(in srgb, var(--accent) 7%, var(--surface));
	}

	.next .wk {
		box-shadow: inset 3px 0 0 var(--accent);
	}

	.next .opp {
		font-weight: 600;
	}

	.next .proj {
		color: var(--accent-text);
		font-size: var(--t-xl);
	}

	.facts {
		text-align: start;
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.exp {
		margin-right: var(--s-2);
		font-family: var(--font-num);
		font-size: var(--t-md);
		font-weight: 600;
		color: var(--ink-2);
		letter-spacing: 0.02em;
	}

	.wx {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}

	/* The season's totals on the scoreboard, at the box's foot. */
	.totals > * {
		height: 56px;
		background: var(--scoreboard);
		color: var(--scoreboard-ink);
		border-bottom: 0;
	}

	.totals .n {
		color: var(--scoreboard-ink);
		font-weight: 700;
	}

	.totals .pts.n {
		color: var(--scoreboard-num);
		font-size: var(--t-2xl);
		font-weight: 800;
	}

	.totals .first {
		border-left-color: var(--scoreboard-line);
	}

	.lead b,
	.lead span {
		display: block;
	}

	.lead b {
		font-family: var(--font-num);
		font-size: var(--t-lg);
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.lead span {
		font-size: var(--t-xs);
		font-weight: 500;
		color: var(--scoreboard-ink-2);
	}

	/* The earlier seasons: a quiet toggle under the totals, each season a row in the same columns. */
	.toggle > * {
		height: 40px;
		background: var(--bg);
	}

	.toggle button {
		display: inline-flex;
		align-items: center;
		gap: var(--s-2);
		padding: 0;
		border: 0;
		background: none;
		color: var(--ink-2);
		font: inherit;
		font-size: var(--t-xs);
		font-weight: 700;
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		cursor: pointer;
	}

	.chev {
		width: 7px;
		height: 7px;
		border-right: 2px solid currentColor;
		border-bottom: 2px solid currentColor;
		transform: rotate(-45deg);
	}

	.chev.open {
		transform: rotate(45deg);
	}

	.prior .lead b {
		font-size: var(--t-md);
		letter-spacing: 0.02em;
	}

	.prior .lead span {
		color: var(--ink-3);
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
			--wk-w: 36px;
			--opp-w: 92px;
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
