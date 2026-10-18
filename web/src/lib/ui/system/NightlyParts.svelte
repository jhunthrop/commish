<script lang="ts">
	import { fixed, signed } from '#lib/format/number.ts';
	import { scoringBasis } from '#lib/run/catalog.ts';
	import { POSITION_NAMES } from '#lib/run/derive.ts';
	import type { SystemNightly } from '#lib/server/pages/system.ts';
	import { runStampText, type RunStamp } from '#lib/run/stamp.ts';
	import BasisList from '../BasisList.svelte';
	import Capsule from '../Capsule.svelte';
	import Chip from '../Chip.svelte';
	import ChipGroup from '../ChipGroup.svelte';
	import Crumb from '../Crumb.svelte';
	import Face from '../Face.svelte';
	import Fact from '../Fact.svelte';
	import Figure from '../Figure.svelte';
	import GapChip from '../GapChip.svelte';
	import HeroCard from '../HeroCard.svelte';
	import OutcomeBar from '../OutcomeBar.svelte';
	import PageHead from '../PageHead.svelte';
	import Panel from '../Panel.svelte';
	import PanelHead from '../PanelHead.svelte';
	import PlayerLine from '../PlayerLine.svelte';
	import PositionPill from '../PositionPill.svelte';
	import Quiet from '../Quiet.svelte';
	import SearchMenu from '../SearchMenu.svelte';
	import Table from '../Table.svelte';
	import TierChip from '../TierChip.svelte';
	import TierJump from '../TierJump.svelte';
	import TierMates from '../TierMates.svelte';
	import Tile from '../Tile.svelte';
	import Toggle from '../Toggle.svelte';
	import { heatFor } from '../heat.ts';
	import DocSection from './DocSection.svelte';
	import Part from './Part.svelte';
	import Parts from './Parts.svelte';
	import Specimen from './Specimen.svelte';
	import Stamp from '../Stamp.svelte';

	interface Props {
		nightly: SystemNightly;
		run: RunStamp;
	}

	let { nightly, run }: Props = $props();

	const PLAYER_HREF = '/players';
	const page = $derived(nightly.page);
	const n = $derived(page.numbers);
	const unit = $derived(page.format.unit);
	const group = $derived(POSITION_NAMES[page.position]);
	let showBelow = $state(true);
	let showRange = $state(false);
</script>

<DocSection
	title="Nightly page parts"
	sub="{page.name} from the {runStampText(
		run
	).toLowerCase()}, the parts the board, player, ADP, record, clubs and schedule pages are built from."
>
	<Parts>
		<Part
			name="The run stamp"
			about="Beside the title in the top bar on every nightly page: the run every number comes from."
		>
			{#snippet show()}<Stamp text={runStampText(run)} />{/snippet}
		</Part>
		<Part
			name="The search menu"
			about="Under the top bar's search, from the run's index, loaded on the first focus. Arrows move, Enter opens his page."
		>
			{#snippet show()}
				<span class="menu">
					<SearchMenu
						id="system-search-menu"
						active={0}
						hits={nightly.hits.map((hit) => ({ ...hit, href: PLAYER_HREF }))}
					/>
				</span>
			{/snippet}
		</Part>
		<Part
			name="Chips that are links"
			about="Formats and positions are pages, so their chips are links. The page you are on is pressed."
		>
			{#snippet show()}
				<ChipGroup label="Position">
					<Chip href={PLAYER_HREF}>All</Chip>
					<Chip href={PLAYER_HREF} pressed>{page.position}</Chip>
				</ChipGroup>
			{/snippet}
		</Part>
	</Parts>

	<Specimen frame="dashed">
		<PageHead title="{run.season} Board" lead={page.format.basis.join(' · ')}>
			{#snippet actions()}<Quiet size="sm" href={PLAYER_HREF}>ADP</Quiet>{/snippet}
		</PageHead>
		<Crumb
			trail={[
				{ label: 'Board', href: PLAYER_HREF },
				{ label: page.position, href: PLAYER_HREF },
				{ label: page.name }
			]}
		/>
		<HeroCard title={page.name}>
			{#snippet media()}<Face src={page.headshot} size={168} phoneSize={96} />{/snippet}
			{#snippet meta()}
				<PositionPill position={page.position} rank={n.positionRank} />
				<TierChip tier={n.tier} long />
				<span>{page.team}</span>
			{/snippet}
			{#snippet aside()}
				<Figure
					value={fixed(n.projected)}
					size="xl"
					align="end"
					phoneAlign="start"
					caption="projected {page.format.label} points in {run.season}, over {fixed(
						n.expectedGames
					)} expected games"
				/>
			{/snippet}
		</HeroCard>
		<span class="tile">
			<Tile title={page.name} href={PLAYER_HREF} meta="{page.position} · {page.team}">
				<Figure value={fixed(n.projected)} size="md" />
			</Tile>
		</span>
	</Specimen>
	<Parts>
		<Part
			name="The page head"
			about="Every nightly page opens with it: the title in the number face, one line naming the basis, quiet links at the right end."
		/>
		<Part name="The crumb" about="Where a page sits, every step but the page itself a link." />
		<Part
			name="The hero card"
			about="A page about one player or club: the face, the name, its pills, and the one big number with the verb under it."
		/>
		<Part
			name="The tile"
			about="One of many on an index page: a name that links, one line of labels, then its number."
		/>
	</Parts>
	<Parts as="div">
		<Fact label="Where drafters take him">
			{#snippet value()}
				<Figure value={n.adp === null ? 'No ADP' : `Pick ${fixed(n.adp, 0)}`} />
				<GapChip adp={n.adp} gap={n.gap} />
			{/snippet}
			We have him at pick {n.ourRank}.
		</Fact>
		<Fact label="Over replacement" heat={heatFor(n.vor, n.vorRound)}>
			{#snippet value()}<Figure value={signed(n.vor)} /><span>{unit}</span>{/snippet}
			Round {n.vorRound} value among the {page.boardSize} on our board
		</Fact>
		{#if n.floor !== null && n.median !== null && n.ceiling !== null}
			<Fact label="Floor, median, ceiling">
				{#snippet value()}<span class="grow"
						><OutcomeBar
							floor={n.floor ?? 0}
							median={n.median ?? 0}
							ceiling={n.ceiling ?? 0}
						/></span
					>{/snippet}
				{run.season}
				{page.format.label} points, from his low case to his high case
			</Fact>
		{/if}
	</Parts>
	<Parts>
		<Part
			name="The one big number"
			about="Big Shoulders at 88px with its basis under it. One per page, on the page it is about."
		/>
		<Part
			name="A fact"
			about="A label, one number with its unit or chip, and one sentence of basis. Over replacement takes its round's green."
		/>
		<Part
			name="Floor, median, ceiling"
			about="His own range, or two players on one shared scale. The median is ink, because orange marks only the brand, the verb and you."
		/>
		<Part name="The long tier chip" about="Where there is room, the hero.">
			{#snippet show()}<TierChip tier={n.tier} long />{/snippet}
		</Part>
	</Parts>

	{#if page.capsule}
		<Specimen frame="dashed">
			<Capsule body={page.capsule.body} pulls={page.capsule.pulls} />
		</Specimen>
		<Parts>
			<Part
				name="The capsule"
				about="Newsreader, on the player page only. The run checks every pull figure appears in the prose word for word."
			/>
		</Parts>
	{/if}

	<Parts as="div">
		<TierMates
			tier={page.tier.tier}
			{group}
			mates={page.tier.mates.map((mate) => ({ ...mate, href: PLAYER_HREF }))}
			currentId={page.id}
			cliff={page.tier.cliff}
			{unit}
			basis="Projected {page.format.label} points, {run.season}"
		/>
		<Panel>
			<PanelHead title="Tiers" aside="Drop to next" />
			<TierJump
				{group}
				tiers={[
					{
						tier: page.tier.tier,
						count: page.tier.mates.length,
						cliff: page.tier.cliff,
						href: '#'
					}
				]}
			/>
		</Panel>
		<Panel>
			<PanelHead title="Show" />
			<Toggle label="Players below replacement" bind:checked={showBelow} />
			<Toggle label="Floor to ceiling" bind:checked={showRange} />
		</Panel>
		<Panel>
			<PanelHead title="Basis" />
			<BasisList
				terms={[
					{ term: 'Scoring', means: scoringBasis(page.format) },
					{ term: 'Rose', means: 'Below replacement' }
				]}
			/>
		</Panel>
	</Parts>

	<Specimen>
		<Table
			caption="A table"
			columns={[
				{ label: 'ADP', align: 'end' },
				{ label: 'Player' },
				{ label: 'Our rank', align: 'end', wideOnly: true },
				{ label: 'Drafters vs us' }
			]}
		>
			{#each nightly.rows as row (row.id)}
				<tr>
					<td class="num">{row.adp === null ? 'None' : fixed(row.adp)}</td>
					<td>
						<PlayerLine
							name={row.name}
							position={row.position}
							positionRank={row.positionRank}
							team={row.team}
							headshot={row.headshot}
							href={PLAYER_HREF}
						/>
					</td>
					<td class="num wide">{row.ourRank}</td>
					<td><GapChip adp={row.adp} gap={row.gap} /></td>
				</tr>
			{/each}
		</Table>
	</Specimen>
	<Parts>
		<Part
			name="The player line"
			about="Face, name, position and club, one number at the end. Lists, tables, the sheet rail, the tier."
		/>
		<Part
			name="The tier list"
			about="His tier on the player page: the strip, the drop to the next tier, every player in it, him marked in your wash."
		/>
		<Part
			name="Panels in a rail"
			about="A head with its label at the right end, then a jump list, toggles or a basis list."
		/>
		<Part
			name="The table"
			about="Uppercase heads, numbers in Big Shoulders at the end of the cell. The phone keeps the columns that decide."
		/>
	</Parts>
</DocSection>

<style>
	.menu {
		position: relative;
		display: block;
		width: 100%;
		min-height: 200px;
	}

	.tile {
		display: block;
		max-width: 300px;
	}

	.grow {
		flex: 1;
	}
</style>
