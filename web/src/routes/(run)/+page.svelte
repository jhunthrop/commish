<script lang="ts">
	import { onMount } from 'svelte';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import RowSheetMark from '#lib/site/RowSheetMark.svelte';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import { lazySheet } from '#lib/site/lazy-sheet.svelte.ts';
	import { links } from '#lib/site/links.ts';
	import { PAGE_VERBS, frontWords, type FrontWords } from '#lib/site/season-words.ts';
	import { verbHref } from '#lib/site/verb-links.ts';
	import { shownRail } from '#lib/site/shown-rail.svelte.ts';
	import Figure from '#lib/ui/Figure.svelte';
	import PairTile from '#lib/ui/PairTile.svelte';
	import HeroCard from '#lib/ui/HeroCard.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import Phased from '#lib/ui/Phased.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import { liveStatusClock, sayBoard, type LiveStatus } from '#lib/run/live-status.ts';
	import BasisLine from '#lib/ui/BasisLine.svelte';
	import BoardTable from '#lib/ui/BoardTable.svelte';
	import Row from '#lib/ui/Row.svelte';
	import { boardColumns } from '#lib/ui/board-columns.ts';
	import Verb from '#lib/ui/Verb.svelte';
	import { RECORD_WORDS } from '#lib/run/record.ts';
	import { memberZone } from '#lib/format/clock.ts';
	import {
		BUILD_ZONE,
		STRIP_ROWS,
		answerReadAt,
		liveBasis,
		liveLeadPart,
		liveStrip,
		overReplacementPart,
		runStampPart,
		shapeWords,
		stripBasisParts,
		stripHead,
		type StripRow
	} from '#lib/front/live-board.ts';
	import type { BasisPart } from '#lib/run/board-basis.ts';
	import { RAIL_OF_WORD_SET, railInSeason, type WordSet } from '#lib/ui/nav.ts';
	import type { Component } from 'svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Faces in the first screen load eagerly so they count toward the first paint. */
	const EAGER_ROWS = 6;

	const page = $derived(data.page);
	const format = $derived(page.format);
	const headline = $derived(page.record);
	const columns = $derived(
		boardColumns({
			order: 'board',
			tier: true,
			bye: true,
			range: false,
			gap: page.gap,
			season: page.underway,
			restOfSeason: page.restFrom !== null,
			action: true
		})
	);

	onMount(() => lazySheet.armOnFirstIntent(window));
	/** The rows' status words as built, said again on the member's clock once the page is live, as
	 * the board says them (review finding 7). */
	let live = $state<LiveStatus | null>(null);
	onMount(() => {
		liveStatusClock(
			page.capture !== null,
			() => import('#lib/run/status-view.ts'),
			(said) => {
				live = said;
			}
		);
	});
	const words = $derived(sayBoard({ ...page, rows: page.pool }, live));

	/** One board for a signed-in member (Lane 96): the strip prints the API's live order, the one
	 * Players and Rest of 2026 read at the same clock, for the followed league's shape or for 12 teams.
	 * A reader signed out, or whose read fails, keeps the run's figures with the run's time. */
	let zone = $state(BUILD_ZONE);
	onMount(() => {
		zone = memberZone();
	});
	const runStamp = $derived(
		format.refreshedAt === undefined ? null : runStampPart(format.refreshedAt, zone)
	);
	let liveRead = $state<{
		rows: StripRow[];
		basis: BasisPart[];
		head: string;
	} | null>(null);
	$effect(() => {
		const league = siteContext.league;
		if (!siteContext.signedIn || format.rosFromWeek === undefined) {
			liveRead = null;
			return;
		}
		const teams = league?.standing?.teams ?? format.teams;
		let stale = false;
		void import('#lib/order/api.ts')
			.then(({ orderApi }) =>
				orderApi.read(league?.id ?? null, {
					position: null,
					q: null,
					roster: null,
					limit: STRIP_ROWS
				})
			)
			.then((answer) => {
				if (stale) return;
				const rows = liveStrip(page.pool, answer, teams);
				const readAt = answerReadAt(answer, Date.now());
				const lead = liveLeadPart(answer, shapeWords(teams, league !== null), readAt, zone);
				liveRead =
					rows === null
						? null
						: {
								rows,
								basis: [
									...liveBasis(page.basis, lead),
									overReplacementPart(teams),
									...stripBasisParts(rows, format.label, answer.projection_scoring)
								],
								head: stripHead(format.label, answer.projection_scoring)
							};
			})
			.catch(() => {
				if (!stale) liveRead = null;
			});
		return () => {
			stale = true;
		};
	});
	const stripRows = $derived<StripRow[]>(liveRead?.rows ?? page.rows);
	const stripTitle = $derived(liveRead?.head ?? stripHead(format.label, null));
	const stripBasis = $derived(
		liveRead?.basis ?? [
			...page.basis,
			...(runStamp === null ? [] : [runStamp]),
			overReplacementPart(format.teams)
		]
	);

	/** A member who follows a league is sent back to the one selected in the shell; anyone
	 * else to follow one. */
	const leagueId = $derived(siteContext.league?.id ?? null);
	/** The words follow the season the rail shows: in season the followed league is the verb. Both
	 * sets are in the HTML and the root's rail shows one (Phased.svelte), so the hero is right on the
	 * first frame; the document's title follows the rail once the script runs. */
	/** What the board covers, its week in the run's words (built on the server). */
	const cover = $derived({
		...format,
		season: data.run.season,
		...(page.restFrom === null ? {} : { restFrom: page.restFrom })
	});
	const wordsOf = (set: WordSet): FrontWords =>
		frontWords(RAIL_OF_WORD_SET[set], cover, leagueId !== null);
	const rail = shownRail(() => data.siteRail);
	const documentTitle = $derived(frontWords(rail(), cover, leagueId !== null).title);

	/** In season with a followed league, the week leads the page in place of the board's hero (Lane
	 * 66k). Its band is loaded once it is wanted, so a visitor's front door carries none of it. */
	const weekShown = $derived(railInSeason(rail()) && leagueId !== null);
	let FrontWeek = $state<Component<{ chosen: string | null }> | null>(null);
	$effect(() => {
		if (weekShown && FrontWeek === null) {
			void import('#lib/front/FrontWeek.svelte').then((m) => (FrontWeek = m.default));
		}
	});
</script>

<svelte:head>
	<meta
		name="description"
		content="Our {data.run
			.season} {format.label} board from our own projections, every player's page, your league's lineup, waivers and trades, mock drafts and a cheat sheet."
	/>
</svelte:head>

{#snippet barTitle()}
	<Phased>{#snippet children(set: WordSet)}{wordsOf(set).title}{/snippet}</Phased>
{/snippet}

{#snippet heading()}
	<Phased>{#snippet children(set: WordSet)}{wordsOf(set).heading}{/snippet}</Phased>
{/snippet}

<SiteShell title={documentTitle} heading={barTitle} run={data.run}>
	<main class="front">
		{#if weekShown}
			{#if FrontWeek}<FrontWeek chosen={leagueId} />{:else}<div class="reserve"></div>{/if}
		{:else}
			<HeroCard title={heading}>
				{#snippet meta()}
					<span>{page.meta.join(' · ')}</span>
				{/snippet}
				{#snippet aside()}
					<Phased>
						{#snippet children(set: WordSet)}
							{@const words = wordsOf(set)}
							<Verb href={verbHref(words.verb, leagueId)} size="lg" fill
								>{PAGE_VERBS[words.verb]}</Verb
							>
							{#each words.quiet as verb (verb)}
								<Quiet href={verbHref(verb, leagueId)} size="lg" fill>{PAGE_VERBS[verb]}</Quiet>
							{/each}
						{/snippet}
					</Phased>
				{/snippet}
			</HeroCard>
		{/if}

		<div class="body">
			<section class="top" aria-label="The top of the board">
				<PanelHead title={stripTitle} aside="{page.rows.length} of {page.boardSize}" level={2} />
				<BasisLine parts={stripBasis} tail={words?.capture ?? null} />
				<div class="rows">
					<BoardTable {columns} label={stripTitle}>
						{#each stripRows as player, i (player.id)}
							<Row
								{player}
								href={links.player(player.slug)}
								{columns}
								scale={page.scale}
								bye={page.byes[player.team] ?? null}
								byesFrom={format.rosFromWeek ?? null}
								eager={i < EAGER_ROWS}
								season={player.season}
								framing={page.framing}
								status={words?.rows[player.id] ?? null}
								untiered={player.untiered === true}
							>
								{#snippet action()}<RowSheetMark {player} />{/snippet}
							</Row>
						{/each}
					</BoardTable>
				</div>
				<div class="more">
					<Quiet href={links.board(format.id)}>All {page.boardCount}</Quiet>
					<Quiet href={links.adp(format.id)}>ADP</Quiet>
				</div>
			</section>

			<aside class="side" aria-label="Our record">
				<Panel>
					<PanelHead title="Our record" aside={page.record.season.toString()} />
					{#if page.front}
						<p class="standing">{page.front.name}</p>
						{#if page.front.value !== null}
							<div class="figures">
								<Figure value={page.front.value} size="lg" caption={page.front.caption} />
							</div>
						{:else}
							<!-- Ours and ADP at one size, each pair's leader named (C05). -->
							<p class="record-note">{page.front.caption}</p>
							<div class="figures pairs">
								{#each page.front.pairs as pair (pair.label)}
									<PairTile label={pair.label} {pair} size="md" />
								{/each}
							</div>
						{/if}
						{#if page.front.second}<p class="record-note">{page.front.second}</p>{/if}
						<p class="record-note">{page.front.scale}</p>
						{#if page.front.note}<p class="record-note">{page.front.note}</p>{/if}
					{:else}
						{#if headline.standing}<p class="standing">{headline.standing}</p>{/if}
						<div class="figures">
							<Figure value={headline.value} size="lg" caption={headline.caption} />
							{#if headline.starters}
								<Figure
									value={headline.starters.value}
									size="lg"
									caption={RECORD_WORDS.frontStarters(headline.starters.caption)}
								/>
							{/if}
						</div>
						{#if headline.graded}<p class="record-note">{page.record.scale}</p>{/if}
						{#if headline.gaps}<p class="record-note">{headline.gaps}</p>{/if}
					{/if}
					<div class="more">
						{#if page.weekRankings}
							<Quiet href={page.weekRankings.href} size="sm">{page.weekRankings.label}</Quiet>
						{/if}
						<Quiet href={links.record()} size="sm">How the board has done</Quiet>
					</div>
				</Panel>
			</aside>
		</div>
	</main>
</SiteShell>

<style>
	.front {
		display: flex;
		flex-direction: column;
		gap: var(--s-5);
		padding: var(--s-5);
	}

	.reserve {
		min-height: 300px;
	}

	.body {
		display: grid;
		grid-template-columns: minmax(0, 1fr) var(--side-w);
		gap: var(--s-5);
		align-items: start;
	}

	.top {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
	}

	.more {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-3);
		margin-top: var(--s-3);
	}

	/* The record card: order matched and starters right side by side, then its two notes (Lane 93). */
	.figures {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--s-3);
	}

	.pairs {
		margin-top: var(--s-2);
	}

	.standing {
		margin: 0 0 var(--s-2);
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--accent-text);
	}

	.record-note {
		margin: var(--s-2) 0 0;
		font-size: var(--t-xs);
		line-height: 1.45;
		color: var(--ink-2);
	}

	@media (max-width: 1180px) {
		.body {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (max-width: 760px) {
		.front {
			padding: var(--s-4);
			gap: var(--s-4);
		}
	}
</style>
