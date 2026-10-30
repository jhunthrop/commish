package app.trycommish.core.waivers

import app.trycommish.api.models.PlayerLine
import app.trycommish.api.models.WaiverAdvice
import app.trycommish.api.models.WaiverPositionCard
import app.trycommish.api.models.WaiverStanding
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.start.StartRows
import app.trycommish.core.start.StartWords
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId

/** The figures the position panel reads (positions.ts PanelMode): the rest of the season, the default,
 * or this week's Proj. */
enum class PanelMode {
    Season,
    Week,
    ;

    /** The toggle's chip: "Rest of season", "This week". */
    val word: String get() = if (this == Season) Words.WaiverPanel.season else Words.WaiverPanel.week

    /** The list's figure head: "Rest of season", or Proj this week. */
    val head: String get() = if (this == Season) Words.WaiverPanel.season else Words.Box.proj
}

/** One player on a card's ranked list (positions.ts PanelEntry): the member's with Starter or Bench, a
 * free agent with the table's Beats words and the table's row for the one verb. */
data class PanelEntry(
    val key: String,
    /** His short name, as the strip and Beats print a second mention. */
    val name: String,
    val full: String,
    val team: String,
    /** "Yours, Starter", "Yours, Bench", or "Free". */
    val mark: String,
    /** The toggle's figure: his rest-of-season points, or this week's Proj. */
    val figure: String,
    /** A free agent's row as the table draws it, null for the member's own. */
    val pool: PoolRow?,
    /** "Dart, Bench, +0.3 Gain", null for the member's own. */
    val beats: String?,
    /** The player his name opens in the sheet, null where the site has no page for him. */
    val sheetPlayer: SheetPlayer?,
)

/** One card of the panel (positions.ts PanelCard). */
data class PanelCard(
    val key: String,
    /** "RB", "D/ST". */
    val word: String,
    /** "RB rank 2 of 12", or "RB --" where the figure is not read. */
    val rank: String,
    /** "rank 2 of 12", or "--". */
    val place: String,
    val figure: String,
    /** "501.1 median", null where the mode has no figure. */
    val median: String?,
    val need: Boolean,
    val teams: Int,
    val mine: List<PanelEntry>,
    val free: List<PanelEntry>,
)

/** positions.ts over the page's answer: one card a position the league starts, the member's rank there
 * with his figure against the median team's and the need mark, opening on his players then the best free
 * agents there, each free agent with the table's Beats words (one rule, the table's: poolRows). Every
 * figure is the API's; nothing is computed but the words and the list's order. */
object WaiverPanel {
    private fun standing(
        card: WaiverPositionCard,
        mode: PanelMode,
    ): WaiverStanding? = if (mode == PanelMode.Season) card.restOfSeason else card.week

    /** positions.ts placeWords: "rank 2 of 12", "--" with no figure. */
    internal fun place(
        standing: WaiverStanding?,
        teams: Int,
    ): String = standing?.let { "${Words.WaiverPanel.rank} ${it.rank} ${Words.WaiverPanel.of} $teams" } ?: Words.Box.none

    /** positions.ts beatsWords: the name and his place where he beats one of the member's, then the Gain;
     * the bare figure on a row that names no one. */
    internal fun beats(pool: PoolRow): String {
        val gain = pool.beats.figure ?: Words.Box.none
        val who = pool.beats.who ?: return gain
        return "${who.name}, ${who.place}, $gain"
    }

    private fun value(
        line: PlayerLine,
        points: Double?,
        mode: PanelMode,
    ): Double? = if (mode == PanelMode.Season) points else line.weekProjection

    /** Highest first, none last, ties in the answer's order (a stable sort, as the web's). */
    private fun <T> byFigure(
        items: List<T>,
        figure: (T) -> Double?,
    ): List<T> = items.sortedByDescending { figure(it) ?: Double.NEGATIVE_INFINITY }

    private fun mine(
        card: WaiverPositionCard,
        mode: PanelMode,
        zone: ZoneId,
        now: Instant,
    ): List<PanelEntry> =
        byFigure(card.mine) { value(it.line, it.restOfSeasonPoints, mode) }.map { player ->
            val line = player.line
            val starts = if (mode == PanelMode.Season) player.starter else player.startsThisWeek
            val mark = if (starts) Words.Waivers.starter else Words.Waivers.bench
            PanelEntry(
                key = "mine:${line.player.hostId}",
                name = WaiverWords.shortName(line.player.name),
                full = line.player.name,
                team = line.player.team,
                mark = "${Words.WaiverPanel.yours}, $mark",
                figure = StartWords.number(value(line, player.restOfSeasonPoints, mode)),
                pool = null,
                beats = null,
                sheetPlayer = WaiverRows.sheetPlayer(line.player.hostId, WaiverRows.cells(line, null, zone, now)),
            )
        }

    private fun free(
        card: WaiverPositionCard,
        advice: WaiverAdvice,
        mode: PanelMode,
        zone: ZoneId,
        now: Instant,
    ): List<PanelEntry> {
        // This week lists the week's own best five by Proj; an older answer re-sorts its five.
        val listed = if (mode == PanelMode.Week) card.availableWeek ?: card.available else card.available
        val free = byFigure(listed) { value(it.row.add, it.restOfSeasonPoints, mode) }
        val pools = WaiverRows.pool(advice.copy(rows = free.map { it.row }), advice.pickups, zone, now)
        return free.zip(pools) { entry, pool ->
            val line = entry.row.add
            PanelEntry(
                key = "free:${pool.key}",
                name = WaiverWords.shortName(line.player.name),
                full = line.player.name,
                team = line.player.team,
                mark = Words.WaiverPanel.free,
                figure = StartWords.number(value(line, entry.restOfSeasonPoints, mode)),
                pool = pool,
                beats = beats(pool),
                sheetPlayer = pool.sheetPlayer,
            )
        }
    }

    /** positions.ts panelCards: the cards in the mode, none from an answer without the panel. */
    fun cards(
        advice: WaiverAdvice,
        mode: PanelMode,
        zone: ZoneId,
        now: Instant,
    ): List<PanelCard> =
        advice.positions.orEmpty().map { card ->
            val standing = standing(card, mode)
            val word = StartRows.positionWord(card.position.value)
            val place = place(standing, card.teams)
            PanelCard(
                key = card.position.value,
                word = word,
                rank = "$word $place",
                place = place,
                figure = StartWords.number(standing?.points),
                median = standing?.let { "${StartWords.number(it.median)} ${Words.WaiverPanel.median}" },
                // The need is the rest of the season's: not marked on this week's figures.
                need = card.need && mode == PanelMode.Season,
                teams = card.teams,
                mine = mine(card, mode, zone, now),
                free = free(card, advice, mode, zone, now),
            )
        }

    /** positions.ts panelHasWeek: the toggle is drawn only when a card reads this week. */
    fun hasWeek(advice: WaiverAdvice): Boolean = advice.positions.orEmpty().any { it.week != null }

    /** positions.ts panelExplain: what the rank is, and where a Need is drawn what it is and how the
     * Trades screen's needs differ. */
    fun explain(
        mode: PanelMode,
        cards: List<PanelCard>,
    ): String {
        val rank = if (mode == PanelMode.Season) Words.WaiverPanel.explainSeason else Words.WaiverPanel.explainWeek
        return if (cards.any { it.need }) "$rank ${Words.WaiverPanel.needSays} ${Words.WaiverPanel.tradesNeeds}" else rank
    }
}
