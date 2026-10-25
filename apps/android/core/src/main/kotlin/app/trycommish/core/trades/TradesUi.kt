package app.trycommish.core.trades

import app.trycommish.core.AppWords
import app.trycommish.core.Format
import java.time.Instant
import java.time.ZoneId

/** What the Trades screen shows: reading, the finder (when its answer was read, and whether that read
 * is older than the latest try), a sentence for why nothing shows, or signed out. */
sealed interface TradesState {
    data object Loading : TradesState

    data class Loaded(
        val model: TradesModel,
        val stamp: Instant,
        val stale: Boolean,
    ) : TradesState

    data class Failed(
        val message: String,
    ) : TradesState

    data object SignedOut : TradesState
}

/** The Trades screen as the member has left it: the finder, each team's best or every trade, the order,
 * the trades opened, the lines under the pressed verbs, the player the trades are narrowed to and whether
 * that read is out or refused, and the builder with its check. */
data class TradesUi(
    val state: TradesState = TradesState.Loading,
    val every: Boolean = false,
    val sort: TradeSort = TradeSort.Mine,
    /** The trades opened, by key. */
    val opened: Set<String> = emptySet(),
    /** The line under each pressed verb, by trade. */
    val copied: Map<String, CopiedLine> = emptyMap(),
    /** The player the trades are narrowed to (state.ts pickKey), null for every trade. */
    val holding: String? = null,
    /** The trades holding him are being read: the last ones stay, quieter. */
    val narrowing: Boolean = false,
    /** Why the trades holding him could not be read, over the finder. */
    val problem: String? = null,
    /** The builder while it is open, drawn from its picks and its answer. */
    val builder: TradeBuilderModel? = null,
    /** The builder's check is being read: the last answer stays, quieter. */
    val checking: Boolean = false,
    /** The line under the builder's verb once pressed. */
    val builderCopied: CopiedLine? = null,
) {
    val loaded: TradesState.Loaded? get() = state as? TradesState.Loaded
    val model: TradesModel? get() = loaded?.model

    /** What the basis speaks to: the builder open, a trade opened, or the finder alone. */
    val open: TradesOpened
        get() =
            when {
                builder != null -> TradesOpened.Builder
                opened.isEmpty() -> TradesOpened.None
                else -> TradesOpened.Trade
            }
}

/** "Last read Sat 12:00 pm" while the finder shown is a saved one, or a read found no signal. */
fun tradesStamp(
    ui: TradesUi,
    zone: ZoneId,
): String? {
    val loaded = ui.loaded ?: return null
    return if (loaded.stale) "${AppWords.lastRead} ${Format.weekdayTime(loaded.stamp, zone)}" else null
}
