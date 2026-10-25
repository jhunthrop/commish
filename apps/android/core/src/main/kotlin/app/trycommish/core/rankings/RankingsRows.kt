package app.trycommish.core.rankings

import app.trycommish.api.models.OrderAdvice
import app.trycommish.api.models.OrderRow
import app.trycommish.api.models.PlayerLine
import app.trycommish.api.models.WeekFacts
import app.trycommish.api.models.WeekOrderRow
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.headshotOf
import app.trycommish.core.start.GameRead
import app.trycommish.core.start.LineRead
import app.trycommish.core.start.RowGame
import app.trycommish.core.start.RowStatus
import app.trycommish.core.start.StartRow
import app.trycommish.core.start.StartRows
import app.trycommish.core.start.StartWords
import app.trycommish.core.start.WeatherCell
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId

/** A chip over the Rankings (order.ts PLAYERS_CHIPS): one of our order's four positions, or the week's
 * kickers or defenses, which the published projection orders (we rank neither). null is All. */
enum class RankingsChip(
    val api: String,
) {
    QB("QB"),
    RB("RB"),
    WR("WR"),
    TE("TE"),
    K("K"),
    DEF("DEF"),
    ;

    /** box.ts positionWord: a defense is "D/ST". */
    val word: String get() = StartRows.positionWord(api)

    /** The order's position for our order's chips, null for the week's. */
    val orderPosition: OrderPosition? get() = OrderPosition.entries.firstOrNull { it.name == api }

    /** The week's position for the kickers' and defenses' chips (order.ts weekChip), null for ours. */
    val weekPosition: WeekPosition? get() = WeekPosition.entries.firstOrNull { it.name == api }
}

/** A player's cell as the Rankings' rows draw it (BoxPlayer.svelte at 390): his name whole and short,
 * his club's mark for a defense, his club, his pill (his position and, across positions, his rank at it,
 * or the list he is on), his status chip, his game with its zone, and while it is to come the expected
 * score with both clubs and the kickoff weather. */
data class RankingsPlayer(
    /** His board id: the row's key and the player sheet's. */
    val key: String,
    val name: String,
    /** His short form where the whole does not fit: "D. Swift", "Titans". */
    val fit: String,
    val slug: String?,
    /** A defense draws its club's mark in place of a face. */
    val clubMark: Boolean,
    val club: String,
    /** "RB 15", "TE IR", "K"; null for a defense, whose mark names it. */
    val pill: String?,
    /** His position as the pill names it, null for a defense. */
    val position: String?,
    /** His rank at the position where the pill draws it, or the list he is on ("IR"); null with neither. */
    val rank: String?,
    val status: RowStatus?,
    val game: RowGame,
    /** "Expected score CHI 26.5, ATL 23", while his game is to come. */
    val expected: String?,
    val weather: WeatherCell?,
    /** His face for the sheet's head (the row draws his initials, as the web's box rows at 390 do). */
    val headshot: String?,
    /** His board id, by which the sheet reads his week where the run's index names no page for him. */
    val boardId: String?,
) {
    /** The player his name opens in the sheet, by his id: null where the site has no page for him (a
     * kicker, a defense), as the web's row draws no link. */
    val sheetPlayer: SheetPlayer?
        get() = slug?.let { SheetPlayer(key, it, name, position, rank, club, headshot, boardId) }
}

/** One row of our order as the phone draws it (OrderTable.svelte at 390). */
data class RankingsRow(
    val player: RankingsPlayer,
    /** The API's rank, never numbered again here (Review Focus 4). */
    val rank: Int,
    /** The # cell: his rank, the list's word for a player on a season-long list, or nothing for a bye. */
    val place: String,
    val bye: Boolean,
    /** The week's column: his Pts once final, his Proj before, "--" without. */
    val week: String,
    /** His rest-of-season Projected, the big figure. */
    val total: String,
    /** "Over repl. 52.8, A game 10.3, Opp 1st, Avg 11.8, Last 17.3". */
    val folded: String,
)

/** One row of the kickers' or defenses' week (WeekTable.svelte at 390). */
data class WeekRankingsRow(
    val player: RankingsPlayer,
    val proj: String,
    /** "Opp 16th, Avg 9.7, Last 5.0". */
    val folded: String,
)

/** A run of rows under one head: the players who play with none, then "Bye in week 6", or on the week's
 * tab "Kicked off" or "Played Thursday". */
data class RankingsSection<Row>(
    val key: String,
    val head: String?,
    val rows: List<Row>,
)

/** The week's sections, a row by its section at the screen's clock (week.ts sectionAt). */
enum class WeekSection(
    val key: String,
) {
    ToPlay("to_play"),
    KickedOff("kicked_off"),
    Bye("bye"),
}

/** What the order's # sorts on: Over repl. across positions, Projected at one. */
enum class RankBy { PointsOverReplacement, RestOfSeasonPoints }

/** order.ts orderView and week.ts weekView over the API's rows, ported. */
internal object RankingsRows {
    /** box.ts POSITIONS: the positions a pill names; a defense has none. */
    private val pilled = setOf("QB", "RB", "WR", "TE", "K")

    fun rankBy(advice: OrderAdvice): RankBy =
        if (advice.rankBy == OrderAdvice.RankBy.rest_of_season_points) RankBy.RestOfSeasonPoints else RankBy.PointsOverReplacement

    /** The player cell (boxRow with order.ts gameCell): the kickoff still to come with its zone, the
     * expected score with both clubs. */
    fun player(
        line: PlayerLine,
        pillRank: Boolean,
        zone: ZoneId,
        now: Instant,
    ): RankingsPlayer {
        val row = StartRows.row(line, slot = "", zone = zone, now = now, ranked = false)
        val listed = row.status?.onList == true
        val position = line.player.position.takeIf { it in pilled }
        val rank = line.positionRank.takeIf { pillRank && !listed }
        val shownRank = if (position == null) null else rank?.toString() ?: row.status?.rank
        val defense = line.player.position == "DEF"
        val name = if (defense) "${nickname(line.player.name)} ${row.position}" else row.name
        return RankingsPlayer(
            key = line.player.boardId ?: line.player.hostId,
            name = name,
            fit = if (defense) StartRows.lastName(StartRows.withoutDefense(name)) else row.fit,
            slug = line.slug,
            clubMark = row.clubMark,
            club = row.club,
            pill = position?.let { listOfNotNull(it, shownRank).joinToString(" ") },
            position = position,
            rank = shownRank,
            status = row.status,
            game = gameCell(row, line.facts, zone),
            expected = if (row.expected == null) null else expectedScore(line.facts, line.player.team),
            weather = row.weather,
            headshot = if (defense) null else headshotOf(line.headshot),
            boardId = line.player.boardId,
        )
    }

    /** order.ts gameCell: the kickoff still to come said with its zone. */
    private fun gameCell(
        row: StartRow,
        facts: WeekFacts,
        zone: ZoneId,
    ): RowGame {
        val game = row.game
        val kickoff = instantOrNull(facts.kickoff)
        return if (game is RowGame.Game && row.read.toPlay && kickoff != null) game.copy(time = Format.kickoffAt(kickoff, zone)) else game
    }

    /** clubs.ts clubNickname from the API's name for a club: its last word ("Titans", "49ers"). */
    fun nickname(club: String): String =
        club
            .trim()
            .split(Regex("\\s+"))
            .lastOrNull()
            ?.takeIf { it.isNotEmpty() } ?: club

    /** box.ts expectedScoreWords: "Expected score CHI 26.5, ATL 23", his club's first. */
    fun expectedScore(
        facts: WeekFacts,
        club: String,
    ): String? {
        val total = facts.gameTotal ?: return null
        val opponent = facts.opponent ?: return null
        val theirs = total.points - total.teamPoints
        return "${RankingsWords.EXPECTED_SCORE} $club ${StartRows.halves(total.teamPoints)}, $opponent ${StartRows.halves(theirs)}"
    }

    /** order.ts orderView at the phone: byes sit apart (the week's rankings), the # the API's rank. */
    fun row(
        row: OrderRow,
        rankBy: RankBy,
        pillRank: Boolean,
        zone: ZoneId,
        now: Instant,
    ): RankingsRow {
        val line = row.line
        val player = player(line, pillRank, zone, now)
        val listed = player.status?.onList == true
        val bye = line.facts.bye && !listed
        val place =
            when {
                listed -> player.status?.rank.orEmpty()
                bye -> ""
                else -> row.rank.toString()
            }
        val figures =
            if (rankBy ==
                RankBy.PointsOverReplacement
            ) {
                listOf("${Words.Order.overRepl} ${StartWords.number(row.pointsOverReplacement)}")
            } else {
                emptyList()
            }
        val read = StartRows.row(line, slot = "", zone = zone, now = now, ranked = false)
        return RankingsRow(
            player = player,
            rank = row.rank,
            place = place,
            bye = bye,
            week = StartWords.number(if (listed) null else weekFigure(line, now)),
            total = StartWords.number(row.restOfSeasonPoints),
            folded =
                (
                    figures + "${Words.Order.perGame} ${StartWords.number(
                        line.restOfSeasonPerGame,
                    )}" + evidence(read)
                ).joinToString(", "),
        )
    }

    /** The Opp rank, Avg and Last folded under a name (week.ts foldedEvidence). */
    fun evidence(row: StartRow): List<String> =
        listOfNotNull(row.oppRank?.let { "${Words.Box.opp} ${Format.ordinal(it)}" }) +
            listOf("${Words.Box.avg} ${StartWords.number(row.avg)}", "${Words.Box.last} ${StartWords.number(row.last)}")

    /** order.ts weekFigure: once his game is final his points, else his Proj. */
    fun weekFigure(
        line: PlayerLine,
        now: Instant,
    ): Double? {
        if (LineRead.game(line, now) != GameRead.Final) return line.weekProjection
        val facts = line.facts
        return facts.pointsThisWeek ?: facts.lastGames.firstOrNull { it.week == facts.week }?.points
    }

    /** order.ts orderSections: the players who play, then the byes under "Bye in week 6". */
    fun sections(
        rows: List<RankingsRow>,
        week: Int,
    ): List<RankingsSection<RankingsRow>> =
        listOf(
            RankingsSection("playing", null, rows.filter { !it.bye }),
            RankingsSection("bye", RankingsWords.byeHead(week), rows.filter { it.bye }),
        ).filter { it.rows.isNotEmpty() }

    /** week.ts weekView's row. */
    fun weekRow(
        row: WeekOrderRow,
        zone: ZoneId,
        now: Instant,
    ): WeekRankingsRow {
        val read = StartRows.row(row.line, slot = "", zone = zone, now = now, ranked = false)
        return WeekRankingsRow(
            player = player(row.line, pillRank = false, zone = zone, now = now),
            proj = StartWords.number(read.proj),
            folded = evidence(read).joinToString(", "),
        )
    }

    /** week.ts sectionAt: the API's section, a game's own state at the screen's clock where it has one. */
    fun section(
        row: WeekOrderRow,
        now: Instant,
    ): WeekSection {
        val api = WeekSection.entries.firstOrNull { it.key == row.section.value } ?: WeekSection.ToPlay
        if (api == WeekSection.Bye) return api
        val state = LineRead.game(row.line, now).stateName ?: return api
        return if (state == "upcoming") WeekSection.ToPlay else WeekSection.KickedOff
    }

    /** week.ts weekSections: to play with no head, then kicked off ("Played Thursday" once every one of
     * its games is final), then the byes; a section with no rows is not drawn. */
    fun weekSections(
        rows: List<Pair<WeekOrderRow, WeekRankingsRow>>,
        week: Int,
        zone: ZoneId,
        now: Instant,
    ): List<RankingsSection<WeekRankingsRow>> =
        WeekSection.entries.mapNotNull { key ->
            val held = rows.filter { section(it.first, now) == key }
            if (held.isEmpty()) return@mapNotNull null
            val head =
                when (key) {
                    WeekSection.ToPlay -> null
                    WeekSection.Bye -> RankingsWords.byeHead(week)
                    WeekSection.KickedOff -> kickedOffHead(held.map { it.first }, held.map { it.second }, zone)
                }
            RankingsSection(key.key, head, held.map { it.second })
        }

    /** week.ts kickedOffHead. */
    private fun kickedOffHead(
        rows: List<WeekOrderRow>,
        shown: List<WeekRankingsRow>,
        zone: ZoneId,
    ): String {
        val final = shown.all { (it.player.game as? RowGame.Game)?.time == Words.Box.final }
        if (!final) return Words.WeekTab.kickedOff
        val days = rows.mapNotNull { instantOrNull(it.line.facts.kickoff) }.map { Format.weekdayName(it, zone) }.distinct()
        return "${Words.WeekTab.played} ${days.joinToString(" and ")}"
    }

    /** week.ts weekSearch: a row whose name, the API's name or club holds the letters, any case; every row
     * until the search holds the API's fewest letters. */
    fun matches(
        row: WeekOrderRow,
        shown: WeekRankingsRow,
        query: String,
    ): Boolean {
        val letters = query.trim().lowercase()
        if (letters.length < OrderQuery.MIN_SEARCH) return true
        return listOf(shown.player.name, row.line.player.name, shown.player.club).any { letters in it.lowercase() }
    }
}
