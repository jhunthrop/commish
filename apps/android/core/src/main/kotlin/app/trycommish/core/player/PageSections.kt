package app.trycommish.core.player

import app.trycommish.api.models.RunBoardAnswer
import app.trycommish.api.models.RunDesignations
import app.trycommish.api.models.RunFormat
import app.trycommish.api.models.RunGameStatus
import app.trycommish.api.models.RunPlayer
import app.trycommish.api.models.RunPlayerFormat
import app.trycommish.api.models.RunSeason
import app.trycommish.core.Format
import app.trycommish.core.board.BoardFigures
import app.trycommish.core.board.BoardOrder
import app.trycommish.core.board.BoardPosition
import app.trycommish.core.board.RunWords
import app.trycommish.core.board.placed
import app.trycommish.design.Words
import kotlin.math.max

/** The tier box (server/pages/player.ts mates and tierBasisOf, TierMates.svelte): his tier among the
 * available players at his position on the leading board, the line under its band, its players and the
 * basis at its foot. */
data class TierBox(
    val tier: Int,
    /** "Tier 5 WRs". */
    val title: String,
    /** "12 players, then 9.8 PPR pts down to tier 6", or "..., the last tier". */
    val drop: String?,
    val mates: List<Mate>,
    val basis: String,
) {
    data class Mate(
        val id: String,
        val name: String,
        val positionRank: Int,
        val team: String,
        val projected: String,
        /** The weeks his figure counts where they are not the page's player's. */
        val span: String?,
        val current: Boolean,
    )
}

/** The every-format table (player-words.ts formatTable, the page's table): its points head, each format's
 * row, and why the formats need not line up. */
data class FormatsTable(
    val head: String,
    val rows: List<Row>,
    val note: String?,
) {
    data class Row(
        val label: String,
        val rank: String,
        val points: String,
        val vor: String,
        val tier: String,
    )
}

/** A fact the written read will be built from (run/unwritten-words.ts UnwrittenLine). */
data class UnwrittenLine(
    val lead: String,
    val text: String,
    val figure: String,
)

/** The page's sections beside the card, ported from the web's page build. */
internal object PageSections {
    /** player-words.ts FORMATS_FITTED_APART. */
    private const val FITTED_APART =
        "Each format weighs his season against his preseason pace by its own fit, so Half PPR need not sit halfway between PPR and Standard."
    private const val NO_GAME_LEFT = "with no game left"

    /** rest-from.ts restSpanWords: "weeks 7 to 17", "week 18", "with no game left". */
    fun restSpan(week: Int?): String {
        if (week == null) return NO_GAME_LEFT
        val last = max(PageWords.RUN_LAST_WEEK, week)
        return if (week == last) "week $week" else "weeks $week to $last"
    }

    /** rest-from.ts playerRestWords: "from week 7", "with no game left". */
    private fun restWords(week: Int?): String = week?.let { RunWords.restFrom(it, partial = false) } ?: NO_GAME_LEFT

    /** The tier box over the leading board, null where he is not on it. */
    fun tier(
        board: RunBoardAnswer,
        player: String,
        format: RunFormat,
        season: Int,
        capture: RunDesignations?,
    ): TierBox? {
        val statuses = capture?.players.orEmpty()
        val row = board.rows.firstOrNull { it.id == player } ?: return null
        val position = BoardPosition.of(row.position.value) ?: return null
        val his = if (format.rosFromWeek == null) null else (row.restFromWeek ?: format.rosFromWeek)
        val basis =
            if (format.rosFromWeek == null) {
                "Projected ${format.label} points, $season"
            } else {
                "Projected ${format.label} points for the rest of $season, ${restSpan(his)}"
            }
        val title = "Tier ${row.tier} ${position.group.second}"
        val group = BoardOrder.tiers(board.rows.map { it.placed() }, position, statuses).firstOrNull { it.tier == row.tier }
        if (BoardOrder.heldOut(row.id, statuses) || group == null) return TierBox(row.tier, title, null, emptyList(), basis)
        val count = Format.plural(group.rows.size, "player", "players")
        val drop =
            group.drop?.let { "$count, then ${Format.fixed(it)} ${format.unit} down to tier ${group.tier + 1}" } ?: "$count, the last tier"
        return TierBox(
            tier = group.tier,
            title = "Tier ${group.tier} ${position.group.second}",
            drop = drop,
            mates =
                group.rows.map { mate ->
                    val theirs = if (format.rosFromWeek == null) null else (mate.restFromWeek ?: format.rosFromWeek)
                    TierBox.Mate(
                        id = mate.id,
                        name = mate.name,
                        positionRank = mate.positionRank,
                        team = mate.team,
                        projected = Format.fixed(mate.projected.toDouble()),
                        span = if (theirs == his) null else restSpan(theirs),
                        current = mate.id == player,
                    )
                },
            basis = basis,
        )
    }

    /** A format line the table and the unwritten list read: the format, his numbers in it, and whether the
     * run ranks the rest of the season in it. */
    data class Line(
        val format: RunFormat,
        val numbers: RunPlayerFormat,
        val rest: Boolean,
    )

    fun lines(
        player: RunPlayer,
        formats: List<RunFormat>,
    ): List<Line> = formats.mapNotNull { format -> player.formats[format.id]?.let { Line(format, it, PageWords.ranksRest(format)) } }

    /** player-words.ts formatTable, with the page's rows; null with one format, which the page draws none of. */
    fun formats(
        lines: List<Line>,
        held: String?,
    ): FormatsTable? {
        if (lines.size < 2) return null
        val from = { entry: Line ->
            val week = if (entry.format.rosFromWeek == null) null else (entry.numbers.restFromWeek ?: entry.format.rosFromWeek)
            "Rest of season ${restWords(week)}"
        }
        val rest = lines.filter { it.rest }
        val note = if (rest.size > 1) FITTED_APART else null
        val (head, labels) =
            when {
                rest.isEmpty() -> Words.Figure.projected to lines.map { it.format.label }
                rest.size == lines.size -> from(rest.first()) to lines.map { it.format.label }
                else ->
                    Words.Figure.projected to
                        lines.map { if (it.rest) "${it.format.label}, ${from(it).lowercase()}" else it.format.label }
            }
        return FormatsTable(
            head = head,
            rows =
                lines.zip(labels).map { (line, label) ->
                    FormatsTable.Row(
                        label = label,
                        rank = held ?: line.numbers.ourRank.toString(),
                        points = Format.fixed(line.numbers.projected.toDouble()),
                        vor = BoardFigures.signed(line.numbers.vor.toDouble()),
                        tier = held ?: line.numbers.tier.toString(),
                    )
                },
            note = note,
        )
    }

    /** What the unwritten list is said over: his position, the board's size, the format, the season and the
     * word his ranks show as on a season-long list (unwritten-words.ts UnwrittenInput). */
    data class UnwrittenFacts(
        val position: String,
        val boardSize: Int,
        val format: RunFormat,
        val year: Int,
        val held: String?,
    )

    /** unwritten-words.ts unwrittenLines over the leading format. */
    fun unwritten(
        numbers: RunPlayerFormat,
        facts: UnwrittenFacts,
    ): List<UnwrittenLine> {
        val (position, boardSize, format, year, held) = facts
        val span = if (PageWords.ranksRest(format)) "the rest of $year" else year.toString()
        val label = format.label
        val place =
            if (held != null) {
                listOf(
                    UnwrittenLine(
                        "His place",
                        "On a season-long list, so he sits below every available $position on our $label board, in no tier.",
                        "$position $held",
                    ),
                )
            } else {
                listOf(
                    UnwrittenLine(
                        "Our rank",
                        "$position ${numbers.positionRank} and pick ${numbers.ourRank} overall among the $boardSize on our $label board.",
                        "$position${numbers.positionRank}",
                    ),
                    UnwrittenLine("His tier", "Tier ${numbers.tier} among ${position}s on our $label board.", "Tier ${numbers.tier}"),
                )
            }
        val floor = numbers.floor?.toDouble()
        val median = numbers.median?.toDouble()
        val ceiling = numbers.ceiling?.toDouble()
        val range =
            if (floor != null && median != null && ceiling != null) {
                val low = Format.fixed(floor)
                val high = Format.fixed(ceiling)
                listOf(
                    UnwrittenLine(
                        "His range",
                        "Low case $low, middle ${Format.fixed(median)} and high case $high ${format.unit} for $span.",
                        "$low to $high",
                    ),
                )
            } else {
                emptyList()
            }
        val games =
            UnwrittenLine(
                "Games we expect",
                "Games we expect him to play in $span, the base of his projected $label points.",
                Format.fixed(numbers.expectedGames.toDouble()),
            )
        return place + range + games
    }

    /** player-card.ts cardBuild's week ahead: the first week past his counted one that is a game to play or
     * his bye. */
    fun weekAhead(season: RunSeason): CardHead? {
        val counted = SeasonViews.countedWeek(season)
        val row =
            season.log.firstOrNull {
                it.week > counted && (it.status == RunGameStatus.bye || (it.status == RunGameStatus.upcoming && it.opponent != null))
            } ?: return null
        val opponent = row.opponent?.let { "${if (row.home == true) "vs" else "at"} $it" } ?: Words.Box.bye
        return CardHead(row.week, opponent)
    }

    /** The card's tiles as built, before the week is read: the week's "--", rest of season in the lead
     * format, Avg and Last from his season. */
    fun builtTiles(
        page: RunPlayer?,
        format: RunFormat,
        next: CardHead?,
        projected: Double,
    ): List<CardTile> {
        val built = CardTiles.builtTiles(page, format, projected)
        val none = Words.Card.none
        return listOf(
            CardTile(CardTile.Key.Proj, next?.let { CardTiles.weekHead(it.week) } ?: Words.Figure.week, none, CardTile.Tone.Lead),
            built.rest,
            CardTile(CardTile.Key.Opp, Words.Card.opp, none, null),
            built.avg,
            built.last,
            CardTile(CardTile.Key.Delta, Words.Card.delta, none, CardTile.Tone.Quiet),
        )
    }
}
