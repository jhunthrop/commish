<script lang="ts">
	import { recordHeadline, weekWords } from '#lib/run/record.ts';
	import { runStampText, type RunStamp } from '#lib/run/stamp.ts';
	import { absentWords } from '#lib/site/absent.ts';
	import { verdict } from '#lib/site/verdict.ts';
	import type { SystemNightly } from '#lib/server/pages/system.ts';
	import Chip from '../Chip.svelte';
	import ChipGroup from '../ChipGroup.svelte';
	import EmptyState from '../EmptyState.svelte';
	import FilterBar from '../FilterBar.svelte';
	import Footnote from '../Footnote.svelte';
	import LineList from '../LineList.svelte';
	import Quiet from '../Quiet.svelte';
	import Row from '../Row.svelte';
	import RowHead from '../RowHead.svelte';
	import ScheduleGrid from '../ScheduleGrid.svelte';
	import SheetMark from '../SheetMark.svelte';
	import Verb from '../Verb.svelte';
	import Verdict from '../Verdict.svelte';
	import DocSection from './DocSection.svelte';
	import Part from './Part.svelte';
	import Parts from './Parts.svelte';
	import Specimen from './Specimen.svelte';

	/** The parts the first UX round added: the board row's sheet mark and ADP order, the chooser's
	 * absent chip, the empty state, the record's lines and footnote, our call, the schedule grid.
	 * Every specimen is drawn from the run the build reads. */
	interface Props {
		nightly: SystemNightly;
		run: RunStamp;
	}

	let { nightly, run }: Props = $props();

	const HREF = '/players';
	const ROW_MIN_WIDTH = 760;
	const row = $derived(nightly.row);
	const unit = $derived(nightly.page.format.unit);
	const headline = $derived(recordHeadline(nightly.record));
	const [first, second] = $derived(nightly.rows);
	const call = $derived(first && second ? verdict(first, second, nightly.page.format.label) : null);
	const absentChip = $derived(nightly.formats.find((chip) => !chip.onRun));
	const absent = $derived(
		absentChip
			? absentWords(
					absentChip.label,
					runStampText(run),
					nightly.formats.filter((chip) => chip.onRun).map((chip) => chip.label)
				)
			: null
	);
</script>

<DocSection
	title="Rows, choices and calls"
	sub="The board row's sheet mark, the ADP order, the chooser, and what a page says when it has nothing to show."
>
	<Specimen minWidth={ROW_MIN_WIDTH}>
		<RowHead action />
		<Row player={row} href={HREF} scale={nightly.rowScale} showTier {unit}>
			{#snippet action()}
				<SheetMark name={row.name} place={null} sheetHref={HREF} onadd={() => undefined} />
			{/snippet}
		</Row>
		<Row player={row} href={HREF} scale={nightly.rowScale} showTier {unit} order="adp">
			{#snippet action()}
				<SheetMark name={row.name} place={12} sheetHref={HREF} onadd={() => undefined} />
			{/snippet}
		</Row>
	</Specimen>
	<Parts>
		<Part
			name="The whole row is his link"
			about="The name's link covers the row, so the face and the numbers open his page too. On the phone that is the row's one tap."
		/>
		<Part
			name="The sheet mark"
			about="A quiet plus that shows on the row's hover and focus and opens to Add to my sheet. Once he is on your sheet it is a state: an ink check and his place on it."
		>
			{#snippet show()}
				<SheetMark name={row.name} place={null} sheetHref={HREF} onadd={() => undefined} />
				<SheetMark name={row.name} place={12} sheetHref={HREF} onadd={() => undefined} />
			{/snippet}
		</Part>
		<Part
			name="The ADP order"
			about="The same row led by his ADP, with our rank under the gap chip. The ADP page is built on it."
		/>
		<Part
			name="The absent chip"
			about="A choice the run does not carry, dashed in quiet ink. It still opens its page, which says so."
		>
			{#snippet show()}
				<FilterBar>
					<ChipGroup label="Scoring">
						{#each nightly.formats as chip (chip.id)}
							<Chip href={HREF} pressed={chip.onRun} absent={!chip.onRun}>{chip.label}</Chip>
						{/each}
					</ChipGroup>
				</FilterBar>
			{/snippet}
		</Part>
	</Parts>

	<Specimen frame="dashed">
		{#if absent}
			<EmptyState title={absent.title} line={absent.line}>
				{#snippet actions()}<Quiet href={HREF}>{nightly.page.format.label} Board</Quiet>{/snippet}
			</EmptyState>
		{/if}
		{#if call?.kind === 'call'}
			<Verdict sentence={call.sentence}>
				{#snippet actions()}
					<Verb>Add {call.leaderName} to my sheet</Verb>
					<Quiet>Add {call.otherName} instead</Quiet>
				{/snippet}
			</Verdict>
		{/if}
	</Specimen>
	<Parts>
		<Part
			name="The empty state"
			about="What a view says when it has nothing to show, in plain words, with the ways forward."
		/>
		<Part
			name="Our call"
			about="A decision between options in one sentence with its evidence, then the verb and a quiet alternative."
		/>
	</Parts>

	<Specimen>
		<LineList
			label="Every week of the season"
			lines={nightly.record.weeks.map((week) => ({
				lead: `Week ${String(week.week)}`,
				text: weekWords(week)
			}))}
		/>
		<Footnote>{nightly.record.method}</Footnote>
	</Specimen>
	<Parts>
		<Part
			name="The line list"
			about="A short list said in sentences, each led by its name in bold. The record's weeks, the account's sheets and mocks."
		/>
		<Part
			name="The footnote"
			about="A quiet line at a page's foot: the method in one sentence, where the numbers came from. Headline here: {headline.value} {headline.caption}."
		/>
	</Parts>

	<Specimen>
		<ScheduleGrid
			rows={nightly.schedule.rows}
			weeks={nightly.schedule.weeks}
			caption="The hardest three slates, first weeks"
			strengthLabel="Strength"
		/>
	</Specimen>
	<Parts>
		<Part
			name="The schedule grid"
			about="The club's face and name lead, the rank follows in the number face, and the weeks scroll in their own frame. Each week names the opponent and his number, shaded for the strongest."
		/>
	</Parts>
</DocSection>
