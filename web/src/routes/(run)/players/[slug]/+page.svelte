<script lang="ts">
	import { draftersGap, lastName } from '#lib/format/draft.ts';
	import { fixed, plural, signed } from '#lib/format/number.ts';
	import { POSITION_PLURAL } from '#lib/run/derive.ts';
	import AddToSheet from '#lib/site/AddToSheet.svelte';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import { links } from '#lib/site/links.ts';
	import Capsule from '#lib/ui/Capsule.svelte';
	import Face from '#lib/ui/Face.svelte';
	import Fact from '#lib/ui/Fact.svelte';
	import Figure from '#lib/ui/Figure.svelte';
	import GapChip from '#lib/ui/GapChip.svelte';
	import Label from '#lib/ui/Label.svelte';
	import OutcomeBar from '#lib/ui/OutcomeBar.svelte';
	import PositionPill from '#lib/ui/PositionPill.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Table from '#lib/ui/Table.svelte';
	import TierChip from '#lib/ui/TierChip.svelte';
	import TierMates from '#lib/ui/TierMates.svelte';
	import { heatFor } from '#lib/ui/heat.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const page = $derived(data.page);
	const n = $derived(page.numbers);
	const season = $derived(data.run.season);
	const unit = $derived(page.format.unit);
	const scoring = $derived(page.format.label);
	const gap = $derived(draftersGap(n.adp, n.ourRank));
	const sources = $derived(page.adpSources.join(' and '));
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
			? `Below replacement, among the ${String(page.boardSize)} on our board`
			: `Round ${String(n.vorRound)} value among the ${String(page.boardSize)} on our board`
	);
	const mates = $derived(
		page.tier.mates.map((mate) => ({ ...mate, href: links.player(mate.slug) }))
	);
</script>

<SiteShell title={page.name} active="players" run={data.run}>
	{#snippet tail()}<Quiet href={links.compare(page.slug)}>Compare</Quiet>{/snippet}
	<main class="player">
		<nav class="crumb" aria-label="Where this page sits">
			<a href={links.board(page.format.id)}>Board</a> /
			<a href={links.board(page.format.id, page.position)}>{page.position}</a> /
			{page.name}
		</nav>

		<section class="hero">
			<span class="face"
				><Face src={page.headshot} size={168} phoneSize={96} loading="eager" /></span
			>
			<div class="ident">
				<h2>{page.name}</h2>
				<div class="meta">
					<PositionPill position={page.position} rank={n.positionRank} />
					<TierChip tier={n.tier} long />
					<a href={links.club(page.team)}>{page.team}</a>
				</div>
			</div>
			<div class="big">
				<Figure
					value={fixed(n.projected)}
					size="xl"
					align="end"
					phoneAlign="start"
					caption="projected {scoring} points in {season}, over {fixed(
						n.expectedGames
					)} expected games"
				/>
				<AddToSheet playerId={page.id} name={lastName(page.name)} fill />
			</div>
		</section>

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

		<div class="split">
			{#if page.capsule}
				<article class="read">
					<h3><Label>Our read</Label></h3>
					<Capsule body={page.capsule.body} pulls={page.capsule.pulls} />
				</article>
			{/if}
			<aside class="tier" aria-label="His tier">
				<TierMates
					tier={page.tier.tier}
					group={POSITION_PLURAL[page.position]}
					{mates}
					currentId={page.id}
					cliff={page.tier.cliff}
					{unit}
					basis="Projected {scoring} points, {season}"
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
	.player {
		padding: var(--s-5);
		display: flex;
		flex-direction: column;
		gap: var(--s-5);
		max-width: 1320px;
	}

	.crumb {
		font-size: var(--t-sm);
		color: var(--ink-3);
	}

	.crumb a {
		text-decoration: none;
	}

	.crumb a:hover {
		text-decoration: underline;
	}

	.hero {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: var(--s-6);
		align-items: center;
		padding: var(--s-6);
		border-radius: var(--r-md);
		background: var(--surface);
		border: 1px solid var(--line);
	}

	.face {
		display: flex;
	}

	.ident {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
		min-width: 0;
	}

	h2 {
		margin: 0;
		font-size: clamp(2rem, 4vw, 3.25rem);
		font-weight: 700;
		line-height: 1;
		letter-spacing: -0.01em;
		text-wrap: balance;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-2);
		align-items: center;
		font-size: var(--t-md);
		color: var(--ink-2);
	}

	.meta a {
		text-decoration: none;
	}

	.meta a:hover {
		text-decoration: underline;
	}

	.big {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--s-4);
	}

	.facts {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--s-4);
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

		.hero {
			grid-template-columns: auto minmax(0, 1fr);
			gap: var(--s-4);
			padding: var(--s-4);
		}

		.big {
			grid-column: 1 / -1;
			align-items: stretch;
		}
	}
</style>
