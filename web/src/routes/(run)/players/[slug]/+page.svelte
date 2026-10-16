<script lang="ts">
	import { onMount } from 'svelte';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import ContextNote from '#lib/context/ContextNote.svelte';
	import { contextLine } from '#lib/context/context-format.ts';
	import { apiFormatOf } from '#lib/run/format-ids.ts';
	import { draftersGap } from '#lib/format/draft.ts';
	import { fixed, signed } from '#lib/format/number.ts';
	import { POSITION_NAMES } from '#lib/run/derive.ts';
	import { readFigures } from '#lib/run/read-figures.ts';
	import { UNWRITTEN_READ, unwrittenLines } from '#lib/run/unwritten-words.ts';
	import Credit from '#lib/site/Credit.svelte';
	import SheetAdd from '#lib/site/SheetAdd.svelte';
	import { lazySheet } from '#lib/site/lazy-sheet.svelte.ts';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import { SEASON_ANCHOR, links } from '#lib/site/links.ts';
	import Capsule from '#lib/ui/Capsule.svelte';
	import Crumb from '#lib/ui/Crumb.svelte';
	import Face from '#lib/ui/Face.svelte';
	import Fact from '#lib/ui/Fact.svelte';
	import Figure from '#lib/ui/Figure.svelte';
	import Footnote from '#lib/ui/Footnote.svelte';
	import GameLog from '#lib/ui/GameLog.svelte';
	import GapChip from '#lib/ui/GapChip.svelte';
	import HeroCard from '#lib/ui/HeroCard.svelte';
	import LineList from '#lib/ui/LineList.svelte';
	import Label from '#lib/ui/Label.svelte';
	import OutcomeBar from '#lib/ui/OutcomeBar.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import PositionPill from '#lib/ui/PositionPill.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Table from '#lib/ui/Table.svelte';
	import TierChip from '#lib/ui/TierChip.svelte';
	import TierMates from '#lib/ui/TierMates.svelte';
	import { heatFor } from '#lib/ui/heat.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** His club's game this week with its facts, read from the API after the first paint. */
	let thisWeek = $state<string | null>(null);

	onMount(() => {
		lazySheet.armOnFirstIntent(window);
		siteContext.wantHeld();
		void import('#lib/run/week-line.ts')
			.then(({ weekLine }) => weekLine(data.page.team))
			.then((line) => (thisWeek = line));
	});

	const page = $derived(data.page);
	/** His figures lead with the context's format when the run carries it (the league's). */
	const lead = $derived(contextLine(page.lines) ?? page);
	const n = $derived(lead.numbers);
	const season = $derived(data.run.season);
	const unit = $derived(lead.format.unit);
	const scoring = $derived(lead.format.label);
	const gap = $derived(draftersGap(n.adp, n.ourRank));
	const figures = $derived(apiFormatOf(lead.format));
	/** The league's line. */
	const note = $derived(siteContext.notes?.lineFor(figures, 'These figures are') ?? null);
	/** Whose roster he is on in the league, on its own line with its own room, once the rosters are
	 * read: the free-agent read in one glance. */
	const rostered = $derived.by(() => {
		return siteContext.held?.holder(page.id) ?? null;
	});
	/** What the read will be built from, on a page whose written read is not ready. */
	const unwritten = $derived(
		unwrittenLines({
			position: page.position,
			numbers: n,
			boardSize: lead.boardSize,
			label: scoring,
			unit,
			year: season,
			restOfSeason: lead.rest !== null
		})
	);
	/** The figures beside our read, each naming its basis: in season the rest of it leads, in the
	 * context's format. The writer's pulls are matched against the format the capsule was written
	 * for, the page's default line. */
	const readPulls = $derived(
		readFigures(page.capsule?.pulls ?? [], {
			label: scoring,
			preseason:
				page.rest === null ? page.numbers.projected : (page.rest.preseason?.points ?? null),
			rest:
				lead.rest === null || lead.format.rosFromWeek === undefined
					? null
					: { points: n.projected, fromWeek: lead.format.rosFromWeek }
		})
	);
	const mates = $derived(
		page.tier.mates.map((mate) => ({ ...mate, href: links.player(mate.slug) }))
	);
</script>

<!-- His season so far: once the run is past the season's first kickoff it leads the draft facts,
     before it they lead. -->
{#snippet thisSeason()}
	<section class="season" id={SEASON_ANCHOR} aria-label="This season">
		<PanelHead title="This season" aside={page.season.aside} level={2} />
		<Footnote>{page.season.basis}</Footnote>
		<GameLog
			caption="{page.name} week by week, {page.season.season}"
			heads={page.season.heads}
			pointsHead={page.season.pointsHead}
			line={page.season.line}
			rows={page.season.rows}
			ahead={page.season.ahead}
			none={page.season.none}
		/>
	</section>
{/snippet}

<SiteShell title={page.name} run={data.run}>
	{#snippet tail()}<Quiet href={links.compare(page.slug)}>Compare</Quiet>{/snippet}
	<main class="player">
		<Crumb
			trail={[
				{ label: 'Board', href: links.board(lead.format.id) },
				{ label: page.position, href: links.board(lead.format.id, page.position) },
				{ label: page.name }
			]}
		/>

		<HeroCard title={page.name}>
			{#snippet media()}<Face
					src={page.headshot}
					size={168}
					phoneSize={96}
					loading="eager"
				/>{/snippet}
			{#snippet meta()}
				<PositionPill position={page.position} rank={n.positionRank} />
				<TierChip tier={n.tier} long />
				<a href={links.club(page.team)}>{page.team}</a>
				<span class="holder" class:filled={rostered !== null}>{rostered ?? ''}</span>
			{/snippet}
			{#snippet aside()}
				<Figure
					value={fixed(n.projected)}
					size="xl"
					align="end"
					phoneAlign="start"
					caption={lead.words.caption}
				/>
				{#if lead.rest?.preseason}
					<Figure
						value={fixed(lead.rest.preseason.points)}
						size="sm"
						align="end"
						phoneAlign="start"
						caption="projected preseason for all {season}, our rank {lead.rest.preseason.rank}"
					/>
				{/if}
				<SheetAdd
					player={{
						id: page.id,
						name: page.name,
						position: page.position,
						team: page.team,
						headshot: page.headshot
					}}
					fill
				/>
			{/snippet}
		</HeroCard>
		{#if lead.rest}<Footnote>{lead.rest.lead}</Footnote>{/if}
		{#if thisWeek}<p class="this-week">{thisWeek}</p>{/if}
		<div class="league-lines">
			<ContextNote note={note?.text ?? null} link={note?.link ?? null} />
		</div>

		{#if page.underway}{@render thisSeason()}{/if}

		<section class="facts" aria-label="His numbers">
			<Fact label={lead.words.draftersLabel}>
				{#snippet value()}
					<Figure value={lead.words.draftersFigure} />
					{#if !lead.rest}<GapChip {gap} />{/if}
				{/snippet}
				{lead.words.drafters}
			</Fact>
			<Fact label="Over replacement" heat={heatFor(n.vor, n.vorRound)}>
				{#snippet value()}<Figure value={signed(n.vor)} /><span>{unit}</span>{/snippet}
				{lead.words.value}
			</Fact>
			{#if n.floor !== null && n.median !== null && n.ceiling !== null}
				<Fact label="Floor, median, ceiling">
					{#snippet value()}
						<span class="bar"
							><OutcomeBar
								floor={n.floor ?? 0}
								median={n.median ?? 0}
								ceiling={n.ceiling ?? 0}
							/></span
						>
					{/snippet}
					{season}
					{scoring} points, from his low case to his high case
				</Fact>
			{/if}
		</section>

		{#if !page.underway}{@render thisSeason()}{/if}

		<div class="split">
			<article class="read">
				<h3><Label>Our read</Label></h3>
				{#if page.capsule}
					<Capsule body={page.capsule.body} pulls={readPulls} />
				{:else}
					<p class="unwritten">{UNWRITTEN_READ}</p>
					<LineList lines={unwritten} label="What our read of {page.name} will be built from" />
				{/if}
			</article>
			<aside class="tier" aria-label="His tier">
				<TierMates
					tier={page.tier.tier}
					group={POSITION_NAMES[page.position]}
					{mates}
					currentId={page.id}
					cliff={page.tier.cliff}
					unit={page.format.unit}
					basis={page.tierBasis}
				/>
			</aside>
		</div>

		{#if page.lines.length > 1}
			<section aria-label="Every format">
				<Table
					caption="{page.name} in every format"
					showCaption
					columns={[
						{ label: 'Format' },
						{ label: 'Our rank', align: 'end' },
						{ label: page.pointsHead, align: 'end' },
						{ label: 'Over replacement', align: 'end' },
						{ label: 'Tier', align: 'end' }
					]}
				>
					{#each page.lines as line (line.format.id)}
						<tr>
							<td><a href={links.board(line.format.id, page.position)}>{line.tableLabel}</a></td>
							<td class="num">{line.numbers.ourRank}</td>
							<td class="num">{fixed(line.numbers.projected)}</td>
							<td class="num">{signed(line.numbers.vor)}</td>
							<td class="num">{line.numbers.tier}</td>
						</tr>
					{/each}
				</Table>
			</section>
		{/if}

		<Credit />
	</main>
</SiteShell>

<style>
	/* His club's game this week with its facts, the row's facts style: a sentence in the second ink. */
	.this-week {
		margin: 0;
		color: var(--ink-2);
		font-size: var(--t-sm);
		font-variant-numeric: tabular-nums;
	}

	/* The league's line; with no league selected it takes no place. */
	.league-lines {
		display: flex;
		flex-direction: column;
	}

	/* Whose roster he is on, in the hero under his chips: its own line, its room kept from the first
	   paint while a league is selected, so the rosters arriving move nothing. */
	.holder {
		display: none;
		flex-basis: 100%;
		min-height: 1lh;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.holder.filled,
	:global(html[data-league]) .holder {
		display: block;
	}

	:global(html:not([data-league])) .league-lines:not(:has(:global(.filled))) {
		display: contents;
	}

	.player {
		padding: var(--s-5);
		display: flex;
		flex-direction: column;
		gap: var(--s-5);
		max-width: 1320px;
	}

	.facts {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--s-4);
	}

	.season {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
		min-width: 0;
		scroll-margin-top: var(--s-5);
	}

	.bar {
		flex: 1;
		min-width: 0;
	}

	.split {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 360px;
		gap: var(--s-6);
		align-items: start;
	}

	.read {
		min-width: 0;
	}

	.read h3 {
		margin: 0 0 var(--s-3);
	}

	.tier {
		grid-column: 2;
	}

	.unwritten {
		margin: 0 0 var(--s-3);
		color: var(--ink-2);
		font-size: var(--t-md);
	}

	@media (max-width: 1080px) {
		.split {
			grid-template-columns: minmax(0, 1fr);
		}

		.tier {
			grid-column: auto;
		}

		.facts {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (max-width: 760px) {
		.player {
			padding: var(--s-4);
			gap: var(--s-4);
		}
	}
</style>
