package app.trycommish.core.waivers

import app.trycommish.api.models.PlayerLine
import app.trycommish.api.models.WaiverAdvice
import app.trycommish.api.models.WaiverDrop
import app.trycommish.api.models.WaiverMoves
import app.trycommish.api.models.WaiverRow
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.start.ReserveRow
import app.trycommish.core.start.RowCells
import app.trycommish.core.start.StartRows
import app.trycommish.core.start.StartWords
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId

/** Whom an add beats, as the Beats cell prints it (waivers.ts BeatsCell): the player his move replaces
 * with his place, or the open spot he fills; the season Gain, loud on a row that gains; and on the
 * strip's own move its week figure under it. */
data class BeatsCell(
    val who: Who?,
    /** "+1.8 Gain", "0.0", "--"; null on a Stash row, which names no Gain. */
    val figure: String?,
    val loud: Boolean,
    /** "+4.8 Proj" under the Gain on the strip's move, else null. */
    val week: String?,
) {
    data class Who(
        val name: String,
        val place: String,
    )
}

/** A Stash row's own cells (waivers.ts StashCell): Stash where an open IR slot takes him, else Add; and
 * whether he names a drop, so either verb opens the drop panel. */
data class StashCell(
    val back: String,
    val slotTakesHim: Boolean,
    val drops: Boolean,
)

/** One player free to add, as the phone's table draws him (WaiverTable.svelte at 390): his box row's
 * cells, the evidence line with A game after it, the day a claim clears, the Beats cell and his button. */
data class PoolRow(
    /** waivers.ts addKey: his platform id, else his board id. */
    val key: String,
    val cells: RowCells,
    /** "Opp 2nd, Avg 8.9, Last 10.5, A game 6.4". */
    val evidence: String,
    /** "Clears Wed", where the platform says it. */
    val clears: String?,
    /** A Stash row's "Back week 9", said in place of his game. */
    val away: String?,
    /** The strip names him: his row is tinted. */
    val named: Boolean,
    /** He is offered as a pickup: drawn over the divider, his Gain loud. */
    val gains: Boolean,
    val beats: BeatsCell,
    val stash: StashCell?,
    /** The default sort's figure: the season Gain, or a stash's rate from his return. */
    internal val order: Double,
    /** His rest-of-season points a game (a stash's from his return), the A game column's figure. */
    internal val rest: Double?,
    val source: WaiverRow,
) {
    /** The row's own button: Stash where an open IR slot takes him, else Add. */
    val button: String get() = if (stash?.slotTakesHim == true) Words.Stash.verb else Words.InSeason.add

    /** A stash an open IR slot takes with no drop opens the platform's page with his name; every other
     * row's button opens the players he could replace. */
    val opensPage: Boolean get() = stash?.let { it.slotTakesHim && !it.drops } ?: false

    /** The player his name opens in the sheet, keyed by the row's own key (a free agent has no platform
     * id): null where the site has no page for him. */
    val sheetPlayer: SheetPlayer? get() = WaiverRows.sheetPlayer(key, cells)
}

/** One card of the strip (PickupStrip.svelte): his slot, Best over the first of more than one, the
 * move, why its drop is the one named, the gains and the card's verb. */
data class PickupCard(
    val key: String,
    val slot: String,
    val mark: String?,
    val move: String,
    val why: String?,
    val gains: String,
    val verb: String,
    val source: WaiverRow,
)

/** The strip's sum (waivers.ts PickupSum): "105.4" over "Proj with both, 98.9 without" and its gain. */
data class PickupSum(
    val figure: String,
    val words: String,
    val gain: String,
)

/** One player of the member's an add could replace, as the drop panel draws him. */
data class DropRow(
    val key: String,
    val cells: RowCells,
    val evidence: String,
    /** The season Gain with him dropped. */
    val gain: String,
    /** "+6.7 Proj" where the drops' week gains differ, else null (the lead says it once). */
    val week: String?,
    /** "Starter" where this week's lineup starts him. */
    val starter: String?,
    internal val line: PlayerLine,
    internal val weekGain: Double?,
    internal val seasonGain: Double,
)

/** waivers.ts's rows over the API's answer: the table's, the Stash group's, the strip's cards and the
 * drop panel's. Nothing is inferred or re-ordered here but the table's sort. */
internal object WaiverRows {
    /** move.ts addKey. */
    fun key(row: WaiverRow): String {
        val player = row.add.player
        return player.hostId.ifEmpty { "board:${player.boardId ?: player.name}" }
    }

    /** waivers.ts namesOnScreen: the adds, the stashes and the member's roster. */
    fun names(advice: WaiverAdvice): List<String> =
        (advice.rows + advice.pickups + advice.stash.orEmpty()).map { it.add.player.name } + advice.roster.map { it.player.name }

    /** The player a row's name opens in the sheet, by the key given: null where the site has no page
     * for him. */
    fun sheetPlayer(
        key: String,
        cells: RowCells,
    ): SheetPlayer? {
        val row = cells.row
        return row.slug?.let {
            SheetPlayer(
                key,
                it,
                row.name,
                row.position,
                row.rank?.toString() ?: row.status?.rank,
                row.club,
                row.headshot,
                boardId = row.boardId,
            )
        }
    }

    fun cells(
        line: PlayerLine,
        reserve: ReserveRow?,
        zone: ZoneId,
        now: Instant,
    ): RowCells = RowCells.of(null, StartRows.row(line, "", zone, now, ranked = false), reserve)

    fun evidence(
        cells: RowCells,
        rest: Double?,
    ): String = "${cells.evidence}, ${Words.Waivers.rest} ${StartWords.number(rest)}"

    /** waivers.ts poolRows over the shown answer's rows and roster, the page answer's pickups tinting the
     * strip's own, in the answer's order. */
    fun pool(
        shown: WaiverAdvice,
        pickups: List<WaiverRow>,
        zone: ZoneId,
        now: Instant,
    ): List<PoolRow> {
        val cards = pickups.associateBy(::key)
        val names = names(shown.copy(pickups = pickups, stash = null))
        return shown.rows.map { source ->
            val card = cards[key(source)]
            val gains = card != null || (WaiverWords.positive(source.gain) && source.beats != null)
            val cells = cells(source.add, null, zone, now)
            PoolRow(
                key = key(source),
                cells = cells,
                evidence = evidence(cells, source.add.restOfSeasonPerGame),
                clears = WaiverWords.clears(source.clears),
                away = null,
                named = card != null,
                gains = gains,
                beats = beats(source, gains, card, names),
                stash = null,
                order = source.gain,
                rest = source.add.restOfSeasonPerGame,
                source = source,
            )
        }
    }

    /** waivers.ts stashRows, in the answer's order. */
    fun stash(
        advice: WaiverAdvice,
        zone: ZoneId,
        now: Instant,
    ): List<PoolRow> {
        val names = names(advice)
        val addressed = advice.forWeek ?: advice.week
        return advice.stash.orEmpty().mapNotNull { source ->
            val stash = source.stash ?: return@mapNotNull null
            val cells = cells(source.add, ReserveRow.Slot, zone, now)
            val drop = source.drop
            val who =
                when {
                    drop != null -> BeatsCell.Who(WaiverWords.beatsName(drop.player.name, names), Words.Stash.drop)
                    stash.irSlot -> BeatsCell.Who(Words.Stash.slot, Words.Stash.open)
                    else -> null
                }
            val back = WaiverWords.back(stash.backWeek, addressed)
            PoolRow(
                key = key(source),
                cells = cells,
                evidence = evidence(cells, stash.perGame),
                clears = WaiverWords.clears(source.clears),
                away = back,
                named = false,
                gains = false,
                beats = BeatsCell(who, null, loud = false, week = null),
                stash = StashCell(back, stash.irSlot, drop != null),
                order = stash.perGame ?: Double.NEGATIVE_INFINITY,
                rest = stash.perGame,
                source = source,
            )
        }
    }

    /** waivers.ts beatsOf: whom the API names, with the row's season Gain; a row that gains nothing names
     * no one, and a Gain with no one named is no Gain the page can stand behind. */
    private fun beats(
        source: WaiverRow,
        gains: Boolean,
        card: WaiverRow?,
        names: List<String>,
    ): BeatsCell {
        val named = source.beats
        val who =
            named?.takeIf { gains }?.let { beats ->
                val name = if (beats.openSpot) Words.Waivers.openSpot else WaiverWords.beatsName(beats.name, names)
                BeatsCell.Who(name, WaiverWords.beatsPlace(beats.starter, beats.bye == true))
            }
        val judged = named != null || !WaiverWords.positive(source.gain)
        val gain = if (judged) source.gain else null
        return BeatsCell(
            who = who,
            figure = WaiverWords.beats(gain, gains),
            loud = gains && (gain ?: 0.0) > 0,
            week = card?.weekGain?.let(WaiverWords::beatsWeek),
        )
    }

    /** waivers.ts dropWhy: "IR, on your bench" for a drop on injured reserve this week's lineup sits. */
    private fun dropWhy(source: WaiverRow): String? {
        val drop = source.drop ?: return null
        if (!StartRows.onReserve(drop)) return null
        val starts = source.drops.any { it.hostId == drop.player.hostId && it.startsThisWeek }
        return if (starts) null else Words.Waivers.irBench
    }

    /** waivers.ts pickupCards with the card's verb, in the API's order. */
    fun cards(
        advice: WaiverAdvice,
        platform: String,
        moves: WaiverMoves,
    ): List<PickupCard> {
        val names = names(advice)
        return advice.pickups.mapIndexed { index, source ->
            val add = WaiverWords.cardName(source.add.player.name, names)
            val drop = source.drop?.let { WaiverWords.cardName(it.player.name, names) }
            PickupCard(
                key = key(source),
                slot = StartRows.positionWord(source.add.player.position),
                mark = if (index == 0 && advice.pickups.size > 1) Words.Strip.best else null,
                move = WaiverWords.move(add, drop),
                why = WaiverWords.dropWhy(dropWhy(source)),
                gains = WaiverWords.cardGains(source.weekGain, source.gain),
                verb = WaiverWords.addVerb(moves, source.add.player.hostId, platform),
                source = source,
            )
        }
    }

    /** waivers.ts pickupSum: every figure the API's; null without both Proj, without a card, or once a
     * card's week figure is gone. */
    fun sum(advice: WaiverAdvice): PickupSum? {
        val without = advice.lineupProj ?: return null
        val withAll = advice.pickupsProj ?: return null
        if (advice.pickups.isEmpty() || advice.pickups.any { it.weekGain == null }) return null
        val them =
            when (advice.pickups.size) {
                1 -> "him"
                2 -> "both"
                else -> "all three"
            }
        return PickupSum(
            figure = StartWords.number(withAll),
            words = "${Words.Box.proj} with $them, ${StartWords.number(without)} without",
            gain = WaiverWords.gain(withAll - without),
        )
    }

    /** waivers.ts dropRows: every player he could replace, the advice's drop first, from the roster. */
    fun drops(
        source: WaiverRow,
        roster: List<PlayerLine>,
        zone: ZoneId,
        now: Instant,
    ): List<DropRow> {
        val lines = roster.associateBy { it.player.hostId }
        val rows = source.drops.mapNotNull { drop -> lines[drop.hostId]?.let { drop to it } }
        val week = sameWeek(rows.map { it.first.weekGain })
        return rows.map { (drop, line) -> dropRow(drop, line, sameWeek = week, zone, now) }
    }

    private fun dropRow(
        drop: WaiverDrop,
        line: PlayerLine,
        sameWeek: Double?,
        zone: ZoneId,
        now: Instant,
    ): DropRow {
        val plain = cells(line, null, zone, now)
        val reserve = if (plain.row.reserve && !drop.startsThisWeek) ReserveRow.Bench else null
        return DropRow(
            key = drop.hostId,
            cells = cells(line, reserve, zone, now),
            evidence = evidence(plain, line.restOfSeasonPerGame),
            gain = WaiverWords.gain(drop.gain),
            week = if (sameWeek == null) drop.weekGain?.let { "${WaiverWords.gain(it)} ${Words.Box.proj}" } else null,
            starter = if (drop.startsThisWeek) Words.Waivers.starter else null,
            line = line,
            weekGain = drop.weekGain,
            seasonGain = drop.gain,
        )
    }

    /** waivers.ts sameWeekGain: the week's gain said once when every drop gives the same. */
    fun sameWeek(gains: List<Double?>): Double? {
        val first = gains.firstOrNull() ?: return null
        return if (gains.all { it == first }) first else null
    }

    /** waivers.ts withDrop: the row an add's claim names with the drop the member chose. */
    fun with(
        source: WaiverRow,
        drop: DropRow?,
    ): WaiverRow = drop?.let { source.copy(drop = it.line, gain = it.seasonGain, weekGain = it.weekGain) } ?: source
}
