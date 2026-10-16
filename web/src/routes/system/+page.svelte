<script lang="ts">
	import {
		DEFAULT_TEAMS,
		adpWords,
		draftersGap,
		lastName,
		oddsWords,
		pickLabel
	} from '#lib/format/draft.ts';
	import { fixed, plural, signed } from '#lib/format/number.ts';
	import ActionBar from '#lib/ui/ActionBar.svelte';
	import CallPanel from '#lib/ui/CallPanel.svelte';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import Face from '#lib/ui/Face.svelte';
	import DisplayTitle from '#lib/ui/DisplayTitle.svelte';
	import GapChip from '#lib/ui/GapChip.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Keys from '#lib/ui/Keys.svelte';
	import OddsCell from '#lib/ui/OddsCell.svelte';
	import Panel from '#lib/ui/Panel.svelte';
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
	import FilePick from '#lib/ui/FilePick.svelte';
	import Menu from '#lib/ui/Menu.svelte';
	import Place from '#lib/ui/Place.svelte';
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
	import { railIconNames } from '#lib/ui/rail-icons.ts';
	import RailIcon from '#lib/ui/RailIcon.svelte';
	import { sectionHref } from '#lib/ui/nav.ts';
	import DocPage from '#lib/ui/system/DocPage.svelte';
	import DocSection from '#lib/ui/system/DocSection.svelte';
	import Part from '#lib/ui/system/Part.svelte';
	import Parts from '#lib/ui/system/Parts.svelte';
	import Specimen from '#lib/ui/system/Specimen.svelte';
	import NightlyParts from '#lib/ui/system/NightlyParts.svelte';
	import RoundParts from '#lib/ui/system/RoundParts.svelte';
	import Swatch from '#lib/ui/system/Swatch.svelte';
	import { soloKeys } from '#lib/room/keys.ts';
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
	/** His place on the specimen's sheet. */
	const SHEET_PLACE = 18;

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

	const row = $derived(data.nightly.row);
	const unit = $derived(data.nightly.page.format.unit);
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
		<DocSection
			title="Row"
			sub="A real board row from the run the board reads, {row.name} in the {row.position} view, taken apart."
		>
			<Specimen minWidth={ROW_MIN_WIDTH}>
				<RowHead />
				<Row
					player={row}
					href={PLAYER_HREF}
					scale={data.nightly.rowScale}
					showTier={false}
					{unit}
					eager
				/>
			</Specimen>
			<Parts>
				<Part name="Face" about="A 40px headshot on every row, before anything else.">
					{#snippet show()}<Face src={row.headshot} size={40} loading="eager" />{/snippet}
				</Part>
				<Part
					name="Face, no headshot"
					about="A player with no headshot, or one that fails to load, holds his initials in the number face, so someone is on every row."
				>
					{#snippet show()}<Face src={null} name={row.name} size={40} /><Face
							src={null}
							name={row.name}
							size={22}
						/>{/snippet}
				</Part>
				<Part
					name="Face, on injured reserve"
					about="A player on his roster's IR slot carries a solid IR tag at the photo's top left, over the circle's edge at row sizes and inside the corner from 72px, clear of the eyes."
				>
					{#snippet show()}<Face src={row.headshot} name={row.name} size={32} status="ir" /><Face
							src={row.headshot}
							name={row.name}
							size={96}
							status="ir"
						/>{/snippet}
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
					{unit}
				/>
			</Specimen>
			<Parts>
				<Part
					name="The strip"
					about="Tier number on the tier's hue. Hot red at the top of a position, cold slate at the bottom. The number is printed, so hue is never the only channel."
				/>
				<Part name="The name and the count" about="How many players share the tier.">
					{#snippet show()}<b>Tier {data.wrTier.tier}</b>
						<Label>{plural(data.wrTier.count, data.wrTier.group.one, data.wrTier.group.many)}</Label
						>{/snippet}
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
			sub="{row.name} on a cheat sheet in the {row.position} view: your tier strip with its handle, his face and our board's pill, your note and tags, your place, where drafters take him, and the row's disclosure."
		>
			<Specimen minWidth={ROW_MIN_WIDTH}>
				<SheetTier
					tier={2}
					count={6}
					group={{ one: 'WR', many: 'WRs' }}
					startId="system-tier"
					movable
				/>
				<SheetRow
					id={row.id}
					name={row.name}
					position={row.position}
					team={row.team}
					headshot={row.headshot}
					place={SHEET_PLACE}
					board={{ rank: row.ourRank, positionRank: row.positionRank, adp: row.adp }}
					tags={[
						{ label: 'Target', tone: 'you' },
						{ label: 'Value', tone: 'you' }
					]}
					note={SHEET_NOTE}
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
				<Part
					name="Tags"
					about="The fixed six and your own words, in your color. Avoid warns, so it takes the loss tone, and it never sits beside Target."
				>
					{#snippet show()}<TagChip label="Target" /><TagChip label="Value" /><TagChip
							label="Avoid"
							tone="loss"
						/>{/snippet}
				</Part>
				<Part
					name="The note"
					about="One line beside him on a wide screen and under his name on a narrower one. The phone shows the note mark beside his name."
				>
					{#snippet show()}<NoteLine note={SHEET_NOTE} /><Icon name="note" size={14} />{/snippet}
				</Part>
				<Part
					name="Your place"
					about="Quiet, in the number face, after the person. The position pill carries our board's rank on every page, so your order never borrows it."
				>
					{#snippet show()}<Place place={SHEET_PLACE} />{/snippet}
				</Part>
				<Part
					name="The disclosure"
					about="Opens the row to its note, tags and tier. A tap anywhere on the row does the same."
				>
					{#snippet show()}<Icon name="chevron" size={18} />{/snippet}
				</Part>
				<Part
					name="More"
					about="The phone folds the sheet's quiet tools behind one button, so the bar stays one line."
				>
					{#snippet show()}<Menu label="More" id="system-more"
							><Quiet size="sm">Import</Quiet><Quiet size="sm">Export CSV</Quiet></Menu
						>{/snippet}
				</Part>
				<Part name="File pick" about="The site's own button for a file, with its name once chosen.">
					{#snippet show()}<FilePick
							label="Choose a CSV"
							accept=".csv,text/csv"
							empty="No file chosen"
							onpick={() => Promise.resolve(false)}
						/>{/snippet}
				</Part>
				<Part
					name="Unavailable"
					about="A verb you cannot press yet is the outline in the quietest ink, never a faded orange."
				>
					{#snippet show()}<Verb disabled>Replace my sheet</Verb>{/snippet}
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
				<Verb href={sectionHref('mock')}>Start a mock draft</Verb>
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
						{oddsWords(data.soloRoom.runnerOdds)} of the time. {lastName(call.name)} is there {oddsWords(
							data.soloRoom.callOdds
						)} of the time.
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
				<Keys bindings={soloKeys(false)} />
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
					about="The number face, uppercase: a nightly page's head at 44 (PageHead), a room's title at 38, a panel's name at 30, a section at 26 with what it counts beside it."
				>
					{#snippet show()}
						<DisplayTitle size="hero">2026 Board</DisplayTitle>
						<DisplayTitle size="page">New mock</DisplayTitle>
						<DisplayTitle size="panel">Pool</DisplayTitle>
						<DisplayTitle note="projected starting points, 12 teams">The field</DisplayTitle>
					{/snippet}
				</Part>
				<Part
					name="Stepper"
					about="A roster count with its bounds. On a phone each button is a 44px target."
				>
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

		<DocSection
			title="Notices and the action bar"
			sub="What a page says when something went wrong, and a form's verbs that stay on a phone's first screen."
		>
			<Specimen frame="dashed">
				<Panel padding="sm" edge="loss">
					<span> This mock is gone. It was deleted, or the link is wrong. </span>
				</Panel>
				<ActionBar>
					<Verb>Start against bots</Verb>
					<Quiet>Join a lobby with people</Quiet>
				</ActionBar>
			</Specimen>
			<Parts>
				<Part
					name="Error notice"
					about="A panel with a rose edge and wash: the truth in our words, then the verb that is the way forward. Never the API's own sentence when ours says more."
				/>
				<Part
					name="Action bar"
					about="A form's verb and the quiet one beside it. On a desk it follows the form. On a phone it pins above the tab bar. A refusal shows above the verbs, a note under them."
				/>
			</Parts>
		</DocSection>

		<NightlyParts nightly={data.nightly} run={data.run} />
		<RoundParts nightly={data.nightly} run={data.run} />

		<DocSection title="Rail icons" sub="A 24 grid, a 1.8 stroke, in the color of the text.">
			<Parts>
				{#each railIconNames() as name (name)}
					<Part {name}>
						{#snippet show()}<RailIcon {name} />{/snippet}
					</Part>
				{/each}
			</Parts>
		</DocSection>

		<DocSection title="Icons" sub="The same grid and stroke, for the controls on a page.">
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
