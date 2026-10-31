package app.trycommish.core.waivers

import app.trycommish.api.models.PlayerLine
import app.trycommish.api.models.WaiverAdvice
import app.trycommish.api.models.WaiverPositionCard
import app.trycommish.api.models.WaiverPositionPlayer
import app.trycommish.api.models.WaiverStanding
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.start.RowCells
import app.trycommish.core.start.StartRows
import app.trycommish.core.start.StartWords
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId

/** The figures the cards and the list read (positions.ts PanelMode): the rest of the season, the default,
 * or this week's Proj. */
enum class PanelMode {
    Season,
    Week,
    ;

    /** The toggle's chip: "Rest of season", "This week". */
    val word: String get() = if (this == Season) Words.WaiverPanel.season else Words.WaiverPanel.week

    /** The rank's meaning, said once a mode under the cards (positions.ts PANEL.explain). */
    val explain: String get() = if (this == Season) Words.WaiverPanel.explainSeason else Words.WaiverPanel.explainWeek
}

/** The member's figure as a share of twice the median, 0 to 1 (the median at the half), and whether it
 * is under the median. */
data class NavMeter(
    val share: Double,
    val under: Boolean,
)

/** One card of the row (position-nav.ts NavCard). */
data class NavCard(
    /** A position ("QB", "DEF"), or [WaiverNav.ALL]. */
    val key: String,
    /** "All", "QB", "D/ST". */
    val word: String,
    /** "rank 9 of 12"; on a count card its free agents' count; null with no figure (the card says what it
     * waits on, never a bare "--"). */
    val place: String?,
    /** The member's figure (on a count card, how many beat a player of his); null with no figure. */
    val figure: String?,
    /** "155.6 median"; on All, "Every position"; null with no figure. */
    val foot: String?,
    /** Beside the figure: "this week" on a card that reads this week's Proj, a count card's "beat yours". */
    val tag: String?,
    val need: Boolean,
    /** The strip's pickups include one here. */
    val pickup: Boolean,
    /** Said in place of a figure where none is read yet. */
    val waits: String?,
    val meter: NavMeter?,
) {
    /** The card's name for TalkBack: the position, its rank, the figure and Need (ruling 3). */
    val spoken: String
        get() =
            listOfNotNull(
                word,
                place,
                figure,
                tag,
                Words.WaiverPanel.need.takeIf { need },
                Words.WaiverNav.pickup.takeIf { pickup },
                foot,
                waits,
            ).joinToString(", ")
}

/** The counts a count card says (position-nav.ts NavCounts). */
data class NavCounts(
    val free: Int,
    val gaining: Int,
)

/** The line over the comparison (position-nav.ts navLead): the chosen card's rank, and only what the card
 * cannot say. */
data class NavLead(
    val head: String,
    val words: String?,
)

/** One of the member's players at the chosen position, in the table's columns (position-nav.ts YoursRow). */
data class YoursRow(
    val key: String,
    val cells: RowCells,
    /** "Opp 2nd, Avg 8.9, Last 10.5, A game 6.4", the table's evidence line. */
    val evidence: String,
    /** His rest-of-season points a game, the table's A game. */
    val rest: Double?,
    /** Starter or Bench in the mode's lineup. */
    val role: String,
    val starts: Boolean,
) {
    /** The player his name opens in the sheet, null where the site has no page for him. */
    val sheetPlayer: SheetPlayer? get() = WaiverRows.sheetPlayer(key, cells)
}

/** The member's players at the chosen position over the free agents there (WaiverScreen.svelte compare). */
data class NavCompare(
    /** "Your TE". */
    val yours: String,
    /** "Free at TE". */
    val free: String,
    val rows: List<YoursRow>,
)

/** position-nav.ts over the page's answer: the Waivers screen's position cards as its navigation, All
 * first, then a card a position the league starts, each with the member's rank there, his figure against
 * the median team's and the Need mark; the card the screen opens on; the member's players at the chosen
 * position over the free agents there. Every figure is the API's; nothing is computed but the words and
 * the order. */
object WaiverNav {
    /** The All card's key (position-nav.ts ALL). */
    const val ALL = "ALL"

    /** "Your TE", over the member's players at the position. */
    fun yours(word: String): String = "Your $word"

    /** "Free at TE", over the free agents there. */
    fun freeAt(word: String): String = "Free at $word"

    /** The lead on a card that ranks this week's Proj in place of a rest-of-season order (K, D/ST). */
    fun swapped(word: String): String = "$word has no rest-of-season order, so its card ranks this week's Proj."

    /** Where a position's own read failed: its players from the screen's first read stay listed. */
    fun firstRead(word: String): String = "Showing the first read's players at $word."

    private fun card(
        advice: WaiverAdvice,
        key: String,
    ): WaiverPositionCard? = advice.positions.orEmpty().firstOrNull { it.position.value == key }

    /** positions.ts placeWords: "rank 9 of 12". */
    private fun place(
        standing: WaiverStanding,
        teams: Int,
    ): String = "${Words.WaiverPanel.rank} ${standing.rank} ${Words.WaiverPanel.of} $teams"

    /** position-nav.ts navStanding: the standing a card reads in the mode, its own, or on Rest of season
     * where the position has no rest-of-season order (K, D/ST) this week's, marked as swapped; null where
     * neither is read. */
    internal fun standing(
        card: WaiverPositionCard,
        mode: PanelMode,
    ): Pair<WaiverStanding, Boolean>? {
        val own = if (mode == PanelMode.Season) card.restOfSeason else card.week
        if (own != null) return own to false
        val week = card.week
        return if (mode == PanelMode.Season && week != null) week to true else null
    }

    /** position-nav.ts navCounts: the free agents a set of rows holds and how many beat a player of his. */
    fun counts(rows: List<PoolRow>): NavCounts = NavCounts(rows.size, rows.count { it.gains })

    private fun countCard(
        key: String,
        word: String,
        counts: NavCounts,
        foot: String?,
        pickup: Boolean,
    ): NavCard =
        NavCard(
            key = key,
            word = word,
            place = "${counts.free} ${Words.WaiverNav.freeAgents}",
            figure = counts.gaining.toString(),
            foot = foot,
            tag = Words.WaiverNav.beat,
            need = false,
            pickup = pickup,
            waits = null,
            meter = null,
        )

    private fun meter(standing: WaiverStanding): NavMeter? {
        if (standing.median <= 0) return null
        val ratio = standing.points / standing.median
        return NavMeter((ratio / 2).coerceIn(0.0, 1.0), ratio < 1)
    }

    private fun positionCard(
        card: WaiverPositionCard,
        mode: PanelMode,
        pickups: Set<String>,
    ): NavCard {
        val key = card.position.value
        val word = StartRows.positionWord(key)
        val read =
            standing(card, mode)
                ?: return NavCard(key, word, null, null, null, null, false, key in pickups, Words.WaiverNav.waits, null)
        val (standing, swapped) = read
        return NavCard(
            key = key,
            word = word,
            place = place(standing, card.teams),
            figure = StartWords.number(standing.points),
            foot = "${StartWords.number(standing.median)} ${Words.WaiverPanel.median}",
            tag = if (swapped) Words.WaiverNav.weekTag else null,
            // The need is the rest of the season's (the profile's): never marked on this week's figures.
            need = card.need && mode == PanelMode.Season && !swapped,
            pickup = key in pickups,
            waits = null,
            meter = meter(standing),
        )
    }

    /** position-nav.ts navCards: All first, then each position the answer's panel carries, in its order. An
     * answer without the panel (an older API, or no rest-of-season points read) still navigates: a count
     * card for each position its rows hold, in the board's order. */
    fun cards(
        advice: WaiverAdvice,
        mode: PanelMode,
        counts: NavCounts,
        byPosition: List<Pair<String, NavCounts>>,
    ): List<NavCard> {
        val pickups = advice.pickups.map { it.add.player.position }.toSet()
        val all = countCard(ALL, Words.WaiverNav.all, counts, Words.WaiverNav.every, pickup = false)
        val positions = advice.positions
        if (positions.isNullOrEmpty()) {
            return listOf(all) +
                byPosition.map { (key, c) -> countCard(key, StartRows.positionWord(key), c, null, key in pickups) }
        }
        return listOf(all) + positions.map { positionCard(it, mode, pickups) }
    }

    /** position-nav.ts openingKey: the Need with the weakest rank, the first in the panel's order on a tie;
     * All where no card marks one. */
    fun opening(advice: WaiverAdvice): String {
        var weakest: Pair<String, Int>? = null
        for (card in advice.positions.orEmpty()) {
            val rest = card.restOfSeason
            if (!card.need || rest == null) continue
            if (rest.rank > (weakest?.second ?: Int.MIN_VALUE)) weakest = card.position.value to rest.rank
        }
        return weakest?.first ?: ALL
    }

    /** position-nav.ts yoursRows: the member's players at the position, starters first, then by the mode's
     * figure (his rest-of-season points, or this week's Proj), none last; empty for All or a position
     * without a card. */
    fun yours(
        advice: WaiverAdvice,
        key: String,
        mode: PanelMode,
        zone: ZoneId,
        now: Instant,
    ): List<YoursRow> {
        val card = card(advice, key) ?: return emptyList()
        val starts = { m: WaiverPositionPlayer -> if (mode == PanelMode.Season) m.starter else m.startsThisWeek }
        val figure = { m: WaiverPositionPlayer ->
            (if (mode == PanelMode.Season) m.restOfSeasonPoints else m.line.weekProjection) ?: Double.NEGATIVE_INFINITY
        }
        // A stable sort, as the web's: starters first, then highest figure.
        return card.mine
            .sortedWith(compareByDescending<WaiverPositionPlayer> { starts(it) }.thenByDescending { figure(it) })
            .map { mine ->
                val line = mine.line
                val cells = WaiverRows.cells(line, null, zone, now)
                YoursRow(
                    key = "yours:${line.player.hostId}",
                    cells = cells,
                    evidence = WaiverRows.evidence(cells, line.restOfSeasonPerGame),
                    rest = line.restOfSeasonPerGame,
                    role = if (starts(mine)) Words.Waivers.starter else Words.Waivers.bench,
                    starts = starts(mine),
                )
            }
    }

    /** position-nav.ts navLead: the chosen card's rank, and beside it only what the card cannot say (a
     * Need's meaning, a swapped figure's); All's words for All. A position with no card, or no figure, is
     * named alone. */
    fun lead(
        advice: WaiverAdvice,
        key: String,
        mode: PanelMode,
    ): NavLead {
        if (key == ALL) return NavLead(Words.WaiverNav.allHead, Words.WaiverNav.allSays)
        val word = StartRows.positionWord(key)
        val card = card(advice, key) ?: return NavLead(word, null)
        val (standing, swapped) = standing(card, mode) ?: return NavLead(word, null)
        val need = card.need && mode == PanelMode.Season && !swapped
        val words =
            when {
                swapped -> swapped(word)
                need -> Words.WaiverPanel.needSays
                else -> null
            }
        return NavLead("$word ${place(standing, card.teams)}", words)
    }

    /** position-nav.ts withoutRostered: a narrowed answer kept on screen while the next lands, less any free
     * agent the fresher answer has on the member's roster (claimed since). */
    fun withoutRostered(
        answer: WaiverAdvice,
        roster: List<PlayerLine>,
    ): WaiverAdvice {
        val mine = roster.map { it.player.hostId }.toSet()
        if (mine.isEmpty()) return answer
        return answer.copy(
            rows = answer.rows.filter { it.add.player.hostId !in mine },
            stash = answer.stash?.filter { it.add.player.hostId !in mine },
        )
    }

    /** position-nav.ts navSort: the list's order the toggle sets, the season Gain or this week's Proj. */
    fun sort(mode: PanelMode): WaiverSort = if (mode == PanelMode.Season) WaiverSort.Initial else WaiverSort(WaiverSortKey.Proj, true)

    /** position-nav.ts atPosition: the answer's rows at one position, until the position's own read lands. */
    fun atPosition(
        advice: WaiverAdvice,
        key: String,
    ): WaiverAdvice {
        if (key == ALL) return advice
        return advice.copy(
            rows = advice.rows.filter { it.add.player.position == key },
            stash = advice.stash?.filter { it.add.player.position == key },
        )
    }

    /** One answer's mark (WaiverScreen.svelte answerMark): when it was read and whose players the member
     * holds, so an unchanged answer reads the chosen position no second time. */
    internal fun mark(advice: WaiverAdvice): String = "${advice.readAt}|${advice.roster.joinToString(",") { it.player.hostId }}"
}
