package app.trycommish.core.reference

import app.trycommish.api.models.RunAdpSource
import app.trycommish.api.models.RunBoardAnswer
import app.trycommish.api.models.RunBoardRow
import app.trycommish.api.models.RunClub
import app.trycommish.api.models.RunDesignations
import app.trycommish.api.models.RunFormat
import app.trycommish.api.models.RunManifestAnswer
import app.trycommish.api.models.RunPlayerStatus
import app.trycommish.api.models.RunSchedule
import app.trycommish.core.Format
import app.trycommish.core.SessionEnd
import app.trycommish.core.board.BoardBasis
import app.trycommish.core.board.BoardCells
import app.trycommish.core.board.BoardColumns
import app.trycommish.core.board.BoardOrder
import app.trycommish.core.board.BoardPosition
import app.trycommish.core.board.BoardRow
import app.trycommish.core.board.BoardWords
import app.trycommish.core.board.Byes
import app.trycommish.core.board.PageVerb
import app.trycommish.core.board.RunReadFailure
import app.trycommish.core.board.RunWords
import app.trycommish.core.board.placed
import app.trycommish.core.instantOrNull
import app.trycommish.core.liveorder.LiveOrder
import app.trycommish.core.liveorder.LiveOrderWords
import app.trycommish.core.liveorder.LivePlace
import app.trycommish.core.liveorder.OrderAtClock
import app.trycommish.core.liveorder.OrderReader
import app.trycommish.core.liveorder.PlacedFigures
import app.trycommish.core.player.Read
import app.trycommish.core.player.ReadStamp
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.design.Words
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import java.time.Instant
import java.time.ZoneId

/** A club's lead player on the clubs index (PlayerLine.svelte with its Our rank label). */
data class ClubLead(
    val name: String,
    val initials: String,
    val headshot: String?,
    /** "TE 1". */
    val pill: String,
    /** "Our rank 12". */
    val rank: String,
    val sheetPlayer: SheetPlayer,
)

/** A club on the clubs index (the web's Tile): its name, its line, its strength, its lead player and how
 * many of its players our board ranks. */
data class ClubCard(
    val abbr: String,
    val name: String,
    /** "ARI · Bye week 14", "KC" once its bye is played. */
    val meta: String,
    val strength: StrengthFigure?,
    val lead: ClubLead?,
    /** "15 players on our board". */
    val players: String,
)

/** The clubs index as the web's /clubs says it (server/pages/clubs.ts clubsPage, schedule-view.ts
 * clubCards): its lead with the strength's sentence, then every club's card in the run's order. In season
 * each card's lead is the first of its club's first three on the board at the order's clock, once the
 * order places every club's three (Lane 226, placedLeads), and the basis under the cards says which clock
 * they are on. */
data class ClubsModel(
    val title: String,
    val stamp: String,
    val lead: String,
    val clubs: List<ClubCard>,
    /** The link to the strength of schedule, as the web's pages link it. */
    val scheduleLink: String,
    /** In season the order's lead or the run's stamp, said once under the cards; none before. */
    val basis: List<String> = emptyList(),
    /** Whether the leads are the order's. */
    val atClock: Boolean = false,
)

/** A club page's verb: its words and the two players it compares, by id and by slug. */
data class ClubCompare(
    val label: String,
    val ids: List<String>,
    val slugs: List<String>,
)

/** A club's page as the web's /clubs/[abbr] says it at 390: the hero (its name, line, strength and rank),
 * the basis once, its players on the default board in the board's order with the round tint and the Gap
 * where drawn, its kickers and defense in draft order, its schedule with the games played set back, and
 * the verb that sets its two best available players side by side. In season its players carry the order's
 * figures in the order's order once the order places every one of them, the head says the order, and the
 * order's lead takes the board sentence's place in the basis; until then the run's rows stand with the
 * run's stamp (Lane 226). */
data class ClubPageModel(
    val abbr: String,
    val name: String,
    val meta: String,
    val stamp: String,
    val hero: ClubHero?,
    val basis: List<String>,
    /** "On our PPR board" while the rows are the run's, "On our rest-of-season order" once they are the
     * order's: the head names what the basis beside it names (reference-words.ts CLUB_PAGE.onBoard and
     * CLUB_ORDER.onOrder, Lane 223's D2). */
    val boardHead: String,
    /** The section's spoken label after the head, as the web's table label: "Cincinnati Bengals, On our PPR board". */
    val boardLabel: String,
    /** "Nobody from Arizona is on this board", null where the board has some. */
    val nobody: String?,
    val columns: BoardColumns,
    val rows: List<BoardRow>,
    val marketHead: String,
    val market: List<BoardRow>,
    val scheduleCaption: String,
    val scheduleHeads: List<String>,
    val games: List<ClubGame>,
    /** "Week 6's games as of Wed Oct 21, 7:00 am Central.", under the schedule; null without a current week. */
    val asOf: String?,
    /** Null with fewer than two available players. */
    val compare: ClubCompare?,
    val clubsLink: String,
    /** Whether the rows are the order's. */
    val atClock: Boolean = false,
)

/** The strength of schedule screen: its heading, the run's stamp, the grid, its legend and the verb. */
data class ScheduleModel(
    val heading: String,
    val stamp: String,
    val caption: String,
    val grid: ScheduleGridModel,
    /** "10.5 or more": the shaded cells' legend. */
    val legendHard: String,
    val legendPlayed: String,
    val verb: PageVerb,
)

/** "On our PPR board", "Nobody from Arizona is on this board": a word with its one name filled
 * (reference-words.ts filled). */
fun filled(
    words: String,
    name: String,
): String = words.replaceFirst(Regex("\\{[a-z]+\\}"), Regex.escapeReplacement(name))

/** The run's files the club screens are built from: the manifest, the clubs, the schedule, the default
 * board and the capture, and where the season is. */
class ClubFiles(
    val manifest: RunManifestAnswer,
    val clubs: List<RunClub>,
    val schedule: RunSchedule,
    val board: RunBoardAnswer,
    val capture: RunDesignations?,
    val sources: List<RunAdpSource>?,
    val underway: Boolean,
    /** What the schedule sets back as played. */
    val played: Reach,
    val reads: List<ReadStamp>,
) {
    val format: RunFormat
        get() = manifest.manifest.formats.firstOrNull { it.id == board.format } ?: manifest.manifest.formats.first()

    val statuses: Map<String, RunPlayerStatus> get() = capture?.players.orEmpty()

    /** A club's rows share its bye, said once in its hero, so no row carries one. */
    internal fun cells(zone: ZoneId): BoardCells = BoardCells(statuses, emptyMap(), format.rosFromWeek, zone)

    /** reference-words.ts clubMeta: "ARI · Bye week 14" while the bye is ahead of the week the board ranks
     * from, the code alone once it is played (Lane 223, B190), "ARI · Bye week not set" where the run names
     * none. */
    fun meta(club: RunClub): String {
        val bye = club.bye ?: return "${club.abbr} · ${Words.Bye.notSet}"
        return Byes.line(bye, format.rosFromWeek)?.let { "${club.abbr} · $it" } ?: club.abbr
    }

    /** The current week's game states as the run read them, said in `zone`. */
    fun states(zone: ZoneId): StatedWeek =
        StatedWeek.of(schedule.slates.flatMap { it.games }, played, underway, manifest.manifest.runAt, zone)

    fun captureWords(
        now: Instant,
        zone: ZoneId,
    ): String? = capture?.let { BoardWords.capture(instantOrNull(it.readAt) ?: now, instantOrNull(it.checkedAt), now, zone) }

    /** The order's places when the run ranks the rest of the season and the order is in the board's
     * scoring; null before the season, while unread, or in another scoring. */
    fun places(order: OrderAtClock?): Map<String, LivePlace>? =
        order?.takeIf { format.rosFromWeek != null && LiveOrder.inScoring(it.answer, format) }?.places

    /** A page's basis on its clock: the order's lead in the board sentence's place once its rows stand,
     * else in season the run's stamp after the whole basis. */
    fun basis(
        run: List<String>,
        order: OrderAtClock?,
        atClock: Boolean,
        zone: ZoneId,
    ): List<String> {
        if (format.rosFromWeek == null) return run
        return LiveOrder.basis(
            run,
            BoardBasis.ourBoard(format, manifest.manifest.season),
            order?.takeIf { atClock }?.lead(format.teams, zone),
            LiveOrderWords.runStamp(format, zone),
        )
    }

    companion object {
        /** The default format's files; the ADP's sources where the screen says the board's basis; and in
         * season the run's complete week from an own page, for the games played. */
        suspend fun read(
            reads: ReferenceReads,
            sources: Boolean,
        ): ClubFiles =
            coroutineScope {
                val manifest = reads.manifest()
                val format =
                    manifest.value.manifest.formats
                        .firstOrNull()
                        ?.id ?: throw RunReadFailure.NoFormat()
                val clubs = async { reads.clubs() }
                val schedule = async { reads.schedule() }
                val board = async { reads.board(format, manifest.value) }
                val capture = async { reads.designations() }
                val adp: Read<List<RunAdpSource>>? = if (sources) reads.sources() else null
                val scheduleRead = schedule.await()
                val underway = SeasonReach.underway(manifest.value.manifest, scheduleRead.value)
                val stamps = mutableListOf(manifest.at, clubs.await().at, scheduleRead.at, board.await().at)
                stamps += listOfNotNull(capture.await()?.at, adp?.at)
                var played = Reach.NONE
                if (underway) {
                    val index = reads.index()
                    val (complete, completeReads) = reads.complete(index.value, manifest.value)
                    stamps += listOf(index.at) + completeReads
                    played = SeasonReach.played(scheduleRead.value.slates, complete ?: 0, underway = true)
                }
                ClubFiles(
                    manifest.value,
                    clubs.await().value,
                    scheduleRead.value,
                    board.await().value,
                    capture.await()?.value,
                    adp?.value,
                    underway,
                    played,
                    stamps,
                )
            }
    }
}

/** A club's first players on the board, its card's lead's pool at the order's clock (server/pages/clubs.ts
 * CLUB_LEAD_POOL). */
private const val LEAD_POOL = 3

/** Each club's lead with his figures and whether they are the order's: the first of its rows on no
 * season-long list, whose rank assumes he plays (held-places.ts leadOf), the run's; at the order's clock
 * the first of its pool so placed, with the order's figures, when the order places every club's pool
 * (placedLeads), else every lead the run's. */
private fun clubLeads(
    files: ClubFiles,
    ordered: List<RunBoardRow>,
    places: Map<String, LivePlace>?,
): Pair<Map<String, Pair<RunBoardRow, PlacedFigures>>, Boolean> {
    val available = { row: RunBoardRow -> !BoardOrder.heldOut(row.id, files.statuses) }
    val run =
        files.clubs
            .mapNotNull { club ->
                ordered.firstOrNull { it.team == club.abbr && available(it) }?.let {
                    club.abbr to
                        (it to PlacedFigures.of(it))
                }
            }.toMap()
    if (places == null) return run to false
    val placed =
        files.clubs.filter { it.abbr in run }.mapNotNull { club ->
            val pool = ordered.filter { it.team == club.abbr }.take(LEAD_POOL)
            val pooled = LiveOrder.placed(pool, { it.id }, places) ?: return run to false
            pooled.firstOrNull { available(it.row) }?.let {
                club.abbr to
                    (it.row to PlacedFigures.of(it.row).at(it.place, files.format.teams))
            }
        }
    return placed.toMap() to true
}

/** The clubs index's model from its files; `order` the order at the screen's clock, null while unread. */
fun clubsModel(
    files: ClubFiles,
    zone: ZoneId,
    order: OrderAtClock? = null,
): ClubsModel {
    val format = files.format
    val ordered = BoardOrder.withStatuses(files.board.rows.map { it.placed() }, files.statuses).map { it.row }
    val views = ScheduleViews.views(files.schedule, files.underway)
    val first = files.clubs.firstNotNullOfOrNull { views[it.abbr] }
    val cells = files.cells(zone)
    val (leads, atClock) = clubLeads(files, ordered, files.places(order))
    return ClubsModel(
        title = Words.ClubPage.clubs,
        stamp = RunWords.stamp(files.manifest.manifest),
        lead = StrengthWords.clubsLead(format.label, first),
        scheduleLink = Words.AdpPage.scheduleLink,
        basis = files.basis(emptyList(), order, atClock, zone),
        atClock = atClock,
        clubs =
            files.clubs.map { club ->
                val own = ordered.filter { it.team == club.abbr }
                val lead =
                    leads[club.abbr]?.let { (row, figures) ->
                        val drawn = cells.ranked(row, figures)
                        ClubLead(
                            name = row.name,
                            initials = drawn.initials,
                            headshot = drawn.headshot,
                            pill = "${row.position.value} ${figures.positionRank}",
                            rank = "${Words.ClubPage.ourRank} ${figures.ourRank}",
                            sheetPlayer =
                                drawn.sheetPlayer ?: SheetPlayer(row.id, row.slug, row.name, row.position.value, null, row.team, null),
                        )
                    }
                ClubCard(
                    abbr = club.abbr,
                    name = "${club.city} ${club.nickname}",
                    meta = files.meta(club),
                    strength = ScheduleViews.figure(views[club.abbr], views.size),
                    lead = lead,
                    players = "${Format.plural(own.size, Words.ClubPage.player, "${Words.ClubPage.player}s")} ${Words.ClubPage.onOurBoard}",
                )
            },
    )
}

/** A club's page by its abbreviation in any case ("ari"), null for a club the run does not carry; `order`
 * the order at the screen's clock, its rows the order's when it places every one. */
fun clubPageModel(
    files: ClubFiles,
    abbr: String,
    now: Instant,
    zone: ZoneId,
    order: OrderAtClock? = null,
): ClubPageModel? {
    val club = files.clubs.firstOrNull { it.abbr.equals(abbr, ignoreCase = true) } ?: return null
    val format = files.format
    val cells = files.cells(zone)
    val run = BoardOrder.withStatuses(files.board.rows.map { it.placed() }, files.statuses).map { it.row }.filter { it.team == club.abbr }
    val placed = files.places(order)?.let { places -> LiveOrder.placed(run, { it.id }, places) }
    val shown = placed?.map { it.row to PlacedFigures.of(it.row).at(it.place, format.teams) } ?: run.map { it to PlacedFigures.of(it) }
    val own = shown.map { it.first }
    val atClock = placed != null
    val market =
        listOf(BoardPosition.Kicker, BoardPosition.Defense).flatMap { position ->
            BoardOrder
                .withStatuses(BoardOrder.at(files.board.market.map { it.placed() }, position), files.statuses)
                .map { it.row }
                .filter { it.team == club.abbr }
        }
    val gap = format.rosFromWeek == null && shown.any { it.second.gap != null }
    val scheduled = ScheduleViews.club(club, files.schedule, files.clubs, files.played, files.underway, files.states(zone))
    val pair = own.filter { !BoardOrder.heldOut(it.id, files.statuses) }.take(2)
    val head = if (atClock) Words.ClubOrder.onOrder else filled(Words.ClubPage.onBoard, format.label)
    val name = "${club.city} ${club.nickname}"
    return ClubPageModel(
        abbr = club.abbr,
        name = name,
        meta = files.meta(club),
        stamp = RunWords.stamp(files.manifest.manifest),
        hero = scheduled.hero,
        basis =
            files.basis(
                listOf(StrengthWords.winsBasis(files.schedule.opponentBasis)) +
                    BoardBasis.ranked(format, files.manifest.manifest.season, null, files.sources.orEmpty(), gap) +
                    listOfNotNull(files.captureWords(now, zone)),
                order,
                atClock,
                zone,
            ),
        boardHead = head,
        boardLabel = "$name, $head",
        nobody = if (own.isEmpty()) filled(if (atClock) Words.ClubOrder.nobody else Words.ClubPage.nobody, club.city) else null,
        columns = BoardColumns.Ranked(gap),
        rows = shown.map { (row, figures) -> cells.ranked(row, figures) },
        marketHead = Words.ClubPage.kickers,
        market = market.map { cells.market(it) },
        scheduleCaption = scheduled.caption,
        scheduleHeads = listOf(Words.ClubPage.week, Words.ClubPage.opponent, Words.ClubPage.expectedWins),
        games = scheduled.games,
        asOf = scheduled.asOf,
        compare = if (pair.size == 2) ClubCompare(Words.ClubPage.comparePair, pair.map { it.id }, pair.map { it.slug }) else null,
        clubsLink = Words.ClubPage.clubs,
        atClock = atClock,
    )
}

/** The schedule screen's model from its files. */
fun scheduleModel(
    files: ClubFiles,
    zone: ZoneId,
): ScheduleModel {
    val schedule = files.schedule
    val grid = ScheduleViews.grid(schedule, files.clubs, files.board.rows, files.played, files.underway, files.states(zone))
    val floor = ScheduleViews.strongFloor(schedule.opponentValues.values).floor
    return ScheduleModel(
        heading = "${schedule.season} ${Words.SchedulePage.heading}",
        stamp = RunWords.stamp(files.manifest.manifest),
        caption = if (grid.strengthLabel == null) Words.SchedulePage.caption else Words.SchedulePage.captionHardest,
        grid = grid,
        legendHard = filled(Words.SchedulePage.legendHard, Format.fixed(floor)),
        legendPlayed = Words.SchedulePage.legendPlayed,
        verb = PageVerb.Mock,
    )
}

/** A club the run does not carry. */
class UnknownClub(
    abbr: String,
) : Exception("The run carries no club $abbr.")

/** The club screens' view models. */
object ClubScreens {
    /** `orders` reads the order in season, the leads drawn again at its clock: every club's first three,
     * the order's first rows, which a club's leads are among. */
    fun clubs(
        reads: ReferenceReads,
        zone: ZoneId,
        sessionEnd: SessionEnd,
        orders: OrderReader? = null,
    ): RunScreenViewModel<ClubsModel> =
        RunScreenViewModel(reads, zone, sessionEnd, orders) { r ->
            val files = ClubFiles.read(r, sources = false)
            Built(clubsModel(files, zone), files.manifest.manifest, files.reads) { reader ->
                reader
                    .takeIf { files.format.rosFromWeek != null }
                    ?.readOrNull()
                    ?.let { clubsModel(files, zone, it) }
                    ?.takeIf { it.atClock }
            }
        }

    /** `orders` reads the order in season, every player of the club read by its name as the web's club
     * page reads him, the page drawn again at its clock. */
    fun club(
        abbr: String,
        reads: ReferenceReads,
        zone: ZoneId,
        sessionEnd: SessionEnd,
        orders: OrderReader? = null,
    ): RunScreenViewModel<ClubPageModel> =
        RunScreenViewModel(reads, zone, sessionEnd, orders) { r ->
            val files = ClubFiles.read(r, sources = true)
            val now = r.clock.now()
            val model = clubPageModel(files, abbr, now, zone) ?: throw UnknownClub(abbr)
            Built(model, files.manifest.manifest, files.reads) { reader ->
                reader
                    .takeIf {
                        files.format.rosFromWeek != null
                    }?.readOrNull(search = model.abbr)
                    ?.let { clubPageModel(files, abbr, now, zone, it) }
                    ?.takeIf { it.atClock }
            }
        }

    fun schedule(
        reads: ReferenceReads,
        zone: ZoneId,
        sessionEnd: SessionEnd,
    ): RunScreenViewModel<ScheduleModel> =
        RunScreenViewModel(reads, zone, sessionEnd, null) { r ->
            val files = ClubFiles.read(r, sources = false)
            Built(scheduleModel(files, zone), files.manifest.manifest, files.reads)
        }
}
