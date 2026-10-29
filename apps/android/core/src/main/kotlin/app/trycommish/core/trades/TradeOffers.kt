package app.trycommish.core.trades

import app.trycommish.api.models.PlayerLine
import app.trycommish.api.models.TradeAdvice
import app.trycommish.api.models.TradeOffer
import app.trycommish.api.models.TradeTeam
import app.trycommish.core.Format
import app.trycommish.design.Words
import java.time.Duration
import java.time.Instant
import java.time.ZoneId

/** A trade offered to the member on the platform (builder.ts OfferPreset, Lanes 279, 290), a preset at the
 * head of the ideas row: its label, the team, give for get, when it lapses, and the ticks one tap loads. An
 * offer the builder cannot hold loads nothing and says where to answer it. We never answer an offer: the
 * member accepts it on the platform. */
data class OfferPreset(
    /** The web's key, "offer:fixture-offer-1". */
    val key: String,
    val rosterId: Int,
    val team: String,
    /** "Offered to you", the API's own words. */
    val label: String,
    /** "With Muttdogs". */
    val with: String,
    /** "Mahomes for Kittle and Burrow", with the platform's drop when it names one: ", drop Dart". */
    val deal: String,
    /** "Ends Mon 11:56 am"; null where the platform states none. */
    val expires: String?,
    /** When the platform lets it lapse: the row drops it from then (TradeIdeas.at). */
    val endsAt: Instant?,
    /** The ticks it loads; null on one the builder cannot hold. */
    val picks: TradePicks?,
    /** "Answer it on ESPN." on one the builder cannot hold, else null. */
    val note: String?,
) {
    /** The fact at the deal line's end: where to answer it, else when it lapses. */
    val fact: String? get() = note ?: expires
}

/** builder.ts offerPresets: the platform's pending offers as presets. */
object TradeOffers {
    /** The most days ahead an expiry names by its weekday; one further names its date. */
    private val weekdayReach: Duration = Duration.ofDays(6)

    /** The offers, newest first as the API sends them, each one whose expiry is still to come at `now`; only
     * an offer whose team the answer does not hold is left out. */
    fun presets(
        advice: TradeAdvice,
        platform: String,
        now: Instant,
        zone: ZoneId,
    ): List<OfferPreset> =
        advice.offers.orEmpty().mapNotNull { offer ->
            val team = advice.teams.firstOrNull { it.rosterId == offer.rosterId } ?: return@mapNotNull null
            val ends = offer.expiresAt?.let(Instant::parse)
            if (ends != null && !ends.isAfter(now)) return@mapNotNull null
            preset(offer, team, advice.roster, platform).copy(expires = ends?.let { expiry(it, now, zone) }, endsAt = ends)
        }

    /** One offer's card, its expiry still to set. */
    private fun preset(
        offer: TradeOffer,
        team: TradeTeam,
        roster: List<PlayerLine>,
        platform: String,
    ): OfferPreset {
        val find = { lines: List<PlayerLine>, ids: List<String> -> ids.flatMap { id -> lines.filter { it.player.hostId == id } } }
        val give = find(roster, offer.give)
        val get = find(team.roster, offer.get)
        val drop = find(roster, offer.drop)
        val drawn = give.size == offer.give.size && get.size == offer.get.size && drop.size == offer.drop.size
        val holds = { side: List<PlayerLine> ->
            side.isNotEmpty() &&
                side.size <= TradeBuilder.MAX_A_SIDE &&
                side.all(TradeBuilder::pickable)
        }
        val loadable = drawn && offer.drop.isEmpty() && holds(give) && holds(get)
        val dropped = if (drop.isEmpty()) "" else ", ${Words.Trades.sideDrop.lowercase()} ${TradesWords.shortSide(drop)}"
        return OfferPreset(
            key = "offer:${offer.hostOfferId}",
            rosterId = team.rosterId,
            team = team.name,
            label = offer.label,
            with = "${Words.Trades.with} ${team.name}",
            deal = if (drawn) "${side(give)} ${TradesWords.FOR} ${side(get, first = false)}$dropped" else Words.Trades.offRoster,
            expires = null,
            endsAt = null,
            picks = if (loadable) TradePicks(team.rosterId, offer.give, offer.get) else null,
            note = if (loadable) null else "${Words.Trades.answerOn} $platform.",
        )
    }

    /** When an offer lapses on the member's clock: "Ends Fri 3:00 pm", "Ends Nov 8" a week or more out. */
    fun expiry(
        ends: Instant,
        now: Instant,
        zone: ZoneId,
    ): String {
        val near = Duration.between(now, ends) < weekdayReach
        val words = if (near) Format.weekdayTime(ends, zone) else Format.shortDay(ends, zone)
        return "${Words.Trades.expires} $words"
    }

    /** An offer's side by last names, "Nothing" (or "nothing" after "for") for a side naming no player. */
    private fun side(
        lines: List<PlayerLine>,
        first: Boolean = true,
    ): String =
        when {
            lines.isNotEmpty() -> TradesWords.shortSide(lines)
            first -> Words.Trades.noPlayer
            else -> Words.Trades.noPlayer.lowercase()
        }
}
