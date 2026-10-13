<script lang="ts">
	import {
		DEFAULT_TEAMS,
		adpWords,
		draftersGap,
		lastName,
		oddsWords,
		pickLabel
	} from '#lib/format/draft.ts';
	import { fixed, signed } from '#lib/format/number.ts';
	import CallPanel from '#lib/ui/CallPanel.svelte';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import Face from '#lib/ui/Face.svelte';
	import DisplayTitle from '#lib/ui/DisplayTitle.svelte';
	import GapChip from '#lib/ui/GapChip.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Keys from '#lib/ui/Keys.svelte';
	import OddsCell from '#lib/ui/OddsCell.svelte';
	import PickStrip from '#lib/ui/PickStrip.svelte';
	import Stepper from '#lib/ui/Stepper.svelte';
	import ToneChip from '#lib/ui/ToneChip.svelte';
	import Label from '#lib/ui/Label.svelte';
	import PositionPill from '#lib/ui/PositionPill.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Row from '#lib/ui/Row.svelte';
	import RowHead from '#lib/ui/RowHead.svelte';
	import ScoreBug from '#lib/ui/ScoreBug.svelte';
	import Field from '#lib/ui/Field.svelte';
	import NoteLine from '#lib/ui/NoteLine.svelte';
	import Search from '#lib/ui/Search.svelte';
	import SheetRow from '#lib/ui/SheetRow.svelte';
	import SheetTier from '#lib/ui/SheetTier.svelte';
	import TagChip from '#lib/ui/TagChip.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import SinceStrip from '#lib/ui/SinceStrip.svelte';
	import TeamPanel from '#lib/ui/TeamPanel.svelte';
	import TierChip from '#lib/ui/TierChip.svelte';
	import TierStrip from '#lib/ui/TierStrip.svelte';
	import ValueCell from '#lib/ui/ValueCell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { TINTED_ROUNDS, heatFor, vorCell } from '#lib/ui/heat.ts';
	import type { BoardPlayer } from '#lib/types/player.ts';
	import { ICON_NAMES } from '#lib/ui/icons.ts';
	import DocPage from '#lib/ui/system/DocPage.svelte';
	import DocSection from '#lib/ui/system/DocSection.svelte';
	import Part from '#lib/ui/system/Part.svelte';
	import Parts from '#lib/ui/system/Parts.svelte';
	import Specimen from '#lib/ui/system/Specimen.svelte';
	import Swatch from '#lib/ui/system/Swatch.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const ROW_MIN_WIDTH = 760;
	const BAND_MIN_WIDTH = 520;
	const PLAYER_HREF = '/players';
	const PAPER_TOKENS = [
		{ token: '--paper', about: 'The page.' },
		{ token: '--paper-ink', about: 'Names, ranks and the rules between tiers.' },
		{ token: '--paper-line', about: 'The hairline under each player.' },
		{ token: '--paper-muted', about: 'Teams, tags, notes and the column heads.' }
	] as const;
	/** A drafter's own words, as the specimen's note. */
	const SHEET_NOTE = 'Take him over any WR left in tier 3.';

	/** What a value cell's tint says about this player, from his own round and sign. */
	function valueNote(player: BoardPlayer, boardSize: number): string {
		const { vor, vorRound } = player;
		if (heatFor(vor, vorRound) === 'heat-neg') {
			return 'Rose with a minus. Below replacement, a bench player this year.';
		}
		const first = (vorRound - 1) * DEFAULT_TEAMS + 1;
		const last = vorRound * DEFAULT_TEAMS;
		const rank = `His points over replacement rank ${first} to ${last} of our ${boardSize}.`;
		if (heatFor(vor, vorRound) === 'none') {
			return `No tint. ${rank} Greens stop after round ${TINTED_ROUNDS}.`;
		}
		return `Round ${vorRound} green. ${rank} One green per round, paler each round, through round ${TINTED_ROUNDS}.`;
	}

	const row = $derived(data.rowPlayer);
	const call = $derived(data.soloRoom.call);
	const runner = $derived(data.soloRoom.runner);
	const nextLabel = $derived(pickLabel(data.soloRoom.next));
	const positionView = ['WR', 'RB'] as const;
	let chosenPosition = $state<(typeof positionView)[number]>('WR');
	const sheetTags = ['Targets', 'Sleepers', 'Avoid', 'Notes'] as const;
	let chosenTag = $state<(typeof sheetTags)[number]>('Targets');
	let stepperValue = $state(2);
</script>

<svelte:head>
	<title>Commish System</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<Shell title="System" active={null}>
	{#snippet search()}
		<Search placeholder="Search {data.boardSize} players" label="Search players" />
	{/snippet}

	<DocPage title="System">
		<DocSection title="Row" sub="A real board row, Chris Olave in the WR view, taken apart.">
			<Specimen minWidth={ROW_MIN_WIDTH}>
				<RowHead />
				<Row
					player={row}
					href={PLAYER_HREF}
					scale={data.wrRangeScale}
					showTier={false}
					unit={data.scoringUnit}
					eager
				/>
			</Specimen>
			<Parts>
				<Part name="Face" about="A 40px headshot on every row, before anything else.">
					{#snippet show()}<Face src={row.headshot} size={40} loading="eager" />{/snippet}
				</Part>
				<Part
					name="Name"
					about="Outfit 600 at 15px. It truncates only after the face and pill fit."
				>
					{#snippet show()}<b>{row.name}</b>{/snippet}
				</Part>
				<Part
					name="Position pill"
					about="Position and rank at that position. Monochrome, because color is spent on numbers."
				>
					{#snippet show()}<PositionPill
							position={row.position}
							rank={row.positionRank}
						/>{/snippet}
				</Part>
				<Part
					name="The one number, with its basis"
					about="Points over replacement in Big Shoulders. The label under it says what it is."
				>
					{#snippet show()}<ValueCell {...vorCell(row.vor, row.vorRound)} />{/snippet}
				</Part>
				<Part
					name="The ADP sentence"
					about="Where drafters take him against our rank, in words. Green when later, rose when earlier."
				>
					{#snippet show()}
						<GapChip gap={draftersGap(row.adp, row.ourRank)} />
						{#if row.adp !== null}<Label>ADP {fixed(row.adp)}</Label>{/if}
					{/snippet}
				</Part>
			</Parts>
		</DocSection>

		<DocSection
			title="Tier strip"
			sub="Tiers are drawn within each position. The All view carries the tier as a chip instead."
		>
			<Specimen minWidth={BAND_MIN_WIDTH}>
				<TierStrip
					tier={data.wrTier.tier}
					count={data.wrTier.count}
					group={data.wrTier.group}
					cliff={data.wrTier.cliff}
					unit={data.scoringUnit}
				/>
			</Specimen>
			<Parts>
				<Part
					name="The strip"
					about="Tier number on the tier's hue. Hot red at the top of a position, cold slate at the bottom. The number is printed, so hue is never the only channel."
				/>
				<Part name="The name and the count" about="How many players share the tier.">
					{#snippet show()}<b>Tier {data.wrTier.tier}</b>
						<Label>{data.wrTier.count} {data.wrTier.group}</Label>{/snippet}
				</Part>
				<Part
					name="The drop label"
					about="Projected PPR points from the last player in this tier to the first in the next. The reason tiers exist, printed."
				/>
				<Part name="The tier chip" about="The All view's tier, on the same hue as its strip.">
					{#snippet show()}
						{#each [1, 2, 3, 4, 5, 6, 7] as tier (tier)}<TierChip {tier} />{/each}
					{/snippet}
				</Part>
			</Parts>
		</DocSection>

		<DocSection
			title="Your sheet"
			sub="Chris Olave on a cheat sheet in the WR view: your rank, your tier strip with its handle, your tags and your note."
		>
			<Specimen minWidth={ROW_MIN_WIDTH}>
				<SheetTier tier={2} count={6} group="WRs" startId="system-tier" movable />
				<SheetRow
					id={row.id}
					name={row.name}
					position={row.position}
					positionRank={row.positionRank}
					team={row.team}
					headshot={row.headshot}
					rank={18}
					tags={['Target', 'Value']}
					note={SHEET_NOTE}
					ourRank={row.ourRank}
					eager
				/>
			</Specimen>
			<Parts>
				<Part
					name="The handle"
					about="Drag by it, or focus it and press Space, then the arrows. The row slides, everything else waits for the drop."
				/>
				<Part
					name="Your tier strip"
					about="The board's strip, drawn within a position. Its handle moves where the tier starts. The cross joins it to the tier above."
				/>
				<Part name="Tags" about="The fixed six and your own words, in your color.">
					{#snippet show()}<TagChip label="Target" /><TagChip label="Value" />{/snippet}
				</Part>
				<Part name="The note" about="One line until the row opens.">
					{#snippet show()}<NoteLine note={SHEET_NOTE} />{/snippet}
				</Part>
				<Part name="Field" about="A note, a pasted list, your own tag, a sheet's name.">
					{#snippet show()}<Field label="Your own tag" placeholder="Your own tag" />{/snippet}
				</Part>
			</Parts>
		</DocSection>

		<DocSection
			title="Paper"
			sub="The printed sheet's tokens. They are the same in both themes, and print media puts every page on them."
		>
			<Parts>
				{#each PAPER_TOKENS as { token, about } (token)}
					<Swatch {token} {about} />
				{/each}
			</Parts>
		</DocSection>

		<DocSection
			title="Value cell"
			sub="Points over replacement, PPR 2026, tinted by the round it ranks in among our 400."
		>
			<Parts>
				{#each data.valuePlayers as player (player.id)}
					<Part name={player.name} about={valueNote(player, data.boardSize)}>
						{#snippet show()}<ValueCell {...vorCell(player.vor, player.vorRound)} />{/snippet}
					</Part>
				{/each}
			</Parts>
		</DocSection>

		<DocSection title="The verb">
			<Specimen frame="none" layout="row">
				<Verb href="/mock">Start a mock draft</Verb>
				<Quiet>Queue</Quiet>
				<Quiet key="U">Undo</Quiet>
				<ChipGroup label="Position">
					{#each positionView as position (position)}
						<Chip pressed={chosenPosition === position} onclick={() => (chosenPosition = position)}
							>{position}</Chip
						>
					{/each}
				</ChipGroup>
				<ChipGroup label="Tags" variant="loose">
					{#each sheetTags as tag (tag)}
						<Chip size="sm" pressed={chosenTag === tag} onclick={() => (chosenTag = tag)}
							>{tag}</Chip
						>
					{/each}
				</ChipGroup>
			</Specimen>
			<Parts>
				<Part
					name="Solid orange, one per viewport"
					about="The verb is the next thing to do, named with what it does: Start a mock draft, Add to my sheet, Draft Odunze."
				/>
				<Part
					name="Quiet outline for the rest"
					about="Queue, Theme and every secondary action share one outlined style."
				/>
				<Part
					name="Ink for the chosen chip"
					about="A pressed chip fills with ink, never orange, so orange keeps meaning the verb, the brand and you."
				/>
			</Parts>
		</DocSection>

		<DocSection
			title="Mock room parts"
			sub="The solo room at pick 5.08 of a 12-team PPR mock, with real survival odds, and the lobby score bug."
		>
			<Specimen frame="dashed">
				<SinceStrip since={data.soloRoom.since} went={data.soloRoom.went} />
				<CallPanel
					tag="Our call at {pickLabel(data.soloRoom.now)}"
					player={call}
					vor={call.vor}
					adp={adpWords(call.adp, data.soloRoom.now)}
					odds={data.soloRoom.callOdds}
					oddsLabel="chance he is still there at {nextLabel}"
					action={{ label: `Draft ${lastName(call.name)}`, key: 'Enter' }}
				>
					{#snippet reason()}
						<b>{runner.name}</b> has more over replacement at {signed(runner.vor)}, but he is still
						there at {nextLabel}
						{oddsWords(data.soloRoom.runnerOdds)} of the time. {lastName(call.name)} is not.
					{/snippet}
				</CallPanel>
				<ScoreBug {...data.lobbyBug} />
			</Specimen>
			<Parts>
				<Part
					name="What went since your pick"
					about="Against bots there is no clock and no reveal. The picks between your turns land as one strip with faces, and anyone from your queue is ringed in orange."
				/>
				<Part
					name="Our call"
					about="His face, the survival odds as the one big number, the runner-up in a sentence, the verb with its key. A panel with an orange edge, so it never covers the pool."
				/>
				<Part
					name="Score bug, lobby only"
					about="It appears only in a room with people in it, because only there is anyone on a clock. A solo mock never shows a clock."
				/>
			</Parts>
		</DocSection>

		<DocSection title="Your team and the keys" sub="The same solo room at 5.08, from the dock.">
			<Parts as="div">
				<TeamPanel slots={data.soloTeam} rosterSize={data.soloRoom.rosterSize} />
				<Keys bindings={data.roomKeys} />
			</Parts>
		</DocSection>

		<DocSection
			title="Odds, verdicts and the setup's controls"
			sub="The pool's odds cell, the strip every room shares, the report's verdict chips, and the setup page's stepper and field."
		>
			<Specimen frame="dashed">
				<PickStrip
					lead={pickLabel(data.soloRoom.now)}
					leadLines={['just taken, newest first', '2 of the last 3 by people']}
					picks={data.soloRoom.went.slice(-3).map((w, i) => ({
						key: w.pick,
						player: w.player,
						lines: [i === 0 ? 'jpk88' : 'bot', pickLabel(w.pick)],
						ring: i === 0 ? 'ink' : undefined,
						strong: i === 0
					}))}
					width="md"
				/>
			</Specimen>
			<Parts>
				<Part
					name="Odds cell"
					about="The chance he lasts to your next pick, a meter under it, and what the chance is of."
				>
					{#snippet show()}<OddsCell
							odds={data.soloRoom.runnerOdds}
							label="still there at {nextLabel}"
						/><OddsCell odds={null} label="" />{/snippet}
				</Part>
				<Part
					name="Pick strip"
					about="Faces in the order they went. SinceStrip is this strip in the solo room; in a lobby the newest is ringed in ink and a person's pick names its handle."
				/>
				<Part
					name="Verdict chips"
					about="Green for a steal or a pick right on time, rose for a reach or a pick that could have waited, grey for even. The words carry it."
				>
					{#snippet show()}
						<ToneChip tone="gain">3 after drafters</ToneChip>
						<ToneChip tone="loss">could wait, 82% there next turn</ToneChip>
						<ToneChip tone="even">at ADP</ToneChip>
					{/snippet}
				</Part>
				<Part
					name="Display title"
					about="The number face, uppercase: a page's title at 38, a panel's name at 30, a section at 26 with what it counts beside it."
				>
					{#snippet show()}
						<DisplayTitle size="page">New mock</DisplayTitle>
						<DisplayTitle size="panel">Pool</DisplayTitle>
						<DisplayTitle note="projected starting points, 12 teams">The field</DisplayTitle>
					{/snippet}
				</Part>
				<Part name="Stepper" about="A roster count with its bounds.">
					{#snippet show()}<Stepper
							label="RB"
							value={stepperValue}
							min={0}
							max={6}
							onchange={(v: number) => (stepperValue = v)}
						/>{/snippet}
				</Part>
			</Parts>
		</DocSection>

		<DocSection title="Rail icons" sub="A 24 grid, a 1.8 stroke, in the color of the text.">
			<Parts>
				{#each ICON_NAMES as name (name)}
					<Part {name}>
						{#snippet show()}<Icon {name} />{/snippet}
					</Part>
				{/each}
			</Parts>
		</DocSection>
	</DocPage>
</Shell>
