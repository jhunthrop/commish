package app.trycommish.core.trades

import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.PlayerLine
import app.trycommish.api.models.TradeAdvice
import app.trycommish.api.models.TradeRow
import app.trycommish.api.models.TradeTeam
import app.trycommish.core.leaguehome.ValueWords
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.initialsOf
import app.trycommish.core.start.Move
import app.trycommish.core.start.RowCells
import app.trycommish.core.start.StartRows
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId

/** A gain as its cell prints it, with its ink. */
data class GainCell(
    val words: String,
    val tone: Tone,
) {
    companion object {
        fun of(value: Double): GainCell = GainCell(TradesWords.gain(value), TradesWords.tone(value))
    }
}

/** A card of the strip (TradeStrip.svelte): the other team, both sides by last name, both gains, the need
 * it fills, its week, the drop; the first of two says Best and draws its verb solid. */
data class StripCard(
    val key: String,
    val mark: String?,
    val lead: Boolean,
    val team: String,
    val initials: String,
    val give: String,
    val get: String,
    val mine: String,
    val theirs: String,
    val need: String?,
    val week: String?,
    val drop: String?,
    val dropReason: String?,
) {
    /** The need, the week and the drop with its sentence, each a line where the card has it. */
    val lines: List<String> get() = listOfNotNull(need, week, drop, dropReason)
}

/** The strip: the week, how many trades are worth proposing, the platform's reason (kept for parity, left
 * to the desk on a phone), each card. */
data class TradesStrip(
    val week: String,
    val title: String,
    val reason: String?,
    val cards: List<StripCard>,
)

/** One side of an opened trade: "From McConkey Kong Country, you" over the give and the drop, "From
 * Max_Jensen10" over the get, each row in the box score's cells. */
data class TradeGroup(
    val head: String,
    val rows: List<RowCells>,
)

/** A trade's players opened (TradeFinder's opened row at 390): its week in one line, the drop's sentence,
 * both sides. */
data class OpenedTrade(
    val week: String?,
    val dropReason: String?,
    val groups: List<TradeGroup>,
) {
    /** The week and the drop's sentence, each a line where the trade has it. */
    val lines: List<String> get() = listOfNotNull(week, dropReason)
}

/** One trade of the finder as a phone draws it: you give, you get, with whom and your drop, the need it
 * fills, both gains; the offer its verb copies, its players opened, and the builder's picks from it. */
data class TradeLine(
    /** The web's tradeKey: the team and both sides' platform ids, so a re-read keeps a row open. */
    val key: String,
    val team: String,
    val give: String,
    val get: String,
    val with: String,
    val need: String?,
    val mine: GainCell,
    val theirs: GainCell,
    /** The share text (trades.ts offerText). */
    val offer: String,
    val opened: OpenedTrade,
    /** The builder's picks from this trade (Build from this, builder.ts builtFrom), null when a player in it
     * has no platform id. */
    val built: TradePicks?,
)

/** A player the Trades holding picker offers: his key (state.ts pickKey) and his name. */
data class PickOption(
    val key: String,
    val name: String,
)

/** The Trades holding picker (TradeScreen's PickSelect): every trade first, then your players, then theirs
 * from the trades found, each once; the one chosen. */
data class TradePicker(
    val yours: List<PickOption>,
    val theirs: List<PickOption>,
    val chosen: String?,
) {
    /** The chosen player's name, or Every trade. */
    val label: String get() = (yours + theirs).firstOrNull { it.key == chosen }?.name ?: Words.TradePicker.every
}

/** What the basis says the screen draws: the finder alone, a trade's players opened, or the builder. */
enum class TradesOpened { None, Trade, Builder }

/** The finder's two orders a phone sorts by: your gain, their gain (TradeFinder's phone heads). */
enum class TradeSort(
    val key: String,
    val head: String,
) {
    Mine("mine", Words.Trades.yourGain),
    Theirs("theirs", Words.Trades.theirGain),
}

/** A team the finder lists no trade with (builder.ts noIdeasFrom, B271): every idea it found with them,
 * they would not take (Lane 269), so its place says so rather than leaving the team out. */
data class NoIdeaLine(
    val id: Int,
    val team: String,
    /** "With Carried by QJs", over its line. */
    val with: String,
    /** "No idea they would take." */
    val note: String,
) {
    companion object {
        /** The teams with no trade, in the answer's order. */
        fun of(teams: List<TradeTeam>): List<NoIdeaLine> =
            teams.filter { it.trades.isEmpty() }.map {
                NoIdeaLine(it.rosterId, it.name, "${Words.Trades.with} ${it.name}", Words.Trades.noIdea)
            }
    }
}

/**
 * The Trades screen at one read (TradeScreen.svelte at 390): the decision as a strip, the chips, the
 * finder in the chosen order, the verb, the basis with no trade opened, with one, and with the builder.
 * The answer drawn at `now`, the member's team named `me`, every trade or each team's best, in `sort`'s
 * order; with a player picked, the trades holding him from the narrowed answer (the web's shown), or
 * none where it was not read. Every rule is the API's; nothing is computed but the words and the order.
 */
class TradesModel(
    answer: TradeAdvice,
    narrowed: TradeAdvice? = null,
    holding: String? = null,
    host: LeagueHost,
    me: String,
    showsEvery: Boolean,
    sort: TradeSort,
    now: Instant,
    zone: ZoneId,
) {
    private val advice: TradeAdvice = TradeFinder.held(answer, now)
    private val shown: TradeAdvice = narrowed?.let { TradeFinder.held(it, now) } ?: advice
    private val worth = TradeFinder.worthProposing(advice.teams)

    val platform: String = ValueWords.platform(host)
    val picker: TradePicker = TradeFinder.picker(advice, holding)

    /** No trade found holds the player picked: the decision says so in place of the strip. */
    val noneHolding: Boolean = holding?.let { !TradeFinder.holds(shown.teams, it) } ?: false

    val decision: String =
        if (noneHolding) {
            TradesWords.noTradeWith(picker.label)
        } else {
            worth.firstOrNull().let { TradesWords.decision(it?.row, it?.team?.name.orEmpty()) }
        }

    val strip: TradesStrip? =
        if (worth.isEmpty() || noneHolding) {
            null
        } else {
            TradesStrip(
                week = "${Words.Trades.weekWord} ${advice.forWeek ?: advice.week}",
                title = TradesWords.worthTitle(worth.size),
                reason = advice.moves.reason,
                cards = worth.mapIndexed { index, entry -> card(entry, index, worth.size) },
            )
        }

    val best: String = "${Words.Trades.best}, ${advice.teams.count { it.trades.isNotEmpty() }}"
    val every: String = "${Words.Trades.every}, ${advice.teams.sumOf { it.trades.size }}"
    val gainBasis: String? = advice.gainBasis
    val verb: String = TradesWords.verb(advice.moves, platform)

    /** The platform's trade page the verb opens; null when the API knows none, and the verb stands
     * disabled with [reason] under it. */
    val page: String? = advice.hostTradesUrl.ifEmpty { null }
    val reason: String? = if (advice.hostTradesUrl.isEmpty()) advice.hostNote else null

    /** The builder's opening picks for Build a trade. */
    val opening: TradePicks = TradeBuilder.opening(advice)

    /** Each team the finder lists no trade with, its line in its place under the rows (B271), none
     * while a player is picked. */
    val noIdeas: List<NoIdeaLine> = if (holding == null) NoIdeaLine.of(advice.teams) else emptyList()

    val rows: List<TradeLine> =
        TradeFinder
            .sorted(TradeFinder.rows(TradeFinder.holding(shown.teams, holding), showsEvery), sort)
            .map { line(it, me, zone, now) }

    private val bases: Map<TradesOpened, String> =
        run {
            val lines = advice.roster + advice.teams.flatMap { team -> team.roster + team.trades.flatMap { it.give + it.get } }
            TradesOpened.entries.associateWith { TradesBasis.phone(TradesBasis.Facts(shown, host, lines, it, zone, now)) }
        }

    /** The basis as the screen stands: closed, a trade opened, or the builder open. */
    fun basis(opened: TradesOpened): String = bases[opened].orEmpty()

    /** Every player an opened row shows in the sheet. */
    val sheetPlayers: List<SheetPlayer> get() =
        rows
            .flatMap { line ->
                line.opened.groups.flatMap { it.rows }
            }.mapNotNull { it.sheetPlayer }

    /** A row by its key. */
    fun row(key: String): TradeLine? = rows.firstOrNull { it.key == key }

    private fun card(
        entry: TradeFinder.Entry,
        index: Int,
        count: Int,
    ): StripCard {
        val row = entry.row
        return StripCard(
            key = entry.key,
            mark = if (index == 0 && count > 1) Words.Strip.best else null,
            lead = index == 0,
            team = entry.team.name,
            initials = initialsOf(entry.team.name),
            give = TradesWords.shortSide(row.give),
            get = TradesWords.shortSide(row.get),
            mine = TradesWords.gain(row.myGain),
            theirs = TradesWords.gain(row.theirGain),
            need = row.need,
            week = TradesWords.weekLine(row),
            drop = if (row.drop == null) null else TradesWords.yourRoom(row),
            dropReason = row.dropReason,
        )
    }

    private fun line(
        entry: TradeFinder.Entry,
        me: String,
        zone: ZoneId,
        now: Instant,
    ): TradeLine {
        val row = entry.row
        val cells = { line: PlayerLine, side: String, move: Move ->
            RowCells.trade(StartRows.row(line, side, zone, now, ranked = false), move)
        }
        val yours =
            row.give.map { cells(it, Words.Trades.sideGive, Move.Out) } +
                listOfNotNull(row.drop).map { cells(it, Words.Trades.sideDrop, Move.Out) }
        val theirs = row.get.map { cells(it, Words.Trades.sideGet, Move.Into) }
        return TradeLine(
            key = entry.key,
            team = entry.team.name,
            give = TradesWords.shortSide(row.give),
            get = TradesWords.shortSide(row.get),
            with = TradesWords.phoneWith(entry.team.name, row),
            need = row.need,
            mine = GainCell.of(row.myGain),
            theirs = GainCell.of(row.theirGain),
            offer = TradesWords.offer(entry.team.name, row),
            opened =
                OpenedTrade(
                    week = TradesWords.weekLine(row),
                    dropReason = row.dropReason,
                    groups =
                        listOf(
                            TradeGroup(TradesWords.from(me, mine = true), yours),
                            TradeGroup(TradesWords.from(entry.team.name, mine = false), theirs),
                        ),
                ),
            built = TradeBuilder.built(entry.team.rosterId, row),
        )
    }
}

/** trades.ts's finder: its rows, their orders, the strip's picks, the picker, the held week. */
object TradeFinder {
    /** A trade of the finder with its team and its key. */
    class Entry(
        val key: String,
        val team: TradeTeam,
        val row: TradeRow,
    )

    /** The prefix of a picker key for a player our board does not place (state.ts pickKey's own prefix
     * names the platform's id field, a word the copy guard keeps out of sources). */
    const val UNPLACED = "platform:"

    /** state.ts tradeKey: "8:96>12481+8116". */
    fun key(
        team: Int,
        row: TradeRow,
    ): String {
        val ids = { side: List<PlayerLine> -> side.map { it.player.hostId }.sorted().joinToString("+") }
        return "$team:${ids(row.give)}>${ids(row.get)}"
    }

    /** The API's order across teams: the trades they gain from first, then the close calls for them, each
     * by your gain, then theirs. */
    private val apiOrder: Comparator<Entry> =
        compareBy<Entry> { it.row.closeForThem }
            .thenByDescending { it.row.myGain }
            .thenByDescending { it.row.theirGain }

    /** trades.ts finderRows: each team's first trade, or every trade, in the API's order (a stable sort, as
     * JavaScript's). */
    fun rows(
        teams: List<TradeTeam>,
        every: Boolean,
    ): List<Entry> =
        teams
            .flatMap { team -> (if (every) team.trades else team.trades.take(1)).map { Entry(key(team.rosterId, it), team, it) } }
            .sortedWith(apiOrder)

    /** trades.ts sortRows: best first by the column, ties in the API's order. */
    fun sorted(
        entries: List<Entry>,
        sort: TradeSort,
    ): List<Entry> {
        val figure = { entry: Entry -> if (sort == TradeSort.Mine) entry.row.myGain else entry.row.theirGain }
        return entries.sortedWith(compareByDescending(figure).then(apiOrder))
    }

    /** trades.ts worthProposing: each team's best the other team gains from, at most two. */
    fun worthProposing(teams: List<TradeTeam>): List<Entry> =
        rows(teams, every = false).filter { !it.row.closeForThem && it.row.myGain > 0 }.take(2)

    /** state.ts pickKey: his board id, or his platform id where our board does not place him. */
    private fun pickKey(line: PlayerLine): String = line.player.boardId ?: "$UNPLACED${line.player.hostId}"

    /** state.ts pickerPlayers: your roster, then theirs from the trades found, each once. */
    fun picker(
        advice: TradeAdvice,
        chosen: String?,
    ): TradePicker {
        val theirs =
            advice.teams
                .flatMap { team -> team.trades.flatMap { it.get } }
                .filter { it.player.boardId != null }
                .distinctBy { it.player.boardId }
        val option = { line: PlayerLine -> PickOption(pickKey(line), line.player.name) }
        return TradePicker(advice.roster.map(option), theirs.map(option), chosen)
    }

    /** state.ts tradeHolding: a trade found holds the player, by board id. */
    fun holds(
        teams: List<TradeTeam>,
        key: String,
    ): Boolean = teams.any { team -> team.trades.any { holds(it, key) } }

    private fun holds(
        row: TradeRow,
        key: String,
    ): Boolean = (row.give + row.get).any { it.player.boardId == key }

    /** TradeScreen's teams: each team's trades holding the player picked, every trade with none. */
    fun holding(
        teams: List<TradeTeam>,
        player: String?,
    ): List<TradeTeam> = if (player == null) teams else teams.map { team -> team.copy(trades = team.trades.filter { holds(it, player) }) }

    /** trades.ts heldTrades: every trade's week change held once a player it moves has kicked off. */
    fun held(
        advice: TradeAdvice,
        now: Instant,
    ): TradeAdvice = advice.copy(teams = advice.teams.map { team -> team.copy(trades = team.trades.map { TradeChecks.held(it, now) }) })
}
