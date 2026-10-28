<script lang="ts">
	import { isFreeAgent } from '#lib/format/free-agent.ts';
	import { EMPTY_FIGURE } from '#lib/format/empty.ts';
	import { onMount } from 'svelte';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import ContextNote from '#lib/context/ContextNote.svelte';
	import { contextLine } from '#lib/context/context-format.ts';
	import { apiFormatOf } from '#lib/run/format-ids.ts';
	import { fixed, signed } from '#lib/format/number.ts';
	import { POSITION_NAMES } from '#lib/run/derive.ts';
	import { readFigures } from '#lib/run/read-figures.ts';
	import { liveStatusClock, type LiveStatus } from '#lib/run/live-status.ts';
	import { UNWRITTEN_READ } from '#lib/run/unwritten-words.ts';
	import { CARD, compareLeadsWithoutVerb, unreadBasis, type CardTile } from '#lib/player/card.ts';
	import type { CardLeague, LiveCard } from '#lib/player/week-words.ts';
	import { noReadWords, shownWeekRead, weekReadLabel } from '#lib/player/week-read.ts';
	import { FORMATS_RANK } from '#lib/player/formats-words.ts';
	import { builtTiles, cardSource } from '#lib/player/card-source.ts';
	import { PLAYER_PAGE } from '#lib/player/page-words.ts';
	import PlayerCard from '#lib/player/PlayerCard.svelte';
	import type PlayerCompare from '#lib/player/PlayerCompare.svelte';
	import Credit from '#lib/site/Credit.svelte';
	import SheetAdd from '#lib/site/SheetAdd.svelte';
	import { lazySheet } from '#lib/site/lazy-sheet.svelte.ts';
	import SiteShell from '#lib/site/SiteShell.svelte';
	import { SEASON_ANCHOR, links } from '#lib/site/links.ts';
	import Capsule from '#lib/ui/Capsule.svelte';
	import Crumb from '#lib/ui/Crumb.svelte';
	import Fact from '#lib/ui/Fact.svelte';
	import Figure from '#lib/ui/Figure.svelte';
	import Footnote from '#lib/ui/Footnote.svelte';
	import GameLog from '#lib/ui/GameLog.svelte';
	import GapChip from '#lib/ui/GapChip.svelte';
	import LineList from '#lib/ui/LineList.svelte';
	import Label from '#lib/ui/Label.svelte';
	import OutcomeBar from '#lib/ui/OutcomeBar.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Table from '#lib/ui/Table.svelte';
	import TierMates from '#lib/ui/TierMates.svelte';
	import { heatFor } from '#lib/ui/heat.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const page = $derived(data.page);
	/** His figures lead with the context's format when the run carries it (the league's). */
	const lead = $derived(contextLine(page.lines) ?? page);
	const n = $derived(lead.numbers);
	const season = $derived(data.run.season);
	const unit = $derived(lead.format.unit);
	const scoring = $derived(lead.format.label);
	const figures = $derived(apiFormatOf(lead.format));
	/** The league's line. */
	const note = $derived(siteContext.notes?.lineFor(figures, 'These figures are') ?? null);
	/** Whose roster he is on in the league, once the rosters are read: the free-agent read in one
	 * glance. */
	const rostered = $derived(siteContext.held?.holder(page.id) ?? null);
	/** The league the card reads in, null with none selected. */
	const league = $derived<CardLeague | null>(
		siteContext.league ? { id: siteContext.league.id, host: siteContext.league.host } : null
	);

	/** The week's read (Lane 66h): null until it answers, failed when it cannot. */
	let live = $state<LiveCard | null>(null);
	/** The tier box's and the every-format table's clock (live-figures.ts), loaded with the read: the
	 * run's figures before an answer need none of it (the player page's script budget). */
	let figuresAt = $state<typeof import('#lib/player/live-figures.ts') | null>(null);
	let failed = $state(false);
	let ready = $state(false);
	let comparing = $state(false);
	/** Compare's table, loaded the first time it opens (an await block would put Svelte's await
	 * runtime in every page's shared chunk). */
	let Compare = $state<typeof PlayerCompare | null>(null);

	function toggleCompare(): void {
		comparing = !comparing;
		if (comparing && Compare === null)
			void import('#lib/player/PlayerCompare.svelte').then((module) => (Compare = module.default));
	}
	/** The tiles as built: rest of season in the lead format, the week's tiles "--" until read. */
	const built = $derived<CardTile[]>(builtTiles(page, lead));
	/** The week-ahead read as the page shows it: withheld once the card prints another projection. */
	const weekRead = $derived(
		page.weekRead ? shownWeekRead(page.weekRead, live?.projection ?? null) : null
	);
	/** The week's figures over the tiles as built. */
	const tiles = $derived<CardTile[]>(live === null ? built : live.tiles);

	/** Each read's number: only the latest one asked is shown (review M7). */
	let asked = 0;
	/** The league the shown read is for: a switch clears it before the next answers. */
	let readFor: string | null = null;

	async function readLive(at: CardLeague | null): Promise<void> {
		const mine = ++asked;
		const key = at?.id ?? null;
		if (key !== readFor) live = null;
		try {
			const [module, onClock] = await Promise.all([
				import('#lib/player/live.ts'),
				import('#lib/player/live-figures.ts')
			]);
			const tierFormat = apiFormatOf(lead.format);
			const ask =
				tierFormat === null || page.tier.mates.length === 0
					? null
					: {
							ids: page.tier.mates.map((mate) => mate.id),
							next: page.tier.cliff?.nextId ?? null,
							format: tierFormat
						};
			const source = cardSource(page, lead, { label: scoring, season });
			// The page's clock: the card is drawn at the moment its week is read.
			const card = await module.readCard(source, at, ask, () => Date.now());
			if (mine !== asked) return;
			figuresAt = onClock;
			live = card;
			readFor = key;
			failed = false;
		} catch (error: unknown) {
			if (mine !== asked) return;
			// eslint-disable-next-line no-console -- the basis line says the figures could not be read
			console.warn('player card: the week', error);
			// No league's tiles or verb outlive a failed read: the card goes back to its build.
			live = null;
			readFor = null;
			failed = true;
		}
	}

	onMount(() => {
		lazySheet.armOnFirstIntent(window);
		siteContext.wantHeld();
		void siteContext.load().then(() => {
			ready = true;
		});
	});

	/** Read once the context is known, and again when the member switches league. */
	$effect(() => {
		const at = league;
		if (ready) void readLive(at);
	});

	/** What the read will be built from in the lead format, on a page whose written read is not ready:
	 * built with the page (Lane 142). */
	const unwritten = $derived(page.unwritten[lead.format.id] ?? []);
	/** The figures beside our read, each naming its basis. */
	const readPulls = $derived(
		readFigures(page.capsule?.pulls ?? [], {
			label: scoring,
			preseason:
				page.rest === null ? page.numbers.projected : (page.rest.preseason?.points ?? null),
			// The read's rest of season once it answers in the lead's scoring (Lane 86), the run's before.
			rest:
				lead.rest === null || lead.restParts === null
					? null
					: (live?.rest ?? { points: n.projected, from: lead.restParts.from })
		})
	);
	/** His status words as built, said again on the member's clock once the page is live. */
	let liveStatus = $state<LiveStatus | null>(null);
	/** The run's stamp in the member's zone (as the club page says it), loaded after first paint and
	 * only in season on a page with an every-format table: the player page's script budget. */
	let inSeasonRunStamp = $state<string | null>(null);
	onMount(() => {
		if (page.lines.length > 1 && page.format.rosFromWeek !== undefined)
			void import('#lib/player/run-stamp.ts').then((stamp) => {
				inSeasonRunStamp = stamp.memberRunStamp(page.format);
			});
		liveStatusClock(
			page.status !== null,
			() => import('#lib/run/status-view.ts'),
			(said) => {
				liveStatus = said;
			}
		);
	});
	const statusWords = $derived.by(() => {
		const clock = liveStatus;
		const status = page.status;
		if (status === null || clock === null) return status?.words ?? null;
		return clock.words.playerStatusWords(status.status, {
			capture: status.capture,
			restOfSeason: page.format.rosFromWeek !== undefined,
			zone: clock.zone,
			now: clock.now
		});
	});
	const listed = $derived(statusWords?.view ?? null);
	const statusNote = $derived(statusWords?.note ?? null);
	/** On a season-long list: no tier and no gap frame the rank his figure would earn. */
	const heldOut = $derived(page.status?.status.seasonLong === true);
	/** The tier box and the every-format table on one clock (live-figures.ts, re-review N1): the run's
	 * figures until the read answers, then the read's alone. */
	const read = $derived(live === null || figuresAt === null ? null : { card: live, at: figuresAt });
	const mates = $derived(
		(read === null ? page.tier.mates : read.at.matesAt(page.tier.mates, read.card.tier)).map(
			(mate) => ({ ...mate, href: links.player(mate.slug) })
		)
	);
	const tierCliff = $derived(
		read === null ? page.tier.cliff : read.at.cliffAt(page.tier.cliff, read.card.tier)
	);
	const lineFigures = (
		line: (typeof page.lines)[number]
	): { points: number | null; vor: number | null } => {
		const run = { points: line.numbers.projected, vor: line.numbers.vor };
		return read === null
			? run
			: read.at.lineFiguresAt(run, apiFormatOf(line.format), read.card.formats);
	};
	/** The every-format table's ranks on the figures' own clock (review H1): the run's until the read
	 * answers, then the read's in each format only when its figures stand (Lane 234), the formats it
	 * does not place said once under the table. */
	const lineRanks = $derived(
		read === null
			? null
			: read.at.lineRanksAt(
					page.lines.map((line) => ({
						run: line.numbers.positionRank,
						format: apiFormatOf(line.format),
						label: line.format.label
					})),
					read.card.formats,
					{ format: figures, positionRank: read.card.positionRank },
					listed !== null
				)
	);
	const rankText = (i: number): string => {
		const rank = lineRanks === null ? page.lines[i]?.numbers.positionRank : lineRanks.ranks[i];
		return rank === null || rank === undefined ? EMPTY_FIGURE : `${page.position} ${String(rank)}`;
	};
	/** The week tile's head as drawn ("Wk 6"), which the unread basis names. */
	const weekTileHead = $derived(tiles.find((tile) => tile.key === 'proj')?.label ?? CARD.proj);
	/** The run's stamp while the every-format table shows the run's ranks and figures in season
	 * (Lane 234, ruling 2): on game day the run and the read share a date, so its time says the clock. */
	const runStamp = $derived(live?.formats == null ? inSeasonRunStamp : null);
	/** Every number's basis, once: the week's, the rest of season's, the season's. */
	const basis = $derived([
		...(live === null
			? [unreadBasis(failed, weekTileHead, page.status?.words.view.rank ?? null)]
			: live.basis),
		...(runStamp === null ? [] : [runStamp]),
		...(page.season.basis === null ? [] : [page.season.basis])
	]);
</script>

<!-- His season so far as a box score: once the run is past the season's first kickoff it leads the
     draft facts, before it they lead. -->
{#snippet thisSeason()}
	<section class="season" id={SEASON_ANCHOR} aria-label={PLAYER_PAGE.thisSeason}>
		<PanelHead title={PLAYER_PAGE.thisSeason} aside={page.season.aside} level={2} />
		<GameLog
			caption="{page.name} week by week, {page.season.season}"
			heads={page.season.heads}
			projHead={{ short: CARD.proj, full: "the week's projection" }}
			pointsHead={page.season.pointsHead}
			pastProj={EMPTY_FIGURE}
			line={page.season.line}
			rows={page.season.rows}
			next={live?.next ?? null}
			ahead={page.season.ahead.filter((week) => week.week !== live?.next?.week)}
			none={page.season.none}
			prior={page.season.prior}
			priorLabel={CARD.earlierSeasons}
		/>
	</section>
{/snippet}

<SiteShell title={page.name} head={page.head} run={data.run}>
	<main class="player">
		<Crumb
			trail={[
				{ label: 'Board', href: links.board(lead.format.id) },
				{ label: page.position, href: links.board(lead.format.id, page.position) },
				{ label: page.name }
			]}
		/>

		<PlayerCard
			name={page.name}
			headshot={page.headshot}
			team={page.team}
			club={isFreeAgent(page.team) ? null : { name: page.clubName, href: links.club(page.team) }}
			position={page.position}
			status={listed}
			positionRank={live?.positionRank ?? n.positionRank}
			holder={rostered}
			holdRoom={league !== null}
			next={live === null ? page.card.next : live.head}
			cell={live?.cell ?? null}
			verb={live?.verb ?? null}
			{tiles}
			basisTiles={live?.basisTiles ?? lead.basisTiles}
			compareLeads={live?.compareLeads ?? compareLeadsWithoutVerb(lead.restParts)}
			{comparing}
			oncompare={toggleCompare}
		>
			{#snippet sheet()}<SheetAdd
					player={{
						id: page.id,
						name: page.name,
						position: page.position,
						team: page.team,
						headshot: page.headshot
					}}
					fill
				/>{/snippet}
		</PlayerCard>
		{#if page.clubNote}<Footnote>{page.clubNote}</Footnote>{/if}
		{#if statusNote}<Footnote>{statusNote}</Footnote>{/if}
		<div class="league-lines">
			<ContextNote note={note?.text ?? null} link={note?.link ?? null} />
		</div>

		{#if comparing && Compare}
			<Compare
				self={{ id: page.id, name: page.name, team: page.team, headshot: page.headshot, tiles }}
				{league}
				format={lead.format.id}
			/>
		{/if}

		{#if page.underway}{@render thisSeason()}{/if}

		{#if !page.underway}
			<section class="facts" aria-label="His numbers">
				<Fact label={lead.words.draftersLabel}>
					{#snippet value()}
						<Figure value={lead.words.draftersFigure} />
						{#if !lead.rest && !heldOut}<GapChip adp={n.adp} gap={n.gap} />{/if}
					{/snippet}
					{lead.words.drafters}
				</Fact>
				<Fact label={PLAYER_PAGE.overReplacement} heat={heatFor(n.vor, n.vorRound)}>
					{#snippet value()}<Figure value={signed(n.vor)} /><span>{unit}</span>{/snippet}
					{lead.words.value}
				</Fact>
				{#if n.floor !== null && n.median !== null && n.ceiling !== null}
					<Fact label={PLAYER_PAGE.outcomes}>
						{#snippet value()}
							<span class="bar"
								><OutcomeBar
									floor={n.floor ?? 0}
									median={n.median ?? 0}
									ceiling={n.ceiling ?? 0}
								/></span
							>
						{/snippet}
						{PLAYER_PAGE.outcomesCaption(season, scoring)}
					</Fact>
				{/if}
			</section>
			{@render thisSeason()}
		{/if}

		<div class="split">
			<article class="read">
				<h3><Label>{CARD.ourRead}</Label></h3>
				{#if weekRead}
					<section
						class="week-read"
						aria-label={page.weekRead ? weekReadLabel(page.weekRead) : null}
					>
						{#if weekRead.withheld}
							<p class="unwritten">{weekRead.words}</p>
						{:else}
							<Capsule body={weekRead.body} byline={weekRead.caption} week pulls={[]} />
						{/if}
					</section>
				{/if}
				<!-- In season the read is one paragraph, the week's (Lane 100, B44): the season read and its
				     drafted-for numbers are the draft's, shown before the first kickoff only. -->
				{#if page.underway}
					{#if !weekRead}<p class="unwritten">
							{noReadWords(live?.projection.state ?? null, page.weekReadsDue)}
						</p>{/if}
				{:else if page.capsule}
					<Capsule body={page.capsule.body} byline={page.card.readStamp} pulls={readPulls} />
				{:else}
					<p class="unwritten">{UNWRITTEN_READ}</p>
					<LineList lines={unwritten} label="What our read of {page.name} will be built from" />
				{/if}
			</article>
			<aside class="side">
				<div aria-label={CARD.tier}>
					<!-- In season the box is titled by what it holds, his tier (Lane 139, C23). -->
					{#if page.underway}<h3 class="why"><Label>{CARD.tier}</Label></h3>{/if}
					{#if page.heldTier !== null}
						<PanelHead title={page.heldTier} />
					{:else}
						<TierMates
							tier={page.tier.tier}
							group={POSITION_NAMES[page.position]}
							{mates}
							currentId={page.id}
							cliff={tierCliff}
							unit={page.format.unit}
							basis={live?.tier?.basis ?? page.tierBasis}
						/>
					{/if}
				</div>
			</aside>
		</div>

		{#if page.lines.length > 1}
			<section aria-label="Every format">
				<Table
					caption="{page.name} in every format"
					showCaption
					columns={[
						{ label: PLAYER_PAGE.format },
						{ label: FORMATS_RANK.head, align: 'end' },
						{ label: live?.formats?.head ?? page.pointsHead, align: 'end' },
						{ label: PLAYER_PAGE.overReplacement, align: 'end' },
						{ label: PLAYER_PAGE.tier, align: 'end' }
					]}
				>
					{#each page.lines as line, i (line.format.id)}
						{@const figures = lineFigures(line)}
						<tr>
							<td><a href={links.board(line.format.id, page.position)}>{line.tableLabel}</a></td>
							<td class="num">{listed?.rank ?? rankText(i)}</td>
							<td class="num">{figures.points === null ? EMPTY_FIGURE : fixed(figures.points)}</td>
							<td class="num">{figures.vor === null ? EMPTY_FIGURE : signed(figures.vor)}</td>
							<td class="num">{listed?.rank ?? line.numbers.tier}</td>
						</tr>
					{/each}
				</Table>
				{#if page.formatsNote}<Footnote>{page.formatsNote}</Footnote>{/if}
				{#if lineRanks !== null && lineRanks.unranked.length > 0}<Footnote
						>{FORMATS_RANK.unranked(lineRanks.unranked, lineRanks.reason)}</Footnote
					>{/if}
			</section>
		{/if}

		<div class="basis">
			{#each basis as line (line)}<p>{line}</p>{/each}
		</div>
		<Credit />
	</main>
</SiteShell>

<style>
	/* The league's line; with no league selected it takes no place. */
	.league-lines {
		display: flex;
		flex-direction: column;
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
		margin: 0 0 var(--s-1);
	}

	/* The week-ahead read above the season's, ruled off from it. */
	.week-read {
		margin-bottom: var(--s-4);
		padding-bottom: var(--s-2);
		border-bottom: 1px solid var(--line);
	}

	.side {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
	}

	/* The tier box's title in season: what the box holds. */
	.why {
		margin: 0 0 var(--s-2);
		line-height: 1;
	}

	.unwritten {
		margin: 0 0 var(--s-3);
		color: var(--ink-2);
		font-size: var(--t-md);
	}

	.basis {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-width: 1000px;
	}

	.basis p {
		margin: 0;
		font-size: var(--t-sm);
		line-height: 1.5;
		color: var(--ink-3);
	}

	@media (max-width: 1080px) {
		.split {
			grid-template-columns: minmax(0, 1fr);
		}

		.facts {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (max-width: 760px) {
		/* The room for the verb pinned above the tab bar is the site footer's (data-pin, Lane 151). */
		.player {
			padding: var(--s-4);
			gap: var(--s-4);
		}

		.basis p {
			font-size: var(--t-xs);
		}
	}
</style>
