package app.trycommish.core.trades

import app.trycommish.api.models.PlayerLine
import app.trycommish.api.models.TradeAdvice
import app.trycommish.api.models.TradeCheck
import app.trycommish.api.models.TradeCheckInput
import app.trycommish.api.models.TradeRow
import app.trycommish.api.models.TradeTeam
import app.trycommish.core.Format
import app.trycommish.core.shell.FollowedLeague
import app.trycommish.core.shell.initialsOf
import app.trycommish.core.start.RowCells
import app.trycommish.core.start.StartRows
import app.trycommish.core.start.StartWords
import app.trycommish.design.Words
import java.text.Collator
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

/** The side a tap picks on: the member's give, or their get. */
enum class PickSide { Give, Get }

/** The builder's picks (builder.ts Picks): the other team by roster id, null before one is chosen, and
 * each side's players by host id. */
data class TradePicks(
    val team: Int?,
    val give: List<String>,
    val get: List<String>,
) {
    fun players(side: PickSide): List<String> = if (side == PickSide.Give) give else get

    /** builder.ts toggle: picked when the side has room, put back when he is picked; a third waits. */
    fun tapped(
        side: PickSide,
        id: String,
    ): TradePicks {
        val list = players(side)
        val next =
            when {
                id in list -> list - id
                list.size < TradeBuilder.MAX_A_SIDE -> list + id
                else -> list
            }
        return if (side == PickSide.Give) copy(give = next) else copy(get = next)
    }

    /** builder.ts checkInput: the check to ask once a team is chosen and both sides hold a player. */
    val checkInput: TradeCheckInput?
        get() {
            val team = team ?: return null
            if (give.isEmpty() || get.isEmpty()) return null
            return TradeCheckInput(team, give, get)
        }
}

/** A roster row's tick (BoxPick): picked or not (held back while the side is full), none for a player no
 * trade takes, or the member's drop. */
sealed interface PickTick {
    data object Picked : PickTick

    data class Open(
        val disabled: Boolean,
    ) : PickTick

    data object None : PickTick

    data object Drop : PickTick
}

/** One roster row of the builder (TradeBox's BoxLine at 390): the box's cells, the phone's line (Avg and
 * Last, no Opp rank), his tick. */
data class BuilderRow(
    val cells: RowCells,
    val line: String,
    val tick: PickTick,
) {
    val id: String get() = cells.id
}

/** One roster as the builder's box draws it: the team, "You" on the member's, its standing, what the side
 * holds, its rows in the builder's order. */
data class BuilderBox(
    val team: String,
    val initials: String,
    val mine: Boolean,
    val aside: String,
    val holds: String,
    val rows: List<BuilderRow>,
)

/** The team the trade is with, by roster id and its choice's words. */
data class TeamChoice(
    val id: Int,
    val choice: String,
)

/** The builder's pin: "+5.7" strong with "a week for your lineup, +0.7 for theirs" once answered, the
 * answer line before. */
sealed interface BuilderPinWords {
    data class Gains(
        val mine: String,
        val rest: String,
    ) : BuilderPinWords

    data class Said(
        val words: String,
    ) : BuilderPinWords
}

/** The builder (TradeBuilder.svelte at 390): the team chosen by name and record, the scoreboard of each
 * side before and after, the answer line and the close call's chip, the builder's own line, the member's
 * roster then theirs, and the pin with the gains and the verb. */
data class TradeBuilderModel(
    val teams: List<TeamChoice>,
    val team: Int?,
    val bug: TradeBug,
    val sentence: String,
    /** The answer line is the prompt, not an answer: drawn quieter. */
    val quiet: Boolean,
    val close: String?,
    val own: String,
    val yours: BuilderBox,
    val theirs: BuilderBox?,
    val pin: BuilderPinWords,
    val verbEnabled: Boolean,
)

/** The member's side as the builder names it: the team and where it stands. */
data class TradeMe(
    val name: String,
    val aside: String,
) {
    companion object {
        /** The followed league's team and standing (TradeScreen's me: the switch's team name and model.ts
         * standingWords, "5-1, 2nd of 12"); "You" for a league whose team is unread. */
        fun of(league: FollowedLeague): TradeMe {
            val aside =
                league.standing?.let {
                    val record = "${it.wins}-${it.losses}"
                    val words = if (it.ties > 0) "$record-${it.ties}" else record
                    "$words, ${Format.ordinal(it.place)} of ${it.teams}"
                }
            return TradeMe(league.teamName.ifEmpty { Words.Box.you }, aside.orEmpty())
        }
    }
}

/** builder.ts and TradeBuilder.svelte's reads. */
object TradeBuilder {
    const val MAX_A_SIDE = 2
    private val traded = setOf("QB", "RB", "WR", "TE")
    private val positionOrder = listOf("QB", "RB", "WR", "TE", "K", "DEF")
    private val names = Collator.getInstance(Locale.US)

    /** What the builder reads to draw itself. */
    class Inputs(
        val advice: TradeAdvice,
        val picks: TradePicks,
        val answer: TradeCheck?,
        val problem: String?,
        val me: TradeMe,
        val pageKnown: Boolean,
        val zone: ZoneId,
        val now: Instant,
    )

    /** builder.ts pickable: at QB, RB, WR or TE, named by the platform, not on injured reserve. */
    fun pickable(line: PlayerLine): Boolean =
        line.player.position in traded && line.player.hostId.isNotEmpty() && !StartRows.onReserve(line)

    /** builder.ts teamChoice: "Muttdogs, muttdog, 5-0". */
    fun choice(team: TradeTeam): String = "${team.name}, ${aside(team)}"

    /** words.ts teamAside: its owner and its record, the record alone where the team is named for him. */
    fun aside(team: TradeTeam): String {
        val record = team.record
        val base = "${record.wins}-${record.losses}"
        val words = if (record.ties > 0) "$base-${record.ties}" else base
        val owner = team.owner.trim()
        val named = owner.isEmpty() || owner.lowercase() == team.name.trim().lowercase()
        return if (named) words else "$owner, $words"
    }

    /** builder.ts pickPrompt. */
    fun prompt(picks: TradePicks): String =
        when {
            picks.give.isNotEmpty() && picks.get.isNotEmpty() -> Words.Builder.checking
            picks.give.isEmpty() && picks.get.isEmpty() -> Words.Builder.pickBoth
            picks.give.isEmpty() -> Words.Builder.pickYours
            else -> Words.Builder.pickTheirs
        }

    /** trades.ts rosterOrder: injured reserve last, by position, each by this week's Proj highest first
     * (none after), then by name. A stable sort, as JavaScript's. */
    fun rosterOrder(lines: List<PlayerLine>): List<PlayerLine> {
        val place = { line: PlayerLine -> positionOrder.indexOf(line.player.position).let { if (it < 0) positionOrder.size else it } }
        val reserve = { line: PlayerLine -> if (StartRows.onReserve(line)) 1 else 0 }
        val proj = { line: PlayerLine -> line.weekProjection ?: Double.NEGATIVE_INFINITY }
        return lines.sortedWith(
            compareBy<PlayerLine>(reserve, place)
                .thenByDescending(proj)
                .thenComparator { a, b -> names.compare(a.player.name, b.player.name) },
        )
    }

    /** The builder at its picks and its answer, as TradeBuilder draws it. */
    fun model(inputs: Inputs): TradeBuilderModel {
        val picks = inputs.picks
        val team = inputs.advice.teams.firstOrNull { it.rosterId == picks.team }
        val check = inputs.answer?.let { TradeChecks.held(it, inputs.now) }
        val trade = check?.trade
        val dropId = trade?.drop?.player?.hostId
        val room = check?.let(TradeChecks::room) ?: TradeRoom("", "")
        val sentence = inputs.problem ?: check?.let(TradeChecks::words) ?: prompt(picks)
        val box = { side: PickSide, lines: List<PlayerLine>, name: String, mine: Boolean, aside: String ->
            BuilderBox(
                team = name,
                initials = initialsOf(name),
                mine = mine,
                aside = aside,
                holds = holds(picks, side),
                rows = rosterOrder(lines).map { row(it, tick(it, side, picks, dropId), inputs) },
            )
        }
        return TradeBuilderModel(
            teams = inputs.advice.teams.map { TeamChoice(it.rosterId, choice(it)) },
            team = picks.team,
            bug =
                TradeBug(
                    TradeBugSide.of(true, inputs.me.name, check?.totals?.yours, trade?.myGain, trade?.myProjChange, room.yours),
                    TradeBugSide.of(
                        false,
                        team?.name.orEmpty(),
                        check?.totals?.theirs,
                        trade?.theirGain,
                        trade?.theirProjChange,
                        room.theirs,
                    ),
                ),
            sentence = sentence,
            quiet = check == null && inputs.problem == null,
            close = check?.let(::closeCall),
            own = check?.basis ?: inputs.advice.checkBasis,
            yours = box(PickSide.Give, inputs.advice.roster, inputs.me.name, true, inputs.me.aside),
            theirs = team?.let { box(PickSide.Get, it.roster, it.name, false, aside(it)) },
            pin = pin(check, sentence),
            verbEnabled = inputs.pageKnown && check != null,
        )
    }

    /** The pin's line: why a side would not take it (TradeBuilder.svelte's refusal, Lane 277), else the
     * two gains a week, else the answer line. */
    private fun pin(
        check: TradeCheck?,
        sentence: String,
    ): BuilderPinWords {
        val refusal = check?.takeIf(TradeChecks::fillsBoth)?.let(TradeChecks::refusal)
        if (refusal != null) return BuilderPinWords.Said(refusal)
        val trade = check?.trade ?: return BuilderPinWords.Said(sentence)
        return BuilderPinWords.Gains(
            TradesWords.gain(trade.myGain),
            "${Words.Trades.aWeekForYou}, ${TradesWords.gain(trade.theirGain)} ${Words.Trades.forTheirs}",
        )
    }

    /** TradeBuilder's close: a trade both rosters take that the member gains from, a close call for them. */
    private fun closeCall(check: TradeCheck): String? {
        val fills = check.fills
        val trade = check.trade
        val takes = fills.yours && fills.theirs && fills.yoursRoom && fills.theirsRoom
        return if (takes && trade.myGain > 0 && trade.closeForThem && trade.theirGain > 0) Words.TradePicker.closeForThem else null
    }

    /** TradeBuilder's holdsWords: "You give 1", or the full side's words. */
    private fun holds(
        picks: TradePicks,
        side: PickSide,
    ): String {
        val count = picks.players(side).size
        if (count >= MAX_A_SIDE) return Words.Builder.full
        return "${if (side == PickSide.Give) Words.Builder.give else Words.Builder.get} $count"
    }

    /** TradeBuilder's tickOf. */
    private fun tick(
        line: PlayerLine,
        side: PickSide,
        picks: TradePicks,
        dropId: String?,
    ): PickTick {
        val id = line.player.hostId
        if (side == PickSide.Give && id == dropId) return PickTick.Drop
        if (!pickable(line)) return PickTick.None
        val list = picks.players(side)
        return if (id in list) PickTick.Picked else PickTick.Open(disabled = list.size >= MAX_A_SIDE)
    }

    private fun row(
        line: PlayerLine,
        tick: PickTick,
        inputs: Inputs,
    ): BuilderRow {
        val cells = RowCells.of(null, StartRows.row(line, "", inputs.zone, inputs.now, ranked = false), null)
        val words = "${Words.Box.avg} ${StartWords.number(cells.row.avg)}, ${Words.Box.last} ${StartWords.number(cells.row.last)}"
        return BuilderRow(cells, words, tick)
    }

    /** The opening picks for Build a trade: the first team with a trade found, else the first team. */
    fun opening(advice: TradeAdvice): TradePicks {
        val first = advice.teams.firstOrNull { it.trades.isNotEmpty() } ?: advice.teams.firstOrNull()
        return TradePicks(first?.rosterId, emptyList(), emptyList())
    }

    /** builder.ts builtFrom: a finder row as picks, null when a player in it has no host id. */
    fun built(
        team: Int,
        row: TradeRow,
    ): TradePicks? {
        val give = row.give.map { it.player.hostId }
        val get = row.get.map { it.player.hostId }
        return if ((give + get).any { it.isEmpty() }) null else TradePicks(team, give, get)
    }
}
