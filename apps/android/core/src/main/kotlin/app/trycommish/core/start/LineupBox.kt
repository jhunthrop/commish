package app.trycommish.core.start

import app.trycommish.api.models.LineupAdvice
import app.trycommish.api.models.LineupSlot
import app.trycommish.core.Format
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId
import kotlin.math.floor

/** A row the advice moves: in to the lineup, or out of it to the bench (lineup.ts Move). */
enum class Move(
    val word: String,
) {
    Into("in"),
    Out("out"),
}

/** One row of the lineup or the bench with what the advice does with it (lineup.ts LineupRow). */
data class LineupEntry(
    val row: StartRow,
    val move: Move?,
    /** The one evidence line a moved-in row opens to; null off a swap. */
    val why: String?,
    /** A spot no rostered player who can play this week fills: the member's player, left there. */
    val idle: Boolean,
)

/** One swap as the strip names it: "Mahomes in" at QB, "Rodgers out" (lineup.ts Swap). */
data class Swap(
    val id: String,
    val slot: String,
    val into: String,
    val out: String?,
)

/** The starters' sums (box.ts BoxTotals). */
data class LineupTotals(
    val proj: Double?,
    val pts: Double?,
    /** The projected final once a starter has kicked off (the API's projected_final). */
    val final: Double?,
    /** A starter of the lineup as set has kicked off: Pts is the big figure. */
    val live: Boolean,
    /** Every starter with a game is final. */
    val allFinal: Boolean,
    /** Beside Team: the projection not in yet, or the starters with no Proj. */
    val note: String?,
)

/** A spot an undone change leaves empty because its player's game has kicked off (lineup.ts HeldSpot). */
data class HeldSpot(
    val slot: String,
    val name: String,
)

/** The Lineup as one table (lineup.ts LineupBox): the lineup the advice sets, the bench, the injured
 * reserve, the swaps, the spots no one can play, the totals and the lineup as set. */
data class LineupBox(
    val starters: List<LineupEntry>,
    val bench: List<LineupEntry>,
    val reserve: List<StartRow>,
    val swaps: List<Swap>,
    val idle: List<String>,
    val empty: List<String>,
    val totals: LineupTotals,
    val asSet: Double?,
    val gain: Double?,
    val playing: Boolean,
)

/** lineup.ts heldLineup and lineupBox, ported over the API's answer. */
internal object LineupBoxes {
    /** The advice with every change on a locked row undone (lineup.ts heldLineup): the platform's starter
     * keeps the spot, the advised starter goes back to the bench, each player once however the changes
     * chain; a change into an empty spot leaves it empty, held saying whose game started. */
    fun held(
        advice: LineupAdvice,
        now: Instant,
    ): Pair<LineupAdvice, List<HeldSpot>> {
        val undone = undoneSlots(advice.slots, now)
        if (undone.isEmpty()) return advice to emptyList()
        val slots =
            advice.slots.mapIndexedNotNull { index, slot ->
                if (index !in undone) slot else slot.host?.let { slot.copy(ours = it, changed = false, sentence = null) }
            }
        val placed = slots.map { it.ours.player.hostId }.toSet()
        val returned = undone.sorted().map { advice.slots[it].ours }
        val bench = (advice.bench + returned).filter { it.player.hostId !in placed }.distinctBy { it.player.hostId }
        val held =
            undone.sorted().mapNotNull { index ->
                val slot = advice.slots[index]
                if (slot.host == null) HeldSpot(slotWord(slot.slot.value), shortName(slot.ours.player.name)) else null
            }
        return advice.copy(slots = slots, bench = bench, set = slots.none { it.changed }) to held
    }

    /** The changes held undoes: each on a locked row, then each that moves a player an undone change hands
     * back to his own spot, until none is left. */
    private fun undoneSlots(
        slots: List<LineupSlot>,
        now: Instant,
    ): Set<Int> {
        val undone =
            slots.indices
                .filter { index ->
                    val slot = slots[index]
                    slot.changed && (LineRead.game(slot.ours, now).locked || slot.host?.let { LineRead.game(it, now).locked } == true)
                }.toMutableSet()
        var grew = true
        while (grew) {
            val returned = undone.mapNotNull { slots[it].host?.player?.hostId }.toSet()
            val more = slots.indices.filter { it !in undone && slots[it].changed && slots[it].ours.player.hostId in returned }
            grew = undone.addAll(more)
        }
        return undone
    }

    /** One slot with the row its player draws. */
    private data class Placed(
        val slot: LineupSlot,
        val row: StartRow,
    )

    fun box(
        advice: LineupAdvice,
        held: List<HeldSpot>,
        zone: ZoneId,
        now: Instant,
    ): LineupBox {
        val placed = advice.slots.map { Placed(it, StartRows.row(it.ours, slotWord(it.slot.value), zone, now)) }
        val counted = placed.filter { !it.slot.noOneCanPlay }.map { it.row }
        val satRows = satRows(advice, zone, now)
        val empty = advice.emptySlots.map { slotWord(it.value) }
        val proj = printedSum(counted.map { it.proj })
        val asSet = printedSum(setRows(placed, satRows).map { it.proj })
        val setLines = placed.map { it.slot.host ?: it.slot.ours }
        val read = LineRead.setState(setLines, now)
        val idleSlots = placed.filter { it.slot.noOneCanPlay }.map { it.row.slot } + empty
        return LineupBox(
            starters = starters(placed, satRows),
            bench = bench(advice, zone, now),
            reserve = advice.reserve.map { StartRows.row(it, "", zone, now) },
            swaps = swaps(placed),
            idle = idleSlots.map(StartWords::idle) + held.map(StartWords::held),
            empty = empty + held.map { it.slot },
            totals =
                LineupTotals(
                    proj = proj,
                    pts = if (advice.playerPoints) printedSum(placed.map { it.row.pts }) else advice.teamPoints,
                    final = advice.projectedFinal,
                    live = setLines.any { LineRead.started(it, now) },
                    allFinal = read == GameRead.Final,
                    note = totalsNote(counted, landed = advice.projectionReadAt != null, week = advice.week),
                ),
            asSet = asSet,
            gain = proj?.let { p -> asSet?.let { tenth(p - it) } },
            playing = read == GameRead.KickedOff,
        )
    }

    /** The starter each change sits, drawn as the bench draws him (Sit), by his id. */
    private fun satRows(
        advice: LineupAdvice,
        zone: ZoneId,
        now: Instant,
    ): Map<String, StartRow> =
        advice.slots
            .filter { it.changed }
            .mapNotNull { it.host }
            .distinctBy { it.player.hostId }
            .associate { it.player.hostId to StartRows.row(it, Words.Lineup.sit, zone, now) }

    private fun starters(
        placed: List<Placed>,
        satRows: Map<String, StartRow>,
    ): List<LineupEntry> =
        placed.map { (slot, row) ->
            if (!slot.changed) {
                LineupEntry(row, null, null, slot.noOneCanPlay)
            } else {
                val out = slot.host?.let { satRows[it.player.hostId] }
                LineupEntry(row, Move.Into, whyLine(row, out, row.slot), idle = false)
            }
        }

    private fun bench(
        advice: LineupAdvice,
        zone: ZoneId,
        now: Instant,
    ): List<LineupEntry> {
        val sat =
            advice.slots
                .filter { it.changed }
                .mapNotNull { it.host?.player?.hostId }
                .toSet()
        return advice.bench.map { line ->
            val out = line.player.hostId in sat
            LineupEntry(StartRows.row(line, if (out) Words.Lineup.sit else "", zone, now), if (out) Move.Out else null, null, false)
        }
    }

    private fun swaps(placed: List<Placed>): List<Swap> =
        placed
            .filter { it.slot.changed }
            .map { (slot, row) ->
                Swap(slot.ours.player.hostId, row.slot, shortName(slot.ours.player.name), slot.host?.let { shortName(it.player.name) })
            }

    /** The lineup as the platform holds it: each counted slot's player, or the starter a change sits. */
    private fun setRows(
        placed: List<Placed>,
        satRows: Map<String, StartRow>,
    ): List<StartRow> =
        placed.filter { !it.slot.noOneCanPlay }.mapNotNull { (slot, row) ->
            if (!slot.changed) row else slot.host?.let { satRows[it.player.hostId] }
        }

    /** box.ts slotWord: the platform's own short words, a defense as "D/ST". */
    fun slotWord(raw: String): String =
        when (raw) {
            "FLEX" -> "Flex"
            "SUPERFLEX" -> "SFlex"
            "DEF" -> "D/ST"
            else -> raw
        }

    /** lineup.ts shortName: "Stroud", and a defense by its club ("Saints" from "Saints D/ST"). */
    fun shortName(name: String): String = StartRows.lastName(StartRows.withoutDefense(name))

    /** The API's tenths summed and cleaned back to the tenth they are (box.ts printedSum). */
    fun printedSum(values: List<Double?>): Double? = values.filterNotNull().takeIf { it.isNotEmpty() }?.let { tenth(it.sum()) }

    /** Math.round(value * 10) / 10, half up as JavaScript rounds. */
    private fun tenth(value: Double): Double = floor(value * TEN + HALF) / TEN

    /** box.ts totalsNote. */
    fun totalsNote(
        rows: List<StartRow>,
        landed: Boolean,
        week: Int,
    ): String? {
        if (!landed) return "No projection yet for week $week"
        val lacking = rows.filter { it.game != RowGame.Bye && it.proj == null }
        if (lacking.isEmpty()) return null
        val verb = if (lacking.any { it.toCome }) "has" else "had"
        val who = if (lacking.size > 2) "${lacking.size} starters" else lacking.joinToString(" and ") { it.name }
        return "$who $verb no ${Words.Box.proj}"
    }

    /** lineup.ts whyLine: the one evidence line a swap opens to, from the row's own columns. */
    fun whyLine(
        into: StartRow,
        out: StartRow?,
        slot: String,
    ): String {
        val name = shortName(into.name)
        if (out == null) return "Your $slot spot is empty, so $name starts."
        val sat = shortName(out.name)
        val next =
            into.proj?.let { "$name is the next $slot with a ${Words.Box.proj}, ${StartWords.number(it)}." }
                ?: "$name is next in our order, with no ${Words.Box.proj} this week."
        val status = out.status
        return when {
            out.game == RowGame.Bye -> "$sat is on bye. $next"
            out.game == RowGame.NoClub -> "$sat is ${Words.Figure.freeAgent}. $next"
            status != null && status.rank != null -> "$sat is on a season-long list, ${status.mark}. $next"
            status != null && !status.question -> "$sat is listed ${status.mark.replaceFirstChar { it.lowercase() }}. $next"
            else -> compared(into, out, sat) ?: next
        }
    }

    /** "17.9 Proj against Rodgers's 15.8, vs LAC, 2nd toughest against quarterbacks." */
    private fun compared(
        into: StartRow,
        out: StartRow,
        sat: String,
    ): String? {
        val inProj = into.proj ?: return null
        val outProj = out.proj ?: return null
        val parts = mutableListOf("${StartWords.number(inProj)} ${Words.Box.proj} against $sat's ${StartWords.number(outProj)}")
        into.status?.let { parts += it.mark }
        val game = into.game
        if (game is RowGame.Game) {
            parts += game.place
            val against = against(into.position)
            if (into.oppRank != null && against != null) parts += rankWords(into.oppRank, into.oppOf, against)
        }
        return "${parts.joinToString(", ")}."
    }

    /** lineup.ts AGAINST: a defense has no rank, so no words. */
    private fun against(position: String): String? =
        when (position) {
            "QB" -> Words.Against.QB
            "RB" -> Words.Against.RB
            "WR" -> Words.Against.WR
            "TE" -> Words.Against.TE
            "K" -> Words.Against.K
            else -> null
        }

    /** lineup.ts rankWords: "3rd toughest against quarterbacks", "31st, among the easiest for receivers",
     * "12th of 32 against receivers". */
    private fun rankWords(
        rank: Int,
        outOf: Int?,
        against: String,
    ): String {
        val ord = Format.ordinal(rank)
        return when (StartRows.ease(rank, outOf)) {
            Ease.Hard -> "$ord toughest against $against"
            Ease.Easy -> "$ord, among the easiest for $against"
            Ease.Even -> "$ord of ${outOf ?: StartRows.RANKED_CLUBS} against $against"
        }
    }

    private const val TEN = 10
    private const val HALF = 0.5
}
