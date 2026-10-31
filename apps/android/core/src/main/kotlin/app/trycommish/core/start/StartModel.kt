package app.trycommish.core.start

import app.trycommish.api.models.HostMoveChange
import app.trycommish.api.models.HostMoveInput
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.LineupAdvice
import app.trycommish.api.models.LineupMoves
import app.trycommish.core.Format
import app.trycommish.core.leaguehome.HostWords
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId

/** One row's cells as the phone draws them (BoxLine and BoxPlayer at 390): the slot with the move's
 * arrow, the player, Our rank, Proj and Pts, the evidence line with the Opp rank's tint. */
data class RowCells(
    val row: StartRow,
    val move: Move?,
    val idle: Boolean,
    val why: String?,
    /** "" on an injured reserve row, the rank, or "--". */
    val rank: String,
    val game: RowGame,
    /** Said in place of the game: why a bench player on injured reserve is a drop. */
    val note: String?,
    val proj: String,
    val pts: String,
    /** "Opp 2nd, Avg 23.3, Last 19.0". */
    val evidence: String,
    /** The Opp rank's own words, tinted by [ease] while his game is to come. */
    val oppRank: String?,
    val ease: Ease,
    /** His rest-of-season points a game, "--" without one (the Trades rows' last cell). */
    val season: String = Words.Box.none,
) {
    val id: String get() = row.id

    /** The player the row's name opens in the sheet, by his platform id: null where the site has no page
     * for him (a kicker, a defense, a shared name), as the web's row draws no link. */
    val sheetPlayer: SheetPlayer?
        get() =
            row.slug?.let {
                SheetPlayer(
                    row.id,
                    it,
                    row.name,
                    row.position,
                    row.rank?.toString() ?: row.status?.rank,
                    row.club,
                    row.headshot,
                    boardId = row.boardId,
                )
            }

    companion object {
        fun of(
            entry: LineupEntry?,
            plain: StartRow,
            reserve: ReserveRow?,
        ): RowCells {
            val row = plain.reserved(reserve)
            val opp = row.oppRank?.let(Format::ordinal)
            val pairs = listOf("${Words.Box.avg} ${StartWords.number(row.avg)}", "${Words.Box.last} ${StartWords.number(row.last)}")
            return RowCells(
                row = row,
                move = entry?.move,
                idle = entry?.idle ?: false,
                why = entry?.why,
                rank = if (reserve != null) "" else row.rank?.toString() ?: Words.Box.none,
                game = row.game,
                note = if (reserve == ReserveRow.Bench) Words.Box.irBench else null,
                proj = StartWords.number(row.proj),
                pts = StartWords.number(row.pts),
                evidence = (listOfNotNull(opp?.let { "${Words.Box.opp} $it" }) + pairs).joinToString(", "),
                oppRank = opp,
                ease = row.oppRank?.let { if (row.toCome) StartRows.ease(it, row.oppOf) else Ease.Even } ?: Ease.Even,
                season = StartWords.number(row.season),
            )
        }

        /** A trade's row (TradeFinder's opened players): which way he moves for the member, his side in
         * the slot's cell. */
        fun trade(
            row: StartRow,
            move: Move,
        ): RowCells = of(null, row, null).copy(move = move)
    }
}

/** The Team row (LineupTable totals, TeamFigures): its note, the Proj cell (the projected final or the
 * final total captioned once a starter has kicked off) and the Pts. */
data class TeamRow(
    val note: String?,
    /** Pts is the big figure from kickoff, the Proj before it. */
    val live: Boolean,
    val caption: String?,
    val proj: String,
    val pts: String,
)

/** A chip in the strip: a spot no one can play, or a swap as the phone names it ("QB", "Mahomes in"). */
sealed interface StripChip {
    val key: String

    data class Idle(
        val words: String,
    ) : StripChip {
        override val key: String get() = "idle-$words"
    }

    data class SwapChip(
        val swap: Swap,
    ) : StripChip {
        override val key: String get() = "swap-${swap.id}"
    }
}

/** The verb the screen pins above the bar: the changes made on the platform from here, or the lineup
 * copied for the platform's own page (StartScreen.svelte). */
enum class StartVerb(
    val title: String,
) {
    Make(Words.Lineup.make),
    Copy(Words.Lineup.copy),
}

/** A run of the line under the verb: words, or words that open a page. */
data class FootRun(
    val text: String,
    val url: String? = null,
)

/** The Start screen at one clock (StartScreen.svelte at 390): the strip, the lineup, the Team row, the
 * bench and the injured reserve, the basis once, and the one verb with the line under it. */
data class StartModel(
    val week: String,
    val title: String,
    /** The decision in one sentence, the strip's name for TalkBack (words.ts lineupDecision). */
    val decision: String,
    val sum: StripSum?,
    /** The API's sentence once every starter has kicked off, in the sum's place. */
    val done: String?,
    val missed: String?,
    val chips: List<StripChip>,
    val starters: List<RowCells>,
    /** Spots empty on the platform that no one who can play fills: their slot words. */
    val empty: List<String>,
    val team: TeamRow,
    val bench: List<RowCells>,
    val reserve: List<RowCells>,
    val basis: String,
    val platform: String,
    /** The verb, null with nothing to change (the lineup set, or every starter kicked off). */
    val verb: StartVerb?,
    /** The platform's lineup page, null when the API knows none. */
    val page: String?,
    /** The line under the verb before it is pressed. */
    val foot: List<List<FootRun>>,
    /** The move the verb plans: each changed slot's player in and the starter it sits. */
    val move: HostMoveInput,
    /** The lineup as the copy verb puts it on the clipboard. */
    val copyText: String,
    /** The advice's swaps, which the sheet's verb says under it for the row they name. */
    val swaps: List<Swap> = emptyList(),
) {
    /** lineup.ts swapOf and swapWords: the swap that names his row, as the strip says it ("QB, Dart in,
     * Rodgers out"); null where none does. */
    fun swapLine(row: StartRow): String? {
        val short = LineupBoxes.shortName(row.name)
        return swaps.firstOrNull { it.id == row.id || it.out == short }?.let(StartWords::swap)
    }

    /** The row whose player the sheet shows, by his id. */
    fun rowOf(player: SheetPlayer): StartRow? = (starters + bench + reserve).firstOrNull { it.sheetPlayer?.id == player.id }?.row

    /** Every row that carries a player the sheet can open, for the sheet to keep its player by. */
    val sheetPlayers: List<SheetPlayer> get() = (starters + bench + reserve).mapNotNull { it.sheetPlayer }

    /** The line under the verb once the lineup is copied: "Copied. Set it on FFPC's lineup page.", or what
     * the phone could not do. */
    fun copied(didCopy: Boolean): List<List<FootRun>> =
        listOf(
            listOf(
                FootRun("${if (didCopy) Words.Lineup.copied else Words.Lineup.copyFailed} ${Words.Lineup.setItOn} "),
                FootRun(StartWords.lineupPage(platform), page),
                FootRun("."),
            ),
        )
}

/** The Start screen from the API's answer at the screen's clock, the times in the member's zone. Pure:
 * the same answer at the same clock draws the same screen. `host` is the platform's words, the league's
 * own unless a store graphic passes the neutral one (Lane 310). */
fun startModel(
    answer: LineupAdvice,
    league: LeagueHost,
    now: Instant,
    zone: ZoneId,
    host: HostWords = HostWords.of(league),
): StartModel {
    val (advice, held) = LineupBoxes.held(answer, now)
    val box = LineupBoxes.box(advice, held, zone, now)
    val platform = host.name
    val done = advice.weekDone
    val small = StartWords.teamSmall(box.totals)
    val lines = advice.slots.flatMap { listOfNotNull(it.ours, it.host) } + advice.bench + advice.reserve
    val onPlatform = StartMoves.setsOnPlatform(advice)
    val page = advice.hostLineupUrl.ifEmpty { null }
    return StartModel(
        week = "${Words.LeagueHome.week} ${advice.week}",
        title = StartWords.changesTitle(box.swaps.size, done, advice.weekDoneState),
        decision = StartMoves.decision(advice),
        sum = StartWords.lineupSum(box, host, done),
        done = done,
        missed = advice.missed,
        chips = if (done == null) box.idle.map(StripChip::Idle) + box.swaps.map(StripChip::SwapChip) else emptyList(),
        starters = box.starters.map { RowCells.of(it, it.row, null) },
        empty = box.empty,
        team =
            TeamRow(
                note = box.totals.note,
                live = box.totals.live,
                caption = small?.first,
                proj = StartWords.number(if (small != null) small.second else box.totals.proj),
                pts = StartWords.number(box.totals.pts),
            ),
        bench = box.bench.map { RowCells.of(it, it.row, if (it.row.reserve) ReserveRow.Bench else null) },
        reserve = box.reserve.map { RowCells.of(null, it, ReserveRow.Slot) },
        basis = LineupBasis.phone(LineupBasis.Facts(advice, league, lines, box.totals, zone, now, host)),
        platform = platform,
        verb =
            if (box.swaps.isEmpty()) {
                null
            } else if (onPlatform) {
                StartVerb.Make
            } else {
                StartVerb.Copy
            },
        page = page,
        foot = StartMoves.foot(advice, box, onPlatform, platform, page),
        move = StartMoves.lineupMove(advice),
        copyText = StartWords.lineupText(box, advice.week),
        swaps = box.swaps,
    )
}

/** The verb's side of the screen: whether the platform takes the lineup from here, the line under the
 * verb, the move it plans, and the decision in words (move.ts, StartScreen.svelte, words.ts). */
internal object StartMoves {
    /** move.ts setsOnHost: the API opens the move, and there is a change to make. */
    fun setsOnPlatform(advice: LineupAdvice): Boolean =
        advice.moves.lineup == LineupMoves.Lineup.available && !advice.set && advice.slots.any { it.changed }

    /** StartScreen.svelte verbFoot: the platform's page and the API's reason under Copy the lineup;
     * "Lineup set on ESPN" under a set lineup the platform takes from here; nothing once every starter
     * has kicked off. */
    fun foot(
        advice: LineupAdvice,
        box: LineupBox,
        onPlatform: Boolean,
        platform: String,
        page: String?,
    ): List<List<FootRun>> {
        if (advice.weekDone != null) return emptyList()
        if (box.swaps.isEmpty()) {
            return if (advice.moves.lineup ==
                LineupMoves.Lineup.available
            ) {
                listOf(listOf(FootRun(StartWords.setOn(platform))))
            } else {
                emptyList()
            }
        }
        if (onPlatform) return emptyList()
        val link = page?.let { listOf(listOf(FootRun(StartWords.lineupPage(platform), it))) }.orEmpty()
        val line = advice.moves.reason ?: advice.hostNote ?: ""
        return link + if (line.isEmpty()) emptyList() else listOf(listOf(FootRun(line)))
    }

    /** move.ts lineupMove: each changed slot's player in and the starter it sits, for the week read. */
    fun lineupMove(advice: LineupAdvice): HostMoveInput =
        HostMoveInput(
            kind = HostMoveInput.Kind.lineup,
            week = advice.week,
            changes =
                advice.slots.filter { it.changed }.map { slot ->
                    HostMoveChange(
                        slot =
                            HostMoveChange.Slot.entries.firstOrNull { it.value == slot.slot.value }
                                ?: HostMoveChange.Slot.unknown_default_open_api,
                        `in` = slot.ours.player.hostId,
                        out = slot.host?.player?.hostId,
                    )
                },
        )

    /** words.ts lineupDecision. */
    fun decision(advice: LineupAdvice): String {
        val labels = slotLabels(advice.slots.map { it.slot.value })
        val changes =
            advice.slots.zip(labels).filter { (slot, _) -> slot.changed }.map { (slot, label) ->
                val over = slot.host?.let { " over ${it.player.name}" }.orEmpty()
                val flex = label.replace(Regex(" \\d+$"), "")
                val place = if ("flex" in label.lowercase()) "in the ${flex.lowercase()}" else "at $label"
                "start ${slot.ours.player.name}$over $place"
            }
        if (advice.set || changes.isEmpty()) return "${Words.Lineup.set}."
        val count = StartWords.changeCount(changes.size)
        if (changes.size > 2) return "$count, starting with ${changes.first().removePrefix("start ")}."
        return "$count: ${changes.joinToString(", ")}."
    }

    /** words.ts slotLabels: "QB", "RB1", "RB2", "Flex 1", numbered where the lineup has more than one. */
    private fun slotLabels(slots: List<String>): List<String> {
        val names = mapOf("FLEX" to "Flex", "SUPERFLEX" to "Superflex")
        val seen = mutableMapOf<String, Int>()
        return slots.map { slot ->
            val count = slots.count { it == slot }
            val number = (seen[slot] ?: 0) + 1
            seen[slot] = number
            val name = names[slot] ?: slot
            when {
                count < 2 -> name
                name.length > SHORT_LABEL -> "$name $number"
                else -> "$name$number"
            }
        }
    }

    private const val SHORT_LABEL = 3
}
