package app.trycommish.core.waivers

import app.trycommish.api.models.HostClaim
import app.trycommish.api.models.HostMoveInput
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.WaiverAdvice
import app.trycommish.api.models.WaiverRow
import app.trycommish.core.leaguehome.ValueWords
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.start.StartRows
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId

/** The positions the route narrows to (the `position` query), in the board's order (WaiverScreen.svelte
 * POSITIONS). */
enum class WaiverPosition(
    val query: String,
) {
    QB("QB"),
    RB("RB"),
    WR("WR"),
    TE("TE"),
    K("K"),
    DEF("DEF"),
}

/** A position the page's adds hold (WaiverScreen.svelte POSITIONS): the route's position and its word, a
 * count card's where the answer carries no panel. */
data class PositionChip(
    val position: WaiverPosition,
    val word: String,
)

/** The table's rows in a sort and a search: the rows that gain, the rest under the divider, the Stash
 * group. */
data class WaiverTable(
    val gaining: List<PoolRow>,
    val rest: List<PoolRow>,
    val stash: List<PoolRow>,
) {
    /** Every row the table draws, in its order. */
    val rows: List<PoolRow> get() = gaining + rest + stash

    companion object {
        val Empty = WaiverTable(emptyList(), emptyList(), emptyList())
    }
}

/** The drop panel's head: "Drop one for Mason Taylor" and its lead. */
data class DropHead(
    val title: String,
    val lead: String,
)

/**
 * The Waivers screen at one clock (WaiverScreen.svelte at 390): the strip with a card for each pickup
 * worth making, the position cards, the line under the heads, the players free to add (the rows that
 * gain, then the rest under one divider, then the Stash group with its line) in any sort and search, the
 * basis once, and what the one verb acts on. The page's answer carries the strip and the cards; the
 * answer shown (the page's, or a position's own read) carries the table, drawn at its read's instant.
 * Every rule is the API's: the pickup rule, the order, whom an add beats, whether the claim is made from
 * here. Nothing is computed but the words and the sort.
 */
class WaiverModel(
    val advice: WaiverAdvice,
    shown: WaiverAdvice? = null,
    host: LeagueHost,
    private val now: Instant,
    private val zone: ZoneId,
    /** The page's clock, which the cards and the member's players are drawn at (WaiverScreen's pageNow). */
    private val pageNow: Instant = now,
) {
    /** The answer the table is drawn from: a position's own read, else the page's. */
    val shown: WaiverAdvice = shown ?: advice
    val platform: String = ValueWords.platform(host)
    val cards: List<PickupCard> = WaiverRows.cards(advice, platform, this.shown.moves)

    /** "Week 6": the week the page addresses. */
    val week: String = "${Words.LeagueHome.week} ${advice.forWeek ?: advice.week}"
    val title: String = WaiverWords.pickupsTitle(cards.size)

    /** The strip in one sentence, its name for TalkBack (waivers.ts stripDecision). */
    val decision: String = WaiverWords.decision(cards)
    val sum: PickupSum? = WaiverRows.sum(advice)

    /** The positions among the page's adds, in the board's order, each a read of its own. */
    val positions: List<PositionChip> =
        WaiverPosition.entries
            .filter { position -> advice.rows.any { it.add.player.position == position.query } }
            .map { PositionChip(it, StartRows.positionWord(it.query)) }

    /** Whether Proj is drawn: not before the week's published projection is read. */
    val projected: Boolean = this.shown.projectionReadAt != null

    /** "Week 7 projections expected Thursday.", over the table while there is no Proj. */
    val arrives: String? = WaiverWords.arrives(this.shown, zone)

    /** The line under the heads, said once. */
    val heads: String = WaiverWords.heads(this.shown.projectionPreviousReadAt, projected, zone)
    val stashLine: List<String> = WaiverWords.stashLine(this.shown)
    val basis: String = WaiverBasis.phone(this.shown, zone, now)

    /** The platform's waiver page, null when the API knows none. */
    val page: String? = this.shown.hostWaiversUrl.ifEmpty { null }

    /** The API's line under the verb: why it opens the platform, or its note. */
    val line: String = this.shown.moves.reason ?: this.shown.hostNote ?: this.shown.moves.note ?: ""

    private val pool: List<PoolRow> = WaiverRows.pool(this.shown, advice.pickups, zone, now)
    private val stashPool: List<PoolRow> = WaiverRows.stash(this.shown.copy(pickups = advice.pickups), zone, now)

    /** The table in a sort and a search (waivers.ts sortRows, findRows, gainGroups), the Stash group the
     * same way. */
    fun table(
        sort: WaiverSort = WaiverSort.Initial,
        query: String = "",
    ): WaiverTable {
        val rows = WaiverSorting.found(WaiverSorting.sorted(pool, sort), query)
        return WaiverTable(
            gaining = rows.filter { it.gains },
            rest = rows.filter { !it.gains },
            stash = WaiverSorting.found(WaiverSorting.sorted(stashPool, sort), query),
        )
    }

    /** Every row the table can draw, in the default order. */
    val rows: List<PoolRow> get() = table().rows

    /** Every row that carries a player the sheet can open, for the sheet to keep its player by. */
    val sheetPlayers: List<SheetPlayer> get() = (pool + stashPool).mapNotNull { it.sheetPlayer }

    /** The players an add could replace, the advice's drop first. */
    fun drops(row: PoolRow): List<DropRow> = drops(row.source)

    private fun drops(source: WaiverRow): List<DropRow> = WaiverRows.drops(source, shown.roster, zone, now)

    // The position cards (Lane 305 on the web).

    /** The cards in the mode (position-nav.ts navCards over the page's answer): the All card counts every
     * free agent of the page's answer, a count card a position where the answer carries no panel. */
    fun nav(mode: PanelMode): List<NavCard> {
        val all = WaiverRows.pool(advice, advice.pickups, zone, pageNow)
        val byPosition =
            positions.map { chip ->
                chip.position.query to WaiverNav.counts(all.filter { it.source.add.player.position == chip.position.query })
            }
        return WaiverNav.cards(advice, mode, WaiverNav.counts(all), byPosition)
    }

    /** The card the screen opens on: the weakest Need, else All. */
    val opening: String get() = WaiverNav.opening(advice)

    /** Whether the toggle is drawn: a card reads this week. */
    val navHasWeek: Boolean get() = advice.positions.orEmpty().any { it.week != null }

    /** The line over the comparison for the chosen card. */
    fun lead(
        key: String,
        mode: PanelMode,
    ): NavLead = WaiverNav.lead(advice, key, mode)

    /** The member's players at the chosen position, starters first in the mode's lineup. */
    fun yours(
        key: String,
        mode: PanelMode,
    ): List<YoursRow> = WaiverNav.yours(advice, key, mode, zone, pageNow)

    /** The drop panel's head and lead: "Drop one for Mason Taylor", "+4.8 Proj this week with any of
     * them. The one you lose least by comes first." */
    fun dropHead(row: PoolRow): DropHead =
        DropHead(
            WaiverWords.dropTitle(row.cells.row.name),
            WaiverWords.dropLead(WaiverRows.sameWeek(drops(row).map { it.weekGain })),
        )

    /** The pair the drop panel's verb makes: "Add Taylor, drop Dart". */
    fun pairWords(
        source: WaiverRow,
        drop: DropRow?,
    ): String {
        val names = WaiverRows.names(shown)
        return WaiverWords.move(
            WaiverWords.cardName(source.add.player.name, names),
            drop?.let { WaiverWords.cardName(it.cells.row.name, names) },
        )
    }

    /** A row's verb by the Waivers rule: "Add on ESPN" where the claim is made here, else "Open ESPN
     * waivers". */
    fun verb(source: WaiverRow): String = WaiverWords.addVerb(shown.moves, source.add.player.hostId, platform)

    /** The sheet's verb on his row (WaiverScreen.svelte shelfOffer): a stash an open IR slot takes with no
     * drop, the stash verb with his week under it; else the claim in the screen's words with the pair and
     * its gain (a stash's week in place of a gain) under it, the advice's drop first. */
    fun sheetOffer(row: PoolRow): Pair<String, String> {
        val stash = row.stash
        if (stash != null && stash.slotTakesHim && !stash.drops) return Words.Stash.verb to stash.back
        val advised = drops(row).firstOrNull()
        val paired = WaiverRows.with(row.source, advised)
        val tail = stash?.back ?: WaiverWords.cardGains(paired.weekGain, paired.gain)
        return verb(paired) to "${pairWords(row.source, advised)}, $tail"
    }

    /** Whether an add's claim is made from here. */
    fun claimsHere(source: WaiverRow): Boolean = WaiverWords.claimsAdd(shown.moves, source.add.player.hostId)

    /** His name as a card says it, for the line once his name is copied. */
    fun shortName(source: WaiverRow): String = WaiverWords.cardName(source.add.player.name, WaiverRows.names(shown))

    /** move.ts claimMove: his add, the drop he displaces and the bid, for the platform's week. */
    fun claim(
        source: WaiverRow,
        bid: Int?,
    ): HostMoveInput =
        HostMoveInput(
            kind = HostMoveInput.Kind.claim,
            week = shown.week,
            changes = emptyList(),
            claim = HostClaim(add = source.add.player.hostId, drop = source.drop?.player?.hostId, bid = bid),
        )
}
