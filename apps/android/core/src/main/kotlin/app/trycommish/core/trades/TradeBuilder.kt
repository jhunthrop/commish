package app.trycommish.core.trades

import app.trycommish.api.models.PlayerLine
import app.trycommish.api.models.TradeAdvice
import app.trycommish.api.models.TradeCheck
import app.trycommish.api.models.TradeCheckInput
import app.trycommish.api.models.TradeRow
import app.trycommish.api.models.TradeTeam
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.initialsOf
import app.trycommish.core.start.RowCells
import app.trycommish.core.start.StartRows
import app.trycommish.design.Words
import java.text.Collator
import java.time.Instant
import java.time.ZoneId
import java.util.Locale
import kotlin.math.abs

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

    /** builder.ts samePicks: the same trade in any order of ticks, so the idea the ticks hold is pressed. */
    fun same(other: TradePicks): Boolean = team == other.team && give.toSet() == other.give.toSet() && get.toSet() == other.get.toSet()
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

/** One roster row of the builder (TradeBox's tight BoxLine at 390): the box's cells and his tick. */
data class BuilderRow(
    val cells: RowCells,
    val tick: PickTick,
) {
    val id: String get() = cells.id
}

/** One roster as the builder's box draws it: the team, "You" on the member's, its standing, what the side
 * holds, its rows in the builder's order. Their box before a team is chosen has no team and no rows, its
 * head the team choice alone. */
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

/** The roster switch where the rosters stack (TradeBuilder's .switch): "You, 1" and "Max_Jensen10, 2",
 * "Pick a team" before one is chosen. */
data class RosterSwitch(
    val yours: String,
    val theirs: String,
)

/** The builder's pin: "+5.3" strong with "a week for your lineup, +1.1 for theirs" once answered on a
 * trade both rosters can make, who would not take it, or the answer line. */
sealed interface BuilderPinWords {
    data class Gains(
        val mine: String,
        val rest: String,
    ) : BuilderPinWords

    data class Said(
        val words: String,
    ) : BuilderPinWords
}

/** The builder as the screen (TradeBuilder.svelte at 390, Lanes 260, 268, 277): our ideas row, the roster
 * switch, the member's roster or theirs with the team chosen at its head, the verdict (one box-score row
 * per side) with the answer line, the close call's chip and the builder's own lines, and the pin with the
 * gains, Share and the verb. */
data class TradeBuilderModel(
    val ideas: List<IdeaPlace>,
    val ideasHead: String,
    /** "8 more", null once every idea shows. */
    val more: String?,
    /** The first place (an offer or an idea) the ticks hold, pressed. */
    val pressed: String?,
    val rosters: RosterSwitch,
    val teams: List<TeamChoice>,
    val team: Int?,
    /** The team choice as its box shows it: "Max_Jensen10, 1-4", or "Pick a team". */
    val teamLabel: String,
    val bug: TradeBug,
    val sentence: String,
    /** The answer line is the prompt, not an answer: drawn quieter. */
    val quiet: Boolean,
    val close: String?,
    /** The platform's reason the verb cannot propose from here, or its note when it has no page. */
    val hostLine: String?,
    val own: String,
    val yours: BuilderBox,
    val theirs: BuilderBox,
    val pin: BuilderPinWords,
    /** Propose and Share act on the answer only for the team and ticks it was read for, on a trade both
     * rosters can make (builder.ts proposable). */
    val live: Boolean,
    val verbEnabled: Boolean,
) {
    /** Every player both rosters show in the sheet. */
    val sheetPlayers: List<SheetPlayer> get() = (yours.rows + theirs.rows).mapNotNull { it.cells.sheetPlayer }
}

/** builder.ts and TradeBuilder.svelte's reads. */
object TradeBuilder {
    const val MAX_A_SIDE = 2

    /** builder.ts BAR_FLOOR: the least a full bar stands for, in points a week. */
    private const val BAR_FLOOR = 1.0
    private val traded = setOf("QB", "RB", "WR", "TE")
    private val positionOrder = listOf("QB", "RB", "WR", "TE", "K", "DEF")
    private val names = Collator.getInstance(Locale.US)

    /** What the builder reads to draw itself. */
    class Inputs(
        val advice: TradeAdvice,
        val ideas: TradeIdeas,
        /** Whether the ideas row shows every idea. */
        val allIdeas: Boolean,
        val picks: TradePicks,
        /** The last answer and the picks it was read for. */
        val answer: TradeCheck?,
        val answered: TradePicks?,
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

    /** builder.ts countWords: ", 1" after a side's name on the switch, nothing while none is ticked. */
    private fun count(side: List<String>): String = if (side.isEmpty()) "" else ", ${side.size}"

    /** builder.ts gainBars: each side's gain as a share of the longer one (at least the floor), 0 to 1. */
    fun bars(
        mine: Double?,
        theirs: Double?,
    ): Pair<Double, Double> {
        val yours = abs(mine ?: 0.0)
        val their = abs(theirs ?: 0.0)
        val full = maxOf(yours, their, BAR_FLOOR)
        return yours / full to their / full
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
        val sentence =
            inputs.problem ?: if (team == null) Words.Analyzer.noTeam else check?.let(TradeChecks::words) ?: prompt(picks)
        val live = team != null && check != null && TradeChecks.fillsBoth(check) && inputs.answered?.same(picks) == true
        val ideas = inputs.ideas.at(inputs.now)
        return TradeBuilderModel(
            ideas = ideas.visible(inputs.allIdeas),
            ideasHead = ideas.head,
            more = ideas.more(inputs.allIdeas),
            pressed = ideas.places.firstOrNull { it.picks?.same(picks) == true }?.key,
            rosters =
                RosterSwitch(
                    "${Words.Analyzer.you}${count(picks.give)}",
                    "${team?.name ?: Words.Analyzer.pickTeam}${count(picks.get)}",
                ),
            teams = inputs.advice.teams.map { TeamChoice(it.rosterId, choice(it)) },
            team = picks.team,
            teamLabel = team?.let(::choice) ?: Words.Analyzer.pickTeam,
            bug = bug(check, inputs.me.name, team?.name.orEmpty()),
            sentence = sentence,
            quiet = check == null && inputs.problem == null,
            close = check?.let(::closeCall),
            hostLine = inputs.advice.moves.reason ?: inputs.advice.hostNote,
            own = check?.basis ?: inputs.advice.checkBasis,
            yours = yours(inputs, check),
            theirs = theirs(inputs, team, check),
            pin = pin(check, sentence),
            live = live,
            verbEnabled = live && inputs.pageKnown,
        )
    }

    /** The verdict's two rows (TradeBug over bugFigures, checkRoom, gainBars and restFigure). */
    fun bug(
        check: TradeCheck?,
        me: String,
        team: String,
    ): TradeBug {
        val trade = check?.trade
        val room = check?.let(TradeChecks::room) ?: TradeRoom("", "")
        val (yours, theirs) = bars(trade?.myGain, trade?.theirGain)
        return TradeBug(
            TradeBugSide.of(
                true,
                me,
                check?.totals?.yours,
                trade?.myGain,
                trade?.myProjChange,
                room.yours,
                TradeRest.of(check, mine = true),
                yours,
            ),
            TradeBugSide.of(
                false,
                team,
                check?.totals?.theirs,
                trade?.theirGain,
                trade?.theirProjChange,
                room.theirs,
                TradeRest.of(check, mine = false),
                theirs,
            ),
        )
    }

    private fun yours(
        inputs: Inputs,
        check: TradeCheck?,
    ): BuilderBox =
        BuilderBox(
            team = inputs.me.name,
            initials = initialsOf(inputs.me.name),
            mine = true,
            aside = inputs.me.aside,
            holds = holds(inputs.picks, PickSide.Give),
            rows = rows(inputs, PickSide.Give, inputs.advice.roster, check),
        )

    /** Their box, empty before a team is chosen. */
    private fun theirs(
        inputs: Inputs,
        team: TradeTeam?,
        check: TradeCheck?,
    ): BuilderBox =
        BuilderBox(
            team = team?.name.orEmpty(),
            initials = team?.let { initialsOf(it.name) }.orEmpty(),
            mine = false,
            aside = team?.let(::aside).orEmpty(),
            holds = if (team == null) "" else holds(inputs.picks, PickSide.Get),
            rows = rows(inputs, PickSide.Get, team?.roster.orEmpty(), check),
        )

    private fun rows(
        inputs: Inputs,
        side: PickSide,
        lines: List<PlayerLine>,
        check: TradeCheck?,
    ): List<BuilderRow> {
        val dropId =
            check
                ?.trade
                ?.drop
                ?.player
                ?.hostId
        return rosterOrder(lines).map { line ->
            val cells = RowCells.of(null, StartRows.row(line, "", inputs.zone, inputs.now, ranked = false), null)
            BuilderRow(cells, tick(line, side, inputs.picks, dropId))
        }
    }

    /** The pin's line (TradeBuilder.svelte's .pin-gains): why a side would not take it (Lane 277), else the
     * two gains a week on a trade both rosters can make, else the answer line. */
    private fun pin(
        check: TradeCheck?,
        sentence: String,
    ): BuilderPinWords {
        if (check == null || !TradeChecks.fillsBoth(check)) return BuilderPinWords.Said(sentence)
        TradeChecks.refusal(check)?.let { return BuilderPinWords.Said(it) }
        return BuilderPinWords.Gains(
            TradesWords.gain(check.trade.myGain),
            "${Words.Trades.aWeekForYou}, ${TradesWords.gain(check.trade.theirGain)} ${Words.Trades.forTheirs}",
        )
    }

    /** TradeBuilder's close: a trade both rosters take that the member gains from, a close call for them. */
    private fun closeCall(check: TradeCheck): String? {
        val trade = check.trade
        return if (TradeChecks.fillsBoth(check) && trade.myGain > 0 && trade.closeForThem && trade.theirGain > 0) {
            Words.TradePicker.closeForThem
        } else {
            null
        }
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
