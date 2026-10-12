<script lang="ts">
	import {
		LOBBY_BUG,
		ROOM_KEYS,
		ROW_PLAYER,
		SCORING_UNIT,
		SOLO_ROOM,
		SOLO_TEAM,
		VALUE_PLAYERS,
		WR_RANGE_SCALE,
		WR_TIER
	} from '../../fixtures/mock-2026-ppr.ts';
	import { adpWords, draftersGap, lastName, oddsWords, pickLabel } from '#lib/format/draft.ts';
	import { fixed, signed } from '#lib/format/number.ts';
	import CallPanel from '#lib/ui/CallPanel.svelte';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import Face from '#lib/ui/Face.svelte';
	import GapChip from '#lib/ui/GapChip.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Keys from '#lib/ui/Keys.svelte';
	import Label from '#lib/ui/Label.svelte';
	import PositionPill from '#lib/ui/PositionPill.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Row from '#lib/ui/Row.svelte';
	import RowHead from '#lib/ui/RowHead.svelte';
	import ScoreBug from '#lib/ui/ScoreBug.svelte';
	import Search from '#lib/ui/Search.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import SinceStrip from '#lib/ui/SinceStrip.svelte';
	import TeamPanel from '#lib/ui/TeamPanel.svelte';
	import TierChip from '#lib/ui/TierChip.svelte';
	import TierStrip from '#lib/ui/TierStrip.svelte';
	import ValueCell from '#lib/ui/ValueCell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { vorCell } from '#lib/ui/heat.ts';
	import { ICON_NAMES } from '#lib/ui/icons.ts';
	import DocPage from '#lib/ui/system/DocPage.svelte';
	import DocSection from '#lib/ui/system/DocSection.svelte';
	import Part from '#lib/ui/system/Part.svelte';
	import Parts from '#lib/ui/system/Parts.svelte';
	import Specimen from '#lib/ui/system/Specimen.svelte';

	const ROW_MIN_WIDTH = 760;
	const BAND_MIN_WIDTH = 520;
	const PLAYER_HREF = '/players';
	const VALUE_NOTES: Readonly<Record<string, string>> = {
		'Chris Olave': 'Round 1 green. His points over replacement rank in the first 12 of our 400.',
		'Tetairoa McMillan': 'Round 3 green, paler. Four greens, one per round, then no tint.',
		'Marvin Harrison Jr.': 'Rose with a minus. Below replacement, a bench player in PPR this year.'
	};

	const row = ROW_PLAYER;
	const { call, runner } = SOLO_ROOM;
	const nextLabel = pickLabel(SOLO_ROOM.next);
	const positionView = ['WR', 'RB'] as const;
	let chosenPosition = $state<(typeof positionView)[number]>('WR');
	const sheetTags = ['Targets', 'Sleepers', 'Avoid', 'Notes'] as const;
	let chosenTag = $state<(typeof sheetTags)[number]>('Targets');
</script>

<svelte:head>
	<title>Commish System</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<Shell title="System" active={null}>
	{#snippet search()}
		<Search placeholder="Search 400 players" label="Search players" />
	{/snippet}

	<DocPage title="System">
		<DocSection title="Row" sub="A real board row, Chris Olave in the WR view, taken apart.">
			<Specimen minWidth={ROW_MIN_WIDTH}>
				<RowHead />
				<Row
					player={row}
					href={PLAYER_HREF}
					scale={WR_RANGE_SCALE}
					showTier={false}
					unit={SCORING_UNIT}
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
					tier={WR_TIER.tier}
					count={WR_TIER.count}
					group={WR_TIER.group}
					cliff={WR_TIER.cliff}
					unit={SCORING_UNIT}
				/>
			</Specimen>
			<Parts>
				<Part
					name="The strip"
					about="Tier number on the tier's hue. Hot red at the top of a position, cold slate at the bottom. The number is printed, so hue is never the only channel."
				/>
				<Part name="The name and the count" about="How many players share the tier.">
					{#snippet show()}<b>Tier {WR_TIER.tier}</b>
						<Label>{WR_TIER.count} {WR_TIER.group}</Label>{/snippet}
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
			title="Value cell"
			sub="Points over replacement, PPR 2026, tinted by the round it ranks in among our 400."
		>
			<Parts>
				{#each VALUE_PLAYERS as player (player.id)}
					<Part name={player.name} about={VALUE_NOTES[player.name] ?? ''}>
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
				<SinceStrip since={SOLO_ROOM.since} went={SOLO_ROOM.went} />
				<CallPanel
					tag="Our call at {pickLabel(SOLO_ROOM.now)}"
					player={call}
					vor={call.vor}
					adp={adpWords(call.adp, SOLO_ROOM.now)}
					odds={SOLO_ROOM.callOdds}
					oddsLabel="chance he is still there at {nextLabel}"
					action={{ label: `Draft ${lastName(call.name)}`, key: 'Enter' }}
				>
					{#snippet reason()}
						<b>{runner.name}</b> has more over replacement at {signed(runner.vor)}, but he is still
						there at {nextLabel}
						{oddsWords(SOLO_ROOM.runnerOdds)} of the time. {lastName(call.name)} is not.
					{/snippet}
				</CallPanel>
				<ScoreBug {...LOBBY_BUG} />
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
				<TeamPanel slots={SOLO_TEAM} rosterSize={SOLO_ROOM.rosterSize} />
				<Keys bindings={ROOM_KEYS} />
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
