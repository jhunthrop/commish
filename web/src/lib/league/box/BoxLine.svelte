<script lang="ts">
	import { links } from '#lib/site/links.ts';
	import ClubMark from '#lib/ui/ClubMark.svelte';
	import Face from '#lib/ui/Face.svelte';
	import NameWords from '#lib/ui/NameWords.svelte';
	import StatusPill from '../StatusPill.svelte';
	import { BOX, boxNumber, type BoxRow } from './box.ts';
	import WeatherGlyph from './WeatherGlyph.svelte';

	/** One player's row of a box score: the slot, his face (a defense's club mark), his name on a line
	 * of its own, under it his club and Lane 63's status pill (his position and rank, and his status
	 * when the report lists him), his game in one cell, this week's projection and his points so far.
	 * On a phone the game cell folds under the pill, so a long name wraps rather than cuts. */
	interface Props {
		row: BoxRow;
		/** A bench row: shorter and quieter. */
		bench?: boolean;
		/** The row a lineup change sits, or starts: marked on the change's wash. */
		tone?: 'start' | 'sit' | null;
	}

	let { row, bench = false, tone = null }: Props = $props();
</script>

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

<tr class:bench class:start={tone === 'start'} class:sit={tone === 'sit'}>
	<td class="slot">{row.slot}</td>
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
						<a href={links.playerSeason(row.slug)}><NameWords name={row.name} /></a>
					{:else}
						<b><NameWords name={row.name} /></b>
					{/if}
				</span>
				<span class="club"
					><span>{row.club}</span>{#if row.pill}<StatusPill
							position={row.pill.position}
							positionRank={row.pill.rank ?? undefined}
							status={row.status}
						/>{/if}</span
				>
				<span class="phone-game">{@render game()}</span>
			</span>
		</span>
	</td>
	<td class="game">{@render game()}</td>
	<td class="n proj">{boxNumber(row.proj)}</td>
	<td class="n pts" class:none={row.pts === null}>{boxNumber(row.pts)}</td>
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

	.start td,
	.sit td {
		background: var(--accent-wash);
	}

	.start td:first-child,
	.sit td:first-child {
		box-shadow: inset 4px 0 0 var(--accent);
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

	.phone-game {
		display: none;
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

		.phone-game {
			display: flex;
			flex-direction: column;
			gap: 1px;
			font-size: var(--t-xs);
			color: var(--ink-2);
		}

		.phone-game .exp {
			font-size: var(--t-xs);
		}

		.proj,
		.pts {
			font-size: var(--t-md);
		}
	}
</style>
