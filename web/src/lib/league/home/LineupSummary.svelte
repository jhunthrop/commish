<script lang="ts">
	import Verb from '#lib/ui/Verb.svelte';
	import PinnedVerb from '../box/PinnedVerb.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import BoxTable from '../box/BoxTable.svelte';
	import MoveMark from '../box/MoveMark.svelte';
	import { changesTitle, stripSum } from '../box/lineup.ts';
	import { HOME, type LineupSummary } from './home.ts';
	import { page } from '$app/state';
	import type { LeagueHost } from '../api.ts';
	import { askedHref } from '../box/asked.ts';
	import { lineupOffer, rowBySlug } from '#lib/player/shelf-state.ts';
	import { providePlayerShelf } from '#lib/player/shelf-host.ts';
	import PlayerShelfLayer from '#lib/player/PlayerShelfLayer.svelte';

	/** The drafter's lineup on the League page (Lane 66i): the starters as set on the platform in the
	 * Lineup's columns (slot, player, game, Proj, Pts) with their totals, and above them the advice in
	 * one line, its swaps as chips and the one verb, "Set your lineup", that opens the Lineup. A
	 * lineup the advice leaves alone has no verb, a quiet way to the Lineup. Under the table the bench
	 * is a count that opens the Lineup's bench. On a phone the verb is pinned above the tab bar. */
	interface Props {
		team: string;
		platform: string;
		summary: LineupSummary;
		lineupHref: string;
		benchHref: string;
		tagsOf: (boardId: string | null) => readonly string[];
		/** "Last read 3:05 pm" when the latest lineup read failed and this is the last good one. */
		stamp?: string | null;
		/** The league's platform, which the player shelf reads his week in. */
		host: LeagueHost;
	}

	let {
		team,
		platform,
		summary,
		lineupHref,
		benchHref,
		tagsOf,
		stamp = null,
		host
	}: Props = $props();

	/** A starter's name opens his card over the page (Lane 113); its verb is his row on the Lineup. */
	const shelf = providePlayerShelf({
		screen: 'league',
		league: () => ({ id: page.params.id ?? '', host }),
		offer: ({ boardId, position }) =>
			boardId === null
				? null
				: lineupOffer({ href: askedHref(lineupHref, 'start', { id: boardId, position }) }),
		rowOf: (slug) =>
			rowBySlug(
				summary.starters.map((s) => s.row),
				slug
			)
	});

	const sum = $derived(stripSum(summary.box, summary.done));
	const changes = $derived(summary.box.swaps.length);
</script>

<section class="roster" aria-label={HOME.yourLineup}>
	<div class="head">
		<h2>{HOME.yourLineup}</h2>
		<span>As set on {platform}</span>
		{#if stamp}<span class="stamp" role="status">{stamp}</span>{/if}
	</div>
	<div class="decide" class:set={changes === 0}>
		<div class="what">
			<b>{changesTitle(changes, summary.done, summary.doneState)}</b>
			{#if summary.done !== null}<span>{summary.done}</span>{:else if sum}<span
					>{sum.figure}
					{sum.words}{#if sum.gain}, <em>{sum.gain}</em>{/if}</span
				>{/if}
		</div>
		{#if changes > 0}
			<ul class="swaps">
				{#each summary.box.swaps as swap (swap.key)}
					<li>
						<span class="slot">{swap.slot}</span>
						<span class="in"><MoveMark move="in" size={14} />{swap.in}</span>
						{#if swap.out}<span class="out"><MoveMark move="out" size={14} />{swap.out}</span>{/if}
					</li>
				{/each}
			</ul>
			<div class="verb">
				<PinnedVerb><Verb href={lineupHref}>{HOME.setYourLineup}</Verb></PinnedVerb>
			</div>
		{:else}
			<Quiet href={lineupHref} size="sm">{HOME.openLineup}</Quiet>
		{/if}
	</div>
	<BoxTable {team} mine starters={summary.starters} bench={[]} totals={summary.totals} {tagsOf} />
	<a class="bench" href={benchHref}>{summary.benchWords}</a>
	<PlayerShelfLayer host={shelf} />
</section>

<style>
	.roster {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		min-width: 0;
	}

	.head {
		display: flex;
		align-items: baseline;
		gap: var(--s-3);
	}

	h2 {
		margin: 0;
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-xl);
		line-height: 1;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}

	.head span {
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.head .stamp {
		margin-left: auto;
	}

	.decide {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-2) var(--s-3);
		padding: var(--s-2) var(--s-2) var(--s-2) var(--s-3);
		border: 1px solid var(--line);
		border-left: 4px solid var(--accent);
		border-radius: var(--r-md);
		background: var(--surface);
	}

	.decide.set {
		border-left-color: var(--gain-ink);
		justify-content: space-between;
	}

	.what {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}

	.what b {
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-lg);
		text-transform: uppercase;
		letter-spacing: 0.02em;
		line-height: 1.1;
	}

	.what span {
		font-size: var(--t-xs);
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}

	.what em {
		font-style: normal;
		font-weight: 700;
		color: var(--gain-ink);
	}

	.swaps {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
		flex: 1;
		min-width: 0;
	}

	.swaps li {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		padding: 0 var(--s-2) 0 3px;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-pill);
		background: var(--bg);
		font-size: var(--t-xs);
		white-space: nowrap;
	}

	.slot {
		display: grid;
		place-items: center;
		height: 22px;
		min-width: 30px;
		padding: 0 5px;
		border-radius: var(--r-pill);
		background: var(--surface-2);
		font-family: var(--font-num);
		font-weight: 700;
	}

	.in,
	.out {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}

	.in {
		font-weight: 700;
	}

	.out {
		color: var(--ink-3);
	}

	.verb {
		margin-left: auto;
	}

	.bench {
		align-self: flex-start;
		font-size: var(--t-sm);
		color: var(--ink-3);
		font-weight: 500;
	}

	.bench:hover {
		color: var(--ink);
	}

	/* On a phone the verb stays on the first screen, pinned above the tab bar, and the swaps take
	   a line of their own. */
	@media (max-width: 760px) {
		.swaps {
			flex-basis: 100%;
		}

		.verb {
			margin: 0;
		}
	}
</style>
