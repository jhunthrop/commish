<script lang="ts">
	import { draftersGap } from '#lib/format/draft.ts';
	import { windowLabel } from '#lib/format/date.ts';
	import { fixed, plural } from '#lib/format/number.ts';
	import type { AdpPage } from '#lib/server/pages/adp.ts';
	import type { RunStamp } from '#lib/run/stamp.ts';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import GapChip from '#lib/ui/GapChip.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import PlayerLine from '#lib/ui/PlayerLine.svelte';
	import BasisList from '#lib/ui/BasisList.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { sectionHref } from '#lib/ui/nav.ts';
	import SiteShell from './SiteShell.svelte';
	import { links } from './links.ts';

	interface Props {
		page: AdpPage;
		run: RunStamp;
	}

	let { page, run }: Props = $props();

	const sourceNames = $derived(
		page.sources.map((source) => `${source.drafts}, ${windowLabel(source.window)}`)
	);
	const sourceTerms = $derived(
		page.sources.map((source) => ({
			term: source.drafts,
			means: `Averaged from ${windowLabel(source.window)}`
		}))
	);
</script>

<svelte:head>
	<link rel="canonical" href={links.adp(page.format.id)} />
</svelte:head>

<SiteShell title="{page.format.label} ADP" active="board" {run}>
	{#snippet tail()}<Verb href={sectionHref('mock')}>Start a mock draft</Verb>{/snippet}
	<main class="adp">
		<div class="content">
			<div class="lead">
				<PageHead
					title="{run.season} ADP"
					lead="{sourceNames.join(' and ')} · against our {page.format
						.label} board · earliest pick first"
				/>
			</div>
			{#if page.formats.length > 1}
				<div class="filters">
					<ChipGroup label="Scoring">
						{#each page.formats as format (format.id)}
							<Chip href={links.adp(format.id)} pressed={format.id === page.format.id}
								>{format.label}</Chip
							>
						{/each}
					</ChipGroup>
				</div>
			{/if}
			<Table
				caption="{page.format.label} ADP"
				minWidth={340}
				columns={[
					{ label: 'ADP', align: 'end' },
					{ label: 'Player' },
					{ label: 'Our rank', align: 'end', wideOnly: true },
					{ label: 'Drafters vs us' },
					{ label: 'Projected', align: 'end', wideOnly: true }
				]}
			>
				{#each page.rows as row (row.id)}
					<tr>
						<td class="num">{fixed(row.adp)}</td>
						<td>
							<PlayerLine
								name={row.name}
								position={row.position}
								positionRank={row.positionRank}
								team={row.team}
								headshot={row.headshot}
								href={links.player(row.slug)}
							/>
						</td>
						<td class="num wide">{row.ourRank}</td>
						<td><GapChip gap={draftersGap(row.adp, row.ourRank)} /></td>
						<td class="num wide">{fixed(row.projected)}</td>
					</tr>
				{/each}
			</Table>
		</div>
		<aside class="side" aria-label="Sources">
			<Panel>
				<PanelHead title="Sources" aside={plural(page.sources.length, 'source')} />
				<BasisList
					terms={[
						...sourceTerms,
						{ term: 'No ADP yet', means: `${plural(page.unpriced, 'player')} on our board` }
					]}
				/>
			</Panel>
		</aside>
	</main>
</SiteShell>

<style>
	.adp {
		display: grid;
		grid-template-columns: minmax(0, 1fr) var(--side-w);
		gap: var(--s-5);
		padding: var(--s-5);
	}

	.content {
		min-width: 0;
		max-width: 900px;
	}

	.lead {
		margin-bottom: var(--s-4);
	}

	.filters {
		margin-bottom: var(--s-4);
	}

	.side {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		align-self: start;
		position: sticky;
		top: 84px;
	}

	@media (max-width: 1180px) {
		.adp {
			grid-template-columns: minmax(0, 1fr);
		}

		.side {
			position: static;
		}
	}

	@media (max-width: 760px) {
		.adp {
			padding: var(--s-4);
		}
	}
</style>
