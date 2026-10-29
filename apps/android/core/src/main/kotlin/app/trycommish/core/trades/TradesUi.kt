package app.trycommish.core.trades

import app.trycommish.core.AppWords
import app.trycommish.core.Format
import java.time.Instant
import java.time.ZoneId

/** What the Trades screen shows: reading, the trades (when their answer was read, and whether that read
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

/** The Trades screen as the member has left it (builder-first, Lane 260): the trades read, the builder at
 * its picks and its check, the roster drawn, every idea or the best three, and the lines under the pressed
 * verbs. */
data class TradesUi(
    val state: TradesState = TradesState.Loading,
    /** The builder, drawn from its picks and its answer, once the trades are read. */
    val builder: TradeBuilderModel? = null,
    /** The builder's check is being read: the last answer stays, quieter. */
    val checking: Boolean = false,
    /** The roster drawn where the two stack: the member's first. */
    val drawn: PickSide = PickSide.Give,
    /** Whether the ideas row shows every idea, or the best three and "N more". */
    val allIdeas: Boolean = false,
    /** The line under the verb once pressed. */
    val builderCopied: CopiedLine? = null,
    /** The line beside Share once pressed. */
    val shared: String? = null,
) {
    val loaded: TradesState.Loaded? get() = state as? TradesState.Loaded
    val model: TradesModel? get() = loaded?.model
}

/** "Last read Sat 12:00 pm" while the trades shown are a saved read, or a read found no signal. */
fun tradesStamp(
    ui: TradesUi,
    zone: ZoneId,
): String? {
    val loaded = ui.loaded ?: return null
    return if (loaded.stale) "${AppWords.lastRead} ${Format.weekdayTime(loaded.stamp, zone)}" else null
}
