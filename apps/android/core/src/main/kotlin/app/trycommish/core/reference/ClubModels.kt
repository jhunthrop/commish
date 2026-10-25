package app.trycommish.core.reference

import app.trycommish.api.models.RunAdpSource
import app.trycommish.api.models.RunBoardAnswer
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
import app.trycommish.core.board.PageVerb
import app.trycommish.core.board.RunReadFailure
import app.trycommish.core.board.RunWords
import app.trycommish.core.board.placed
import app.trycommish.core.instantOrNull
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
    /** "ARI · bye week 14". */
    val meta: String,
    val strength: StrengthFigure?,
    val lead: ClubLead?,
    /** "15 players on our board". */
    val players: String,
)

/** The clubs index as the web's /clubs says it (server/pages/clubs.ts clubsPage, schedule-view.ts
 * clubCards): its lead with the strength's sentence, then every club's card in the run's order. */
data class ClubsModel(
    val title: String,
    val stamp: String,
    val lead: String,
    val clubs: List<ClubCard>,
    /** The link to the strength of schedule, as the web's pages link it. */
    val scheduleLink: String,
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
 * the verb that sets its two best available players side by side. */
data class ClubPageModel(
    val abbr: String,
    val name: String,
    val meta: String,
    val stamp: String,
    val hero: ClubHero?,
    val basis: List<String>,
    /** "On our PPR board". */
    val boardHead: String,
    /** "Nobody from Arizona is on this board", null where the board has some. */
    val nobody: String?,
    val columns: BoardColumns,
    val rows: List<BoardRow>,
    val marketHead: String,
    val market: List<BoardRow>,
    val scheduleCaption: String,
    val scheduleHeads: List<String>,
    val games: List<ClubGame>,
    /** Null with fewer than two available players. */
    val compare: ClubCompare?,
    val clubsLink: String,
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

    fun meta(club: RunClub): String = "${club.abbr} · ${Words.ClubPage.byeWeek} ${club.bye?.toString() ?: Words.ClubPage.byeNotSet}"

    fun captureWords(
        now: Instant,
        zone: ZoneId,
    ): String? = capture?.let { BoardWords.capture(instantOrNull(it.readAt) ?: now, instantOrNull(it.checkedAt), now, zone) }

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

/** The clubs index's model from its files. */
fun clubsModel(
    files: ClubFiles,
    zone: ZoneId,
): ClubsModel {
    val format = files.format
    val ordered = BoardOrder.withStatuses(files.board.rows.map { it.placed() }, files.statuses).map { it.row }
    val views = ScheduleViews.views(files.schedule, files.underway)
    val first = files.clubs.firstNotNullOfOrNull { views[it.abbr] }
    val cells = files.cells(zone)
    return ClubsModel(
        title = Words.ClubPage.clubs,
        stamp = RunWords.stamp(files.manifest.manifest),
        lead = StrengthWords.clubsLead(format.label, first),
        scheduleLink = Words.AdpPage.scheduleLink,
        clubs =
            files.clubs.map { club ->
                val own = ordered.filter { it.team == club.abbr }
                // Never a player on a season-long list, whose rank assumes he plays (held-places.ts leadOf).
                val lead =
                    own.firstOrNull { !BoardOrder.heldOut(it.id, files.statuses) }?.let { row ->
                        val drawn = cells.ranked(row)
                        ClubLead(
                            name = row.name,
                            initials = drawn.initials,
                            headshot = drawn.headshot,
                            pill = "${row.position.value} ${row.positionRank}",
                            rank = "${Words.ClubPage.ourRank} ${row.ourRank}",
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

/** A club's page by its abbreviation in any case ("ari"), null for a club the run does not carry. */
fun clubPageModel(
    files: ClubFiles,
    abbr: String,
    now: Instant,
    zone: ZoneId,
): ClubPageModel? {
    val club = files.clubs.firstOrNull { it.abbr.equals(abbr, ignoreCase = true) } ?: return null
    val format = files.format
    val cells = files.cells(zone)
    val own = BoardOrder.withStatuses(files.board.rows.map { it.placed() }, files.statuses).map { it.row }.filter { it.team == club.abbr }
    val market =
        listOf(BoardPosition.Kicker, BoardPosition.Defense).flatMap { position ->
            BoardOrder
                .withStatuses(BoardOrder.at(files.board.market.map { it.placed() }, position), files.statuses)
                .map { it.row }
                .filter { it.team == club.abbr }
        }
    val gap = format.rosFromWeek == null && own.any { it.gap != null }
    val scheduled = ScheduleViews.club(club, files.schedule, files.clubs, files.played, files.underway)
    val pair = own.filter { !BoardOrder.heldOut(it.id, files.statuses) }.take(2)
    return ClubPageModel(
        abbr = club.abbr,
        name = "${club.city} ${club.nickname}",
        meta = files.meta(club),
        stamp = RunWords.stamp(files.manifest.manifest),
        hero = scheduled.hero,
        basis =
            listOf(StrengthWords.winsBasis(files.schedule.opponentBasis)) +
                BoardBasis.ranked(format, files.manifest.manifest.season, null, files.sources.orEmpty(), gap) +
                listOfNotNull(files.captureWords(now, zone)),
        boardHead = filled(Words.ClubPage.onBoard, format.label),
        nobody = if (own.isEmpty()) filled(Words.ClubPage.nobody, club.city) else null,
        columns = BoardColumns.Ranked(gap),
        rows = own.map(cells::ranked),
        marketHead = Words.ClubPage.kickers,
        market = market.map { cells.market(it) },
        scheduleCaption = scheduled.caption,
        scheduleHeads = listOf(Words.ClubPage.week, Words.ClubPage.opponent, Words.ClubPage.expectedWins),
        games = scheduled.games,
        compare = if (pair.size == 2) ClubCompare(Words.ClubPage.comparePair, pair.map { it.id }, pair.map { it.slug }) else null,
        clubsLink = Words.ClubPage.clubs,
    )
}

/** The schedule screen's model from its files. */
fun scheduleModel(files: ClubFiles): ScheduleModel {
    val schedule = files.schedule
    val grid = ScheduleViews.grid(schedule, files.clubs, files.board.rows, files.played, files.underway)
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
    fun clubs(
        reads: ReferenceReads,
        zone: ZoneId,
        sessionEnd: SessionEnd,
    ): RunScreenViewModel<ClubsModel> =
        RunScreenViewModel(reads, zone, sessionEnd) { r ->
            val files = ClubFiles.read(r, sources = false)
            Built(clubsModel(files, zone), files.manifest.manifest, files.reads)
        }

    fun club(
        abbr: String,
        reads: ReferenceReads,
        zone: ZoneId,
        sessionEnd: SessionEnd,
    ): RunScreenViewModel<ClubPageModel> =
        RunScreenViewModel(reads, zone, sessionEnd) { r ->
            val files = ClubFiles.read(r, sources = true)
            val model = clubPageModel(files, abbr, r.clock.now(), zone) ?: throw UnknownClub(abbr)
            Built(model, files.manifest.manifest, files.reads)
        }

    fun schedule(
        reads: ReferenceReads,
        zone: ZoneId,
        sessionEnd: SessionEnd,
    ): RunScreenViewModel<ScheduleModel> =
        RunScreenViewModel(reads, zone, sessionEnd) { r ->
            val files = ClubFiles.read(r, sources = false)
            Built(scheduleModel(files), files.manifest.manifest, files.reads)
        }
}
