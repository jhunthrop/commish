<script lang="ts">
	import { onMount } from 'svelte';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import ContextNote from '#lib/context/ContextNote.svelte';
	import { contextLine } from '#lib/context/context-format.ts';
	import { contextNote, holderWords } from '#lib/context/words.ts';
	import { apiFormatOf } from '#lib/run/format-ids.ts';
	import { draftersGap } from '#lib/format/draft.ts';
	import { fixed, plural, signed } from '#lib/format/number.ts';
	import { POSITION_NAMES } from '#lib/run/derive.ts';
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

	onMount(() => {
		lazySheet.armOnFirstIntent(window);
		siteContext.wantHeld();
	});

	const page = $derived(data.page);
	/** His figures lead with the context's format when the run carries it (the league's). */
	const lead = $derived(contextLine(page.lines) ?? page);
	const n = $derived(lead.numbers);
	const season = $derived(data.run.season);
	const unit = $derived(lead.format.unit);
	const scoring = $derived(lead.format.label);
	const gap = $derived(draftersGap(n.adp, n.ourRank));
	const sources = $derived(lead.adpSources.join(' and '));
	const figures = $derived(apiFormatOf(lead.format));
	/** The league's line. */
	const note = $derived(
		figures === null
			? null
			: contextNote(
					siteContext.league,
					figures,
					siteContext.features.includes('custom_scoring'),
					'These figures are'
				)
	);
	/** Whose roster he is on in the league, on its own line with its own room, once the rosters are
	 * read: the free-agent read in one glance. */
	const rostered = $derived.by(() => {
		if (siteContext.held === null) return null;
		return holderWords(siteContext.held, page.id);
	});
	const drafters = $derived.by(() => {
		if (n.adp === null || gap === null) {
			return `None of our ADP sources has him yet. We have him at pick ${String(n.ourRank)}.`;
		}
		const where =
			gap === 0
				? 'drafters take him right where we would'
				: `drafters take him ${plural(Math.abs(gap), 'pick')} ${gap > 0 ? 'later' : 'earlier'}`;
		return `We have him at pick ${String(n.ourRank)}, so ${where}. ADP ${fixed(n.adp)} from ${sources}.`;
	});
	const valueWords = $derived(
		n.vor < 0
			? `Below replacement, among the ${String(lead.boardSize)} on our board`
			: `Round ${String(n.vorRound)} value among the ${String(lead.boardSize)} on our board`
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
			{/snippet}
			{#snippet aside()}
				<Figure
					value={fixed(n.projected)}
					size="xl"
					align="end"
					phoneAlign="start"
					caption={page.underway
						? `${scoring} points in ${String(season)}, projected preseason over ${fixed(n.expectedGames)} games`
						: `projected ${scoring} points in ${String(season)}, over ${fixed(n.expectedGames)} expected games`}
				/>
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
		<div class="league-lines">
			<ContextNote {note} />
			<ContextNote note={rostered === null ? null : `${rostered}.`} short />
		</div>

		{#if page.underway}{@render thisSeason()}{/if}

		<section class="facts" aria-label="His numbers">
			<Fact label="Where drafters take him">
				{#snippet value()}
					<Figure value={n.adp === null ? 'No ADP' : `Pick ${fixed(n.adp, 0)}`} />
					<GapChip {gap} />
				{/snippet}
				{drafters}
			</Fact>
			<Fact label="Over replacement" heat={heatFor(n.vor, n.vorRound)}>
				{#snippet value()}<Figure value={signed(n.vor)} /><span>{unit}</span>{/snippet}
				{valueWords}
			</Fact>
			<Fact label="Floor, median, ceiling">
				{#snippet value()}
					<span class="bar"
						><OutcomeBar floor={n.floor} median={n.median} ceiling={n.ceiling} /></span
					>
				{/snippet}
				{season}
				{scoring} points, from his low case to his high case
			</Fact>
		</section>

		{#if !page.underway}{@render thisSeason()}{/if}

		<div class="split" class:alone={!page.capsule}>
			{#if page.capsule}
				<article class="read">
					<h3><Label>Our read</Label></h3>
					<Capsule body={page.capsule.body} pulls={page.capsule.pulls} />
				</article>
			{/if}
			<aside class="tier" aria-label="His tier">
				<TierMates
					tier={page.tier.tier}
					group={POSITION_NAMES[page.position]}
					{mates}
					currentId={page.id}
					cliff={page.tier.cliff}
					unit={page.format.unit}
					basis="Projected {page.format.label} points, {season}"
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
						{ label: 'Projected', align: 'end' },
						{ label: 'Over replacement', align: 'end' },
						{ label: 'Tier', align: 'end' }
					]}
				>
					{#each page.lines as line (line.format.id)}
						<tr>
							<td><a href={links.board(line.format.id, page.position)}>{line.format.label}</a></td>
							<td class="num">{line.numbers.ourRank}</td>
							<td class="num">{fixed(line.numbers.projected)}</td>
							<td class="num">{signed(line.numbers.vor)}</td>
							<td class="num">{line.numbers.tier}</td>
						</tr>
					{/each}
				</Table>
			</section>
		{/if}
	</main>
</SiteShell>

<style>
	/* The league's two lines sit close as one block; with no league selected they take no place. */
	.league-lines {
		display: flex;
		flex-direction: column;
		gap: var(--s-1);
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

	/* With no read of ours, the tier card takes the left column rather than sitting alone at the
	   right. */
	.alone {
		grid-template-columns: minmax(0, 480px);
	}

	.alone .tier {
		grid-column: 1;
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
