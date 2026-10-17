<script lang="ts">
	import { links } from '#lib/site/links.ts';
	import ClubMark from '#lib/ui/ClubMark.svelte';
	import Face from '#lib/ui/Face.svelte';
	import NameWords from '#lib/ui/NameWords.svelte';
	import StatusPill from '../StatusPill.svelte';
	import { HELD } from '../inseason/words.ts';
	import { tagMarks } from '#lib/sheet/tags.ts';
	import TagChip from '#lib/ui/TagChip.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import {
		BOX,
		boxNumber,
		deltaWord,
		easeOf,
		initialName,
		oppRankWord,
		type BoxPick,
		type BoxRow
	} from './box.ts';
	import type { Move } from './lineup.ts';
	import MoveMark from './MoveMark.svelte';
	import WeatherGlyph from './WeatherGlyph.svelte';

	/** One player's row of a box score: the slot, his face (a defense's club mark), his name on a line
	 * of its own, under it his club and Lane 63's status pill (his position and rank, and his status
	 * when the report lists him), his game in one cell, this week's projection and his points so far.
	 * On a phone the game cell folds under the pill, so a long name wraps rather than cuts. */
	interface Props {
		row: BoxRow;
		/** A bench row: shorter and quieter. */
		bench?: boolean;
		/** Your sheet's tags on him, as the league's rows mark them (review L7). */
		tags?: readonly string[];
		/** The Lineup's columns after Pts (Lane 66e): Opp rank, Avg, Last, the projection's change and
		 * the cell that opens a swap's evidence line. */
		evidence?: boolean;
		/** A row the advice moves, marked in its slot cell. */
		move?: Move | null;
		/** A spot no one who can play this week fills: the member's player, left there, muted. */
		idle?: boolean;
		/** A swap's evidence line, opened by its button: its row's id, whether it is open. */
		why?: { id: string; open: boolean; toggle: () => void } | null;
		/** The Trades screen's last column (Lane 66g): his rest-of-season points a game, in place of
		 * the projection's change and the evidence line's button. */
		season?: boolean;
		/** The trade builder's columns (Lane 66g): his game folds under his name at every width, and
		 * the slot and Pts are left out (a roster, not a lineup), so two boxes sit side by side. */
		compact?: boolean;
		/** The trade builder's tick (Lane 66g), first in the row. */
		pick?: BoxPick | null;
		/** A narrow phone cell prints his short form, "A. Rodgers", never a cut surname (rereview N2). */
		shortOnPhone?: boolean;
	}

	let {
		row,
		bench = false,
		tags = [],
		evidence = false,
		move = null,
		why = null,
		idle = false,
		season = false,
		compact = false,
		pick = null,
		shortOnPhone = false
	}: Props = $props();
	const picked = $derived(pick?.state === 'on');
	const rank = $derived(row.evidence.oppRank);
	/** The phone's evidence line's own words and separator, so the template adds no space. */
	const oppLead = `${BOX.opp} `;
	const SEPARATOR = ', ';
	/** "Avg 15.2, Last 0.8": the phone's evidence after the opponent's rank. */
	const seasonWords = $derived(
		`${BOX.avg} ${boxNumber(row.evidence.avg)}, ${BOX.last} ${boxNumber(row.evidence.last)}`
	);
</script>

{#snippet named()}
	{#if shortOnPhone}<span class="full"><NameWords name={row.name} /></span><span class="short"
			>{initialName(row.name)}</span
		>{:else}<NameWords name={row.name} />{/if}
{/snippet}

{#snippet game()}
	{#if row.game === 'bye'}
		<span class="bye">{BOX.bye}</span>
	{:else if row.game}
		<span class="opp"><b>{row.game.where}</b> <span>{row.game.when}</span></span>
	{/if}
	{#if row.expected !== null || row.weather !== null}
		<span class="facts">
			{#if row.expected}<span class="exp">{row.expected}</span>{/if}
			{#if row.weather}<span class="wx"
					><WeatherGlyph glyph={row.weather.glyph} />{row.weather.words}</span
				>{/if}
		</span>
	{/if}
{/snippet}

{#snippet seasonLine()}
	<!-- The separators are expressions, so the template's own line breaks add no space (review L7). -->
	<span class="phone-ev"
		>{#if rank !== null}{oppLead}<span class="rk {easeOf(rank, row.evidence.oppOf)}"
				>{oppRankWord(rank)}</span
			>{SEPARATOR}{/if}{seasonWords}</span
	>
{/snippet}

<tr
	class:bench
	class:moved-in={move === 'in'}
	class:moved-out={move === 'out'}
	class:open={why?.open === true}
	class:idle
	class:compact
	class:picked
	class:dropped={pick?.state === 'drop'}
>
	{#if pick}
		<td class="tk">
			{#if pick.state === 'drop'}
				<span class="drop-mark">{BOX.drop}</span>
			{:else if pick.state === 'no'}
				<span class="tick no" aria-hidden="true"></span>
			{:else}
				<button
					type="button"
					class="tick"
					class:on={picked}
					aria-pressed={picked}
					aria-label="{BOX.pick} {row.name}"
					disabled={pick.disabled}
					onclick={pick.toggle ?? undefined}
					>{#if picked}<Icon name="check" size={14} />{/if}</button
				>
			{/if}
		</td>
	{/if}
	{#if !compact}
		<td class="slot"
			><span class="sl"
				>{#if move}<MoveMark {move} />{/if}{row.slot}</span
			></td
		>
	{/if}
	<td class="player">
		<span class="pl">
			{#if row.face.mark && row.face.src !== null}
				<ClubMark src={row.face.src} alt={row.face.alt} size={32} />
			{:else}
				<Face src={row.face.src} name={row.name} size={32} />
			{/if}
			<span class="who">
				<span class="nm">
					{#if row.slug !== null}
						<a href={links.playerSeason(row.slug)}>{@render named()}</a>
					{:else}
						<b>{@render named()}</b>
					{/if}
				</span>
				<span class="club"
					><span>{row.club}</span>{#if row.pill}<StatusPill
							position={row.pill.position}
							positionRank={row.pill.rank ?? undefined}
							status={row.status}
						/>{/if}</span
				>
				{#if tags.length > 0 || row.held}
					<!-- Held is the sheet's Hold tag, said by the API: drawn when the sheet's own tags are not in. -->
					<span class="tags"
						>{#if row.held && tags.length === 0}<TagChip
								label={HELD}
							/>{/if}{#each tagMarks(tags) as mark (mark.label)}<TagChip
								label={mark.label}
								tone={mark.tone}
							/>{/each}</span
					>
				{/if}
				<span class="phone-game">{@render game()}</span>
				{#if evidence}{@render seasonLine()}{/if}
			</span>
		</span>
	</td>
	{#if !compact}<td class="game">{@render game()}</td>{/if}
	<td class="n proj">{boxNumber(row.proj)}</td>
	{#if !compact}<td class="n pts" class:none={row.pts === null}>{boxNumber(row.pts)}</td>{/if}
	{#if evidence}
		<td class="n ev first"
			>{#if rank !== null}<span class="rk {easeOf(rank, row.evidence.oppOf)}"
					>{oppRankWord(rank)}</span
				>{:else}<span class="none">{BOX.none}</span>{/if}</td
		>
		<td class="n ev">{boxNumber(row.evidence.avg)}</td>
		<td class="n ev">{boxNumber(row.evidence.last)}</td>
	{/if}
	{#if season}
		<td class="n season">{boxNumber(row.evidence.season)}</td>
	{:else if evidence}
		<td class="n ev delta">{deltaWord(row.evidence.delta)}</td>
		<td class="op"
			>{#if why}<button
					type="button"
					class="why"
					aria-expanded={why.open}
					aria-controls={why.id}
					aria-label="{BOX.why} {row.name}"
					onclick={why.toggle}><Icon name="chevron" size={16} /></button
				>{/if}</td
		>
	{/if}
</tr>

<style>
	td {
		padding: 6px var(--s-2);
		border-bottom: 1px solid var(--line);
		vertical-align: middle;
	}

	tr {
		height: var(--row-h);
	}

	tr:hover td {
		background: var(--surface-2);
	}

	.moved-in td {
		background: color-mix(in srgb, var(--accent) 8%, var(--surface));
	}

	.moved-in td:first-child {
		box-shadow: inset 3px 0 0 var(--accent);
	}

	.moved-out td {
		background: color-mix(in srgb, var(--ink) 4%, var(--surface));
	}

	.moved-out td:first-child {
		box-shadow: inset 3px 0 0 var(--line-strong);
	}

	.idle td {
		color: var(--ink-3);
		background: color-mix(in srgb, var(--loss-bg) 35%, var(--surface));
	}

	.open td {
		border-bottom-color: transparent;
	}

	.sl {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.ev {
		font-size: var(--t-md);
		font-weight: 600;
		color: var(--ink-2);
	}

	.ev.first {
		border-left: 1px solid var(--line);
		padding-left: var(--s-3);
	}

	.delta {
		color: var(--ink-3);
		font-size: var(--t-sm);
	}

	.rk {
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		min-width: 40px;
		height: 22px;
		padding: 0 6px;
		border-radius: var(--r-sm);
	}

	.rk.easy {
		background: var(--gain-bg);
		color: var(--gain-ink);
	}

	.rk.hard {
		background: var(--loss-bg);
		color: var(--loss-ink);
	}

	.op {
		width: 40px;
		padding: 0 var(--s-1);
		text-align: center;
	}

	.why {
		display: inline-grid;
		place-items: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: transparent;
		color: var(--ink-2);
		cursor: pointer;
	}

	.why[aria-expanded='true'] {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--bg);
	}

	.why[aria-expanded='true'] :global(svg) {
		transform: rotate(180deg);
	}

	.phone-ev {
		display: none;
	}

	.slot {
		font-family: var(--font-num);
		font-size: var(--t-md);
		font-weight: 700;
		letter-spacing: 0.03em;
		color: var(--ink-2);
		white-space: nowrap;
	}

	.pl {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		min-width: 0;
	}

	.who {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}

	.nm {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		column-gap: 6px;
		row-gap: 2px;
	}

	.nm a,
	.nm b {
		font-weight: 600;
		color: var(--ink);
		text-decoration: none;
	}

	.nm a:hover {
		text-decoration: underline;
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.club {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		font-size: var(--t-xs);
		font-weight: 500;
		letter-spacing: 0.03em;
		color: var(--ink-3);
	}

	.game {
		font-size: var(--t-sm);
	}

	.opp {
		display: flex;
		gap: 4px;
		white-space: nowrap;
	}

	.opp b {
		font-weight: 600;
	}

	.opp span {
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}

	.facts {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		font-size: var(--t-xs);
		color: var(--ink-3);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.exp {
		font-family: var(--font-num);
		font-size: var(--t-sm);
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--ink-2);
	}

	.wx {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}

	.bye {
		display: inline-flex;
		align-items: center;
		height: 20px;
		padding: 0 var(--s-2);
		border-radius: var(--r-sm);
		background: var(--surface-2);
		color: var(--ink-2);
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
	}

	.n {
		text-align: right;
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.proj {
		font-size: var(--t-lg);
		font-weight: 700;
	}

	.pts {
		font-size: var(--t-lg);
		font-weight: 700;
	}

	.none {
		color: var(--ink-3);
		font-weight: 600;
	}

	.bench {
		height: 46px;
	}

	.bench .proj {
		font-size: var(--t-md);
		color: var(--ink-2);
	}

	.bench .pts {
		font-size: var(--t-md);
	}

	.short {
		display: none;
	}

	.phone-game {
		display: none;
	}

	/* The trade builder's rows (Lane 66g): the game under the name at every width, a tick first. */
	.compact .phone-game {
		display: flex;
		flex-direction: column;
		gap: 1px;
		font-size: var(--t-xs);
		color: var(--ink-2);
	}

	.compact .phone-game .facts {
		display: none;
	}

	.season {
		font-size: var(--t-lg);
		font-weight: 700;
	}

	.tk {
		width: 36px;
		padding: 0;
		text-align: center;
	}

	.tick {
		display: inline-grid;
		place-items: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border: 1.5px solid var(--ink-3);
		border-radius: 5px;
		background: transparent;
		color: var(--accent-ink);
		cursor: pointer;
		vertical-align: middle;
	}

	.tick.on {
		background: var(--accent);
		border-color: var(--accent);
	}

	.tick:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}

	.tick.no {
		border-style: dashed;
		border-color: var(--line-strong);
		cursor: default;
	}

	.tick:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}

	.drop-mark {
		display: inline-flex;
		align-items: center;
		height: 20px;
		padding: 0 5px;
		border-radius: var(--r-sm);
		background: var(--loss-bg);
		color: var(--loss-ink);
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.picked td {
		background: color-mix(in srgb, var(--accent) 10%, var(--surface));
	}

	.picked td:first-child {
		box-shadow: inset 3px 0 0 var(--accent);
	}

	.dropped td {
		background: color-mix(in srgb, var(--loss-ink) 7%, var(--surface));
	}

	.dropped td:first-child {
		box-shadow: inset 3px 0 0 var(--loss-ink);
	}

	@media (max-width: 760px) {
		td {
			padding: 7px 6px;
		}

		tr {
			height: auto;
		}

		.game {
			width: 0;
			max-width: 0;
			padding: 0;
			overflow: hidden;
		}

		.game > * {
			display: none;
		}

		/* A name's short form on a phone, where the row asks for it. */
		.full {
			display: none;
		}

		.short {
			display: inline;
			white-space: nowrap;
		}

		.phone-game {
			display: flex;
			flex-direction: column;
			gap: 1px;
			font-size: var(--t-xs);
			color: var(--ink-2);
		}

		.phone-game .facts {
			flex-wrap: wrap;
			white-space: normal;
			column-gap: var(--s-1);
		}

		.phone-game .exp {
			font-size: var(--t-xs);
		}

		.proj,
		.pts {
			font-size: var(--t-md);
		}

		.op {
			width: 34px;
			padding: 0 2px;
		}

		.why {
			width: 28px;
			height: 28px;
		}
	}

	/* Below a wide screen the evidence folds under the name, one short line, as on a phone: its
	   columns keep their places at no width. */
	@media (max-width: 900px) {
		.ev,
		.ev.first {
			width: 0;
			max-width: 0;
			padding: 0;
			overflow: hidden;
			font-size: 0;
			border-left: 0;
		}

		.ev > * {
			display: none;
		}

		.phone-ev {
			display: block;
			font-size: var(--t-xs);
			color: var(--ink-3);
			font-variant-numeric: tabular-nums;
		}

		.phone-ev .rk {
			height: auto;
			min-width: 0;
			padding: 0 3px;
			font-weight: 700;
		}
	}
</style>
