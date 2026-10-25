package app.trycommish.core.player

import app.trycommish.api.models.RunFormat
import app.trycommish.api.models.RunGame
import app.trycommish.api.models.RunGameLogRow
import app.trycommish.api.models.RunGameState
import app.trycommish.api.models.RunGameStatus
import app.trycommish.api.models.RunPlayer
import app.trycommish.api.models.RunPriorSeason
import app.trycommish.api.models.RunSeason
import app.trycommish.api.models.RunSlate
import app.trycommish.core.Format
import app.trycommish.core.board.RunWords
import app.trycommish.core.instantOrNull
import app.trycommish.design.Words
import kotlin.math.floor
import kotlin.math.max

/** His "This season" block (web/src/lib/server/pages/player-season.ts SeasonView): the head's aside, the
 * log's heads, the season line, the weeks so far, the weeks still to play with their days, the one
 * sentence with no line, the box's basis and his earlier seasons. Held to the parity's pages. */
data class SeasonView(
    val season: Int,
    val aside: String,
    val heads: List<Head>,
    val pointsHead: Head,
    val line: Line?,
    val rows: List<Row>,
    val ahead: List<Ahead>,
    val none: String,
    val basis: String?,
    val prior: List<Prior>,
) {
    data class Head(
        val short: String,
        val full: String,
    )

    data class Cell(
        val value: String,
        val caption: String,
    )

    data class Line(
        val lead: String,
        val sub: String,
        val total: String,
        val points: Cell,
        val cells: List<Cell>,
    )

    enum class Tone(
        val id: String,
    ) {
        Played("played"),
        Bye("bye"),
        Quiet("quiet"),
    }

    data class Row(
        val week: Int,
        val opponent: String,
        val note: String,
        val tone: Tone,
        val points: String?,
        val cells: List<String>?,
    )

    data class Ahead(
        val week: Int,
        val opponent: String,
        val bye: Boolean,
        val day: String,
    )

    data class Prior(
        val season: Int,
        val sub: String,
        val total: String,
        val cells: List<String>,
    )
}

internal object SeasonViews {
    /** The season log's words (run/season-log-words.ts SEASON_LOG_WORDS). */
    private const val DID_NOT_PLAY = "Did not play"
    private const val PLAYED_NO_STATS = "Played, no stats"
    private const val SPECIAL_TEAMS = "Special teams only"
    private const val TENTHS = 10.0
    private const val HALF = 0.5

    /** player-season.ts seasonView. */
    fun view(
        player: RunPlayer,
        formats: List<RunFormat>,
        slates: List<RunSlate>,
    ): SeasonView? {
        val season = player.season
        val format = formats.firstOrNull { it.id == season.format } ?: return null
        val position = player.position.value
        val columns = StatColumns.of(position)
        val first = season.log.indexOfFirst { it.status == RunGameStatus.upcoming }.let { if (it < 0) season.log.size else it }
        val through = countedWeek(season)
        val special = player.lastGameClub?.takeIf { it.specialTeams == true }?.week
        val byClub = slates.groupBy { it.abbr }.mapValues { it.value.first() }
        return SeasonView(
            season = season.season,
            aside = "${season.season}, ${format.label}${if (through == 0) "" else ", through week $through"}",
            heads = columns.map { SeasonView.Head(it.short, it.full) },
            pointsHead = SeasonView.Head(Words.Box.pts, "${format.label} points"),
            line = line(season, columns, format),
            rows =
                season.log
                    .subList(0, first)
                    .filterNot { unnamedAhead(it, season.through) }
                    .map { row(it, columns, special) },
            ahead = season.log.subList(first, season.log.size).map { ahead(it, byClub, player.team) },
            none =
                if (season.through == 0) {
                    "The ${season.season} season has not reached its first week."
                } else {
                    "He has no ${season.season} stats through week ${season.through}."
                },
            basis =
                if (season.games > 0 && position == "QB" && season.totals.completions == null) {
                    "Completions are not in our records yet."
                } else {
                    null
                },
            prior = player.priorSeasons.orEmpty().map { prior(it, columns) },
        )
    }

    /** reach.ts countedWeek: the run's through week, or his own later game already in the records. */
    fun countedWeek(season: RunSeason): Int =
        season.log.fold(season.through) { week, row ->
            val holds =
                row.status == RunGameStatus.played ||
                    (row.status == RunGameStatus.inactive && (row.opponent != null || row.unnamedGame == true))
            if (holds) max(week, row.week) else week
        }

    private fun opponent(row: RunGameLogRow): String {
        if (row.status == RunGameStatus.bye) return Words.Box.bye
        val opponent = row.opponent ?: return if (row.unnamedGame == true) PLAYED_NO_STATS else DID_NOT_PLAY
        return "${if (row.home == true) "vs" else "at"} $opponent"
    }

    private fun row(
        row: RunGameLogRow,
        columns: List<StatColumn>,
        specialTeams: Int?,
    ): SeasonView.Row {
        val points = if (row.status == RunGameStatus.played) row.points?.toDouble() else null
        val note =
            when {
                row.status != RunGameStatus.inactive || row.opponent == null -> ""
                row.week == specialTeams -> SPECIAL_TEAMS
                else -> DID_NOT_PLAY
            }
        val tone =
            when {
                points != null -> SeasonView.Tone.Played
                row.status == RunGameStatus.bye -> SeasonView.Tone.Bye
                else -> SeasonView.Tone.Quiet
            }
        val figures = StatFigures.of(row)
        return SeasonView.Row(
            week = row.week,
            opponent = opponent(row),
            note = note,
            tone = tone,
            points = points?.let { Format.fixed(it) },
            cells = if (points == null) null else columns.map { it.value(figures) },
        )
    }

    /** A week still to play with its day: "Kicked off" or "Final" by the run's state, else its kickoff's day
     * ("Sun Nov 8", Eastern, the run's clock). */
    private fun ahead(
        row: RunGameLogRow,
        slates: Map<String, RunSlate>,
        team: String,
    ): SeasonView.Ahead {
        val bye = row.status == RunGameStatus.bye
        val game = if (bye) null else rowGame(slates, team, row)
        val day =
            when (game?.state) {
                RunGameState.kicked_off -> Words.Box.kickedOff
                RunGameState.`final` -> Words.Box.final
                else -> game?.let { instantOrNull(it.kickoff) }?.let { Format.weekdayDay(it, RunWords.eastern) }.orEmpty()
            }
        return SeasonView.Ahead(row.week, opponent(row), bye, day)
    }

    /** row-game.ts rowGame: his club's game that week when it is the row's, else the slate game whose week,
     * opponent and home are the row's. */
    private fun rowGame(
        slates: Map<String, RunSlate>,
        team: String,
        row: RunGameLogRow,
    ): RunGame? {
        val own = slates[team]?.games?.firstOrNull { it.week == row.week }
        val named = row.opponent ?: return own
        if (own != null && own.opponent == named && own.home == row.home) return own
        return slates.values.firstNotNullOfOrNull { slate ->
            slate.games.firstOrNull { it.week == row.week && it.opponent == named && it.home == row.home }
        }
    }

    private fun unnamedAhead(
        row: RunGameLogRow,
        through: Int,
    ): Boolean = row.week > through && row.status == RunGameStatus.inactive && row.opponent == null && row.unnamedGame != true

    private fun line(
        season: RunSeason,
        columns: List<StatColumn>,
        format: RunFormat,
    ): SeasonView.Line? {
        val perGame = season.pointsPerGame?.toDouble()
        if (season.games <= 0 || perGame == null) return null
        val rate = Format.fixed(perGame, 1)
        val tenths =
            season.log.sumOf { row ->
                val points = row.points?.toDouble()
                if (row.status != RunGameStatus.played || points == null) 0.0 else floor(Format.fixed(points).toDouble() * TENTHS + HALF)
            }
        val totals = StatFigures.of(season.totals)
        return SeasonView.Line(
            lead = "Season",
            sub = "${Format.plural(season.games, "game", "games")}, $rate a game",
            total = Format.fixed(tenths / TENTHS),
            points = SeasonView.Cell(rate, "${format.label} points a game"),
            cells =
                columns.map { column ->
                    val value = column.value(totals)
                    SeasonView.Cell(value, column.caption(value))
                },
        )
    }

    private fun prior(
        prior: RunPriorSeason,
        columns: List<StatColumn>,
    ): SeasonView.Prior {
        val perGame = prior.pointsPerGame?.let { ", ${Format.fixed(it.toDouble(), 1)} a game" }.orEmpty()
        val totals = StatFigures.of(prior.totals)
        return SeasonView.Prior(
            season = prior.season,
            sub = "${Format.plural(prior.games, "game", "games")}$perGame",
            total =
                prior.totals.points
                    ?.let { Format.fixed(it.toDouble()) }
                    .orEmpty(),
            cells = columns.map { it.value(totals) },
        )
    }

    /** player-season.ts heldSeasonView: a page held back with no copy has no line and no log. */
    fun held(
        year: Int,
        position: String,
        format: RunFormat,
    ): SeasonView =
        SeasonView(
            season = year,
            aside = "$year, ${format.label}",
            heads = StatColumns.of(position).map { SeasonView.Head(it.short, it.full) },
            pointsHead = SeasonView.Head(Words.Box.pts, "${format.label} points"),
            line = null,
            rows = emptyList(),
            ahead = emptyList(),
            none = Words.HeldPage.log,
            basis = Words.HeldPage.basis,
            prior = emptyList(),
        )
}
