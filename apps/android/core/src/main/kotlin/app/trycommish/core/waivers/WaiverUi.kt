package app.trycommish.core.waivers

import app.trycommish.api.models.HostBid
import app.trycommish.api.models.WaiverRow
import app.trycommish.core.AppWords
import app.trycommish.core.Format
import app.trycommish.core.start.FootRun
import app.trycommish.core.start.MoveKind
import app.trycommish.core.start.MovePanel
import app.trycommish.core.start.MoveStep
import java.time.Instant
import java.time.ZoneId

sealed interface WaiverState {
    data object Loading : WaiverState

    /** The waivers, when the page's answer was read, and whether that read is older than this open (the
     * saved one, shown at once or because the latest read failed). */
    data class Loaded(
        val model: WaiverModel,
        val stamp: Instant,
        val stale: Boolean,
    ) : WaiverState

    /** No waivers to draw: a sentence for the member, never an error code. */
    data class Failed(
        val message: String,
    ) : WaiverState

    /** The API no longer takes the device's token; the app has signed it out. */
    data object SignedOut : WaiverState
}

/** The claim's bid field (MovePanel.svelte), where the league bids: its label with its basis, the bid as
 * typed, what is wrong with it, and whether it can be changed (not while the claim is on its way). */
data class BidField(
    val label: String,
    val typed: String,
    val problem: String?,
    val editable: Boolean,
)

/** What the pin above the bar shows: the pair an open row's verb makes, the one verb and whether it can
 * be pressed, the line under it; or the claim's confirmation (with its bid) in the verb's place. */
data class WaiverPin(
    val pair: String? = null,
    val verb: String? = null,
    val enabled: Boolean = false,
    val foot: List<List<FootRun>> = emptyList(),
    val panel: MovePanel? = null,
    val bid: BidField? = null,
) {
    val isEmpty: Boolean get() = verb == null && foot.isEmpty() && panel == null
}

/** Everything the screen draws from: the waivers, the claim's step, the card or open row the verb acts
 * on, the line under a copied name, the bid as typed, the position chosen with its read, the sort and the
 * search. Pure reads over it are below, so a snapshot draws a state as the screen does. */
data class WaiverUi(
    val state: WaiverState = WaiverState.Loading,
    val step: MoveStep = MoveStep.Closed,
    /** The card the pinned verb acts on, by key; the first card until another is chosen. */
    val chosenCard: String? = null,
    /** The row whose drop panel is open, and the drop chosen there. */
    val openRow: String? = null,
    val chosenDrop: String? = null,
    /** The line under the verb once his name is copied for the platform's page. */
    val copied: List<List<FootRun>>? = null,
    /** The bid as typed, the claim's bid terms and whether it is being planned again. */
    val typed: String = "",
    val bid: HostBid? = null,
    val replanning: Boolean = false,
    /** The position chosen (null: every position), whether its read is on its way, and why it failed. */
    val position: WaiverPosition? = null,
    val reading: Boolean = false,
    val problem: String? = null,
    val sort: WaiverSort = WaiverSort.Initial,
    val query: String = "",
    /** The position panel's figures and its open card, by position (none open at first). */
    val panelMode: PanelMode = PanelMode.Season,
    val openCard: String? = null,
) {
    val loaded: WaiverState.Loaded? get() = state as? WaiverState.Loaded
    val model: WaiverModel? get() = loaded?.model

    /** The table as the sort and the search draw it, empty before an answer. */
    val table: WaiverTable get() = model?.table(sort, query) ?: WaiverTable.Empty

    /** The position panel's cards in the toggle's figures, none before an answer or from one without it. */
    val panel: List<PanelCard> get() = model?.panel(panelMode).orEmpty()

    /** The card whose list is open, if any. */
    val openedCard: PanelCard? get() = openCard?.let { key -> panel.firstOrNull { it.key == key } }

    /** Whether the panel's toggle is drawn: the answer reads this week's figures. */
    val panelHasWeek: Boolean get() = model?.panelHasWeek ?: false

    /** The open row, if any. */
    val opened: PoolRow? get() = openRow?.let { key -> model?.rows?.firstOrNull { it.key == key } }

    /** The open row's drops, the advice's first. */
    val drops: List<DropRow> get() = opened?.let { row -> model?.drops(row) }.orEmpty()

    /** The drop chosen in the open panel: the one tapped, else the advice's. */
    val drop: DropRow? get() = drops.firstOrNull { it.key == chosenDrop } ?: drops.firstOrNull()

    /** The card the verb acts on with no row open: the one chosen, else the first. */
    val card: PickupCard? get() = model?.let { m -> m.cards.firstOrNull { it.key == chosenCard } ?: m.cards.firstOrNull() }

    /** What the verb acts on: the open row with the drop chosen, else the chosen card's move. */
    val target: WaiverRow? get() = opened?.let { WaiverRows.with(it.source, drop) } ?: card?.source

    /** The verb makes only the claim the sentence names: it waits while the claim is planned again, and
     * while the bid typed is not the one planned or is one the league does not take. */
    fun waits(platform: String): Boolean {
        val terms = bid ?: return replanning
        return replanning ||
            WaiverWords.bidProblem(platform, typed, terms) != null ||
            WaiverWords.bidValue(typed.trim()) != terms.amount
    }
}

/** "Last read Sat 12:00 pm" while the waivers shown are a saved read, the instant in the member's zone. */
fun waiverStamp(
    ui: WaiverUi,
    zone: ZoneId,
): String? {
    val loaded = ui.loaded ?: return null
    return if (loaded.stale) "${AppWords.lastRead} ${Format.weekdayTime(loaded.stamp, zone)}" else null
}

/** The bid field while the claim is confirmed or sent, where the league bids. */
private fun bidField(
    ui: WaiverUi,
    platform: String,
): BidField? {
    val bid = ui.bid ?: return null
    if (ui.step !is MoveStep.Confirm && ui.step !is MoveStep.Sending) return null
    return BidField(
        label = WaiverWords.bidLabel(bid),
        typed = ui.typed,
        problem = WaiverWords.bidProblem(platform, ui.typed, bid),
        editable = ui.step !is MoveStep.Sending,
    )
}

/** The pin: the claim's confirmation while it is open; else the verb for the open pair or the card,
 * disabled with the stamp's reason while the waivers shown are a saved read (a claim made from it may be
 * for a player already taken). Pure, so a snapshot draws it from a state as the screen does. */
fun waiverPin(
    ui: WaiverUi,
    platform: String,
    zone: ZoneId,
): WaiverPin {
    MovePanel.of(ui.step, platform, MoveKind.Claim(zone))?.let { panel ->
        return WaiverPin(panel = panel.waiting(ui.waits(platform)), bid = bidField(ui, platform))
    }
    val loaded = ui.loaded ?: return WaiverPin()
    val target = ui.target ?: return WaiverPin()
    val model = loaded.model
    val pair = ui.opened?.let { model.pairWords(it.source, ui.drop) }
    val stamp = waiverStamp(ui, zone)
    if (loaded.stale && stamp != null) {
        return WaiverPin(pair, model.verb(target), enabled = false, foot = listOf(listOf(FootRun(AppWords.waiversStale(stamp)))))
    }
    val line = if (model.line.isEmpty()) emptyList() else listOf(listOf(FootRun(model.line)))
    return WaiverPin(pair, model.verb(target), enabled = true, foot = ui.copied ?: line)
}
