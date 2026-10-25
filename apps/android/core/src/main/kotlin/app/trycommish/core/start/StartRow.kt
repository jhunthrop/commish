package app.trycommish.core.start

import app.trycommish.api.models.DesignationStatus
import app.trycommish.api.models.GameRoof
import app.trycommish.api.models.KickoffWeather
import app.trycommish.api.models.PlayerLine
import app.trycommish.api.models.WeekFacts
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import app.trycommish.core.shell.headshotOf
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId
import kotlin.math.floor

/** His game in a row's cell: the opponent and the kickoff or the state's word, a bye, a free agent's
 * none, or none held (box.ts RowGame). */
sealed interface RowGame {
    data class Game(
        val place: String,
        val time: String,
    ) : RowGame

    data object Bye : RowGame

    data object NoClub : RowGame

    data object None : RowGame
}

/** The kickoff weather in a few words with its glyph's name (box.ts WeatherCell). */
data class WeatherCell(
    val glyph: String,
    val words: String,
)

/** How easy his opponent is at his position: the top third of points allowed easy, the bottom third hard
 * (box.ts Ease). The rank prints with it, so the tint is never the only channel. */
enum class Ease(
    val word: String,
) {
    Easy("easy"),
    Hard("hard"),
    Even("even"),
}

/** Where an injured reserve row sits: taking a bench spot, or in the platform's IR slot. */
enum class ReserveRow { Bench, Slot }

/** One row of the Lineup's box score (box.ts BoxRow), as the phone draws it. */
data class StartRow(
    /** His platform id: the row's key and the player sheet's. */
    val id: String,
    val slot: String,
    val name: String,
    /** His name in one line where the whole does not fit (box.ts fitName). */
    val fit: String,
    val slug: String?,
    /** A defense's club mark in place of a face. */
    val clubMark: Boolean,
    /** His face (headshotOf), null for a defense and for a player the box has no line for. */
    val headshot: String?,
    val club: String,
    val position: String,
    /** His rank at his position in our order, null unranked, on a list, or a defense. */
    val rank: Int?,
    val status: RowStatus?,
    val reserve: Boolean,
    val game: RowGame,
    val expected: String?,
    val weather: WeatherCell?,
    val proj: Double?,
    val pts: Double?,
    val read: GameRead,
    val oppRank: Int?,
    val oppOf: Int?,
    val avg: Double?,
    val last: Double?,
    val delta: Double?,
) {
    /** Still to come at the screen's clock: the Opp rank's tint draws only then. */
    val toCome: Boolean get() = read.toPlay

    /** box.ts reserveRow: an injured reserve row draws no game, expected score, weather or Opp rank, and
     * in the IR slot no Proj and no points. */
    fun reserved(reserve: ReserveRow?): StartRow {
        if (reserve == null) return this
        val slotted = reserve == ReserveRow.Slot
        return copy(
            game = RowGame.None,
            expected = null,
            weather = null,
            proj = if (slotted) null else proj,
            pts = if (slotted) null else pts,
            oppRank = null,
            oppOf = null,
            delta = if (slotted) null else delta,
        )
    }
}

/** box.ts boxRow and its cells, over the API's player line. */
internal object StartRows {
    const val RANKED_CLUBS = 32
    private const val PRECIPITATION_NAMED_FROM = 20.0
    private const val HALF = 0.5
    private val rankedPositions = setOf("QB", "RB", "WR", "TE", "K", "DST")
    private val suffixes = setOf("Jr.", "Sr.", "II", "III", "IV", "V")
    private val defense = Regex("\\s+D/ST$")
    private val whitespace = Regex("\\s+")

    /** `ranked` draws his rest-of-season rank (box.ts boxRow's ranked): the Waivers rows leave it out. */
    fun row(
        line: PlayerLine,
        slot: String,
        zone: ZoneId,
        now: Instant,
        ranked: Boolean = true,
    ): StartRow {
        val facts = line.facts
        val player = line.player
        val read = LineRead.game(line, now)
        val status = RowStatuses.row(facts.designation, player.injuredReserve, read.toPlay, zone)
        val listed = status?.onList == true
        val mark = player.position == "DEF" && player.team.isNotEmpty()
        return StartRow(
            id = player.hostId,
            slot = slot,
            name = player.name,
            fit = if (mark) lastName(withoutDefense(player.name)) else initialName(player.name),
            slug = line.slug,
            clubMark = mark,
            headshot = if (mark) null else headshotOf(line.headshot),
            club = player.team,
            position = positionWord(player.position),
            rank = if (ranked && player.position in rankedPositions && !listed) line.positionRank else null,
            status = status,
            reserve = onReserve(line),
            game = game(line, read, zone),
            expected = if (read.toPlay) expected(facts) else null,
            weather = if (read.toPlay) weather(facts) else null,
            proj = if (listed) null else line.weekProjection,
            pts = facts.pointsThisWeek,
            read = read,
            oppRank = if (listed) null else line.oppRank,
            oppOf = if (listed) null else facts.allowedToPosition?.of,
            avg = line.seasonAvg,
            last = line.lastPoints,
            delta = if (listed) null else line.projectionDelta,
        )
    }

    /** box.ts gameOf: "vs LAC" and "Sun 3:25 pm", or the state's word once it has kicked off. */
    fun game(
        line: PlayerLine,
        read: GameRead,
        zone: ZoneId,
    ): RowGame {
        val facts = line.facts
        if (line.player.team == Words.Figure.freeAgentClub) return RowGame.NoClub
        if (facts.bye) return RowGame.Bye
        val opponent = facts.opponent ?: return RowGame.None
        val place = "${if (facts.home == false) "at" else "vs"} $opponent"
        val time =
            when (read) {
                GameRead.Final -> LineRead.word(line, read, Words.Box.final)
                GameRead.KickedOff -> LineRead.word(line, read, Words.Box.kickedOff)
                is GameRead.Unread -> read.word ?: kickoffWords(facts, zone)
                GameRead.Upcoming, GameRead.NoGame -> kickoffWords(facts, zone)
            }
        return RowGame.Game(place, time)
    }

    private fun kickoffWords(
        facts: WeekFacts,
        zone: ZoneId,
    ): String = instantOrNull(facts.kickoff)?.let { Format.weekdayTime(it, zone) }.orEmpty()

    /** box.ts onReserve. */
    fun onReserve(line: PlayerLine): Boolean {
        val designation = line.facts.designation
        return (line.player.injuredReserve && !RowStatuses.dueBack(designation)) ||
            designation?.status == DesignationStatus.injured_reserve
    }

    /** box.ts expectedWords: "20 to 22.5", his club's first. */
    fun expected(facts: WeekFacts): String? = facts.gameTotal?.let { "${halves(it.teamPoints)} to ${halves(it.points - it.teamPoints)}" }

    /** box.ts weatherCell. */
    fun weather(facts: WeekFacts): WeatherCell? {
        val roof = facts.roof
        if (roof?.abroad == true) return WeatherCell("abroad", Words.Box.abroad)
        when (roof?.kind) {
            GameRoof.Kind.dome -> return WeatherCell("indoors", Words.Box.indoors)
            GameRoof.Kind.retractable -> return WeatherCell("roof", Words.Box.roofOpen)
            else -> Unit
        }
        val parts = weatherParts(facts.weather)
        if (parts.isNotEmpty()) return WeatherCell("wind", parts.joinToString(", "))
        return if (roof == null) null else WeatherCell("outdoors", Words.Box.outdoors)
    }

    private fun weatherParts(weather: KickoffWeather?): List<String> {
        if (weather == null) return emptyList()
        val chance = weather.precipitationChance?.takeIf { it >= PRECIPITATION_NAMED_FROM }
        val what =
            when (weather.precipitationKind) {
                KickoffWeather.PrecipitationKind.snow -> "snow"
                KickoffWeather.PrecipitationKind.ice -> "ice"
                else -> "rain"
            }
        return listOfNotNull(
            weather.temperatureF?.let { "${jsRound(it)}°" },
            weather.windMph?.let { "${jsRound(it)} mph" },
            chance?.let { "${jsRound(it)}% $what" },
        )
    }

    /** box.ts easeOf. */
    fun ease(
        rank: Int,
        outOf: Int?,
    ): Ease {
        val clubs = (outOf ?: RANKED_CLUBS).toDouble()
        return when {
            rank > clubs * 2 / 3 -> Ease.Easy
            rank <= clubs / 3 -> Ease.Hard
            else -> Ease.Even
        }
    }

    /** box.ts positionWord: a defense is "D/ST". */
    fun positionWord(position: String): String = if (position == "DEF") "D/ST" else position

    /** game-facts.ts halves: a whole number as it is, else one decimal. */
    private fun halves(points: Double): String = if (points == floor(points)) Format.number(points) else Format.fixed(points, 1)

    /** JavaScript's Math.round: half up, toward positive infinity. */
    fun jsRound(value: Double): Int = floor(value + HALF).toInt()

    /** draft.ts lastName: the last word, or the one before a suffix. */
    fun lastName(name: String): String {
        val parts = name.trim().split(whitespace).filter { it.isNotEmpty() }
        val tail = parts.lastOrNull() ?: return name
        return if (tail in suffixes && parts.size > 2) parts[parts.size - 2] else tail
    }

    /** "Saints" from "Saints D/ST": a defense named by its club. */
    fun withoutDefense(name: String): String = name.replace(defense, "")

    /** box.ts initialName: "A. Rodgers", a one-word name as it is. */
    fun initialName(name: String): String {
        val trimmed = name.trim()
        val first = trimmed.split(whitespace).firstOrNull().orEmpty()
        val last = lastName(trimmed)
        return if (first == last) trimmed else "${first.take(1)}. $last"
    }
}
