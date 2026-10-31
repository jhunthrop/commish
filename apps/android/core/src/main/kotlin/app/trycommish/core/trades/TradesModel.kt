package app.trycommish.core.trades

import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.PlayerLine
import app.trycommish.api.models.TradeAdvice
import app.trycommish.api.models.TradeRow
import app.trycommish.api.models.TradeTeam
import app.trycommish.core.leaguehome.HostWords
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId

/** One of our ideas above the rosters (builder.ts Preset, Lane 260): the finder's best trade with a team,
 * the picks it loads, and its card's lines, "Best +5.3 yours, +1.1 theirs", "With Max_Jensen10", then
 * "Rodgers for Waddle and Strong" with what it fills at that line's end, "Fills your WR" (Lane 290). */
data class TradePreset(
    /** The web's tradeKey, "8:96>7526+8116". */
    val key: String,
    val rosterId: Int,
    val team: String,
    /** "With Max_Jensen10". */
    val with: String,
    /** "Best" on our best trade where there is more than one idea. */
    val mark: String?,
    /** "+5.3 yours, +1.1 theirs". */
    val gains: String,
    /** "Rodgers for Waddle and Strong". */
    val deal: String,
    /** builder.ts fillsWords: "Fills your WR", null when it fills none of the member's slots or the answer
     * does not say (an older API). */
    val fills: String?,
    val picks: TradePicks,
    /** Our best trade (worthProposing's first): the screen opens on its team. */
    val lead: Boolean,
)

/** A team the finder lists no trade with (builder.ts noIdeasFrom, B271): its place says why, by the API's
 * empty_reason (Lane 290, B283), rather than leaving the team out. */
data class NoIdeaLine(
    val id: Int,
    val team: String,
    /** "With Carried by QJs", over its line. */
    val with: String,
    /** "No idea they would take.", "They need what you need.", by the API's reason. */
    val note: String,
) {
    companion object {
        /** The teams with no trade, in the answer's order. */
        fun of(teams: List<TradeTeam>): List<NoIdeaLine> =
            teams.filter { it.trades.isEmpty() }.map {
                NoIdeaLine(it.rosterId, it.name, "${Words.Trades.with} ${it.name}", note(it.emptyReason))
            }

        /** builder.ts emptyNote: the line by the API's empty_reason; an answer without one (an older API), or
         * a reason this app does not know, keeps the line every empty team had. */
        fun note(reason: TradeTeam.EmptyReason?): String =
            when (reason) {
                TradeTeam.EmptyReason.same_need -> Words.Trades.sameNeed
                TradeTeam.EmptyReason.no_need -> Words.Trades.noNeed
                TradeTeam.EmptyReason.nothing -> Words.Trades.nothingFound
                TradeTeam.EmptyReason.dropped, TradeTeam.EmptyReason.unknown_default_open_api, null -> Words.Trades.noIdea
            }
    }
}

/** One place in the ideas row (builder.ts IdeaPlace): a host's offer, an idea to load, or a team's line
 * with none. */
sealed interface IdeaPlace {
    /** The web's keys: the offer's, the trade's, or "none:3". */
    val key: String

    /** The ticks a tap loads: an idea's, or an offer's the builder can hold; null on the rest. */
    val picks: TradePicks? get() = null

    data class Offer(
        val offer: OfferPreset,
    ) : IdeaPlace {
        override val key: String get() = offer.key
        override val picks: TradePicks? get() = offer.picks
    }

    data class Idea(
        val preset: TradePreset,
    ) : IdeaPlace {
        override val key: String get() = preset.key
        override val picks: TradePicks get() = preset.picks
    }

    data class None(
        val line: NoIdeaLine,
    ) : IdeaPlace {
        override val key: String get() = "none:${line.id}"
    }

    companion object {
        /** builder.ts ideaPlaces (Lane 290 review M2): the host's newest offer heads the row, then our first
         * idea (Best), then the host's other offers, then our other ideas, then each team with none, so the
         * three in sight always hold the newest offer and Best. */
        fun row(
            offers: List<OfferPreset>,
            presets: List<TradePreset>,
            none: List<NoIdeaLine>,
        ): List<IdeaPlace> =
            offers.take(1).map(::Offer) + presets.take(1).map(::Idea) + offers.drop(1).map(::Offer) +
                presets.drop(1).map(::Idea) + none.map(::None)
    }
}

/** The ideas row (TradeBuilder's .ideas): its head, the host's offers and our ideas best first, then each
 * team with none; the best three shown and "N more" for the rest. */
data class TradeIdeas(
    val head: String,
    val places: List<IdeaPlace>,
) {
    /** The places drawn: every one, or the best three. */
    fun visible(all: Boolean): List<IdeaPlace> = if (all) places else places.take(SHOWN)

    /** The row at `now`: an offer whose host expiry has passed goes (builder.ts offerPresets, review L2), so
     * one lapsing while the screen is open leaves on the next draw. */
    fun at(now: Instant): TradeIdeas =
        copy(places = places.filter { place -> (place as? IdeaPlace.Offer)?.offer?.endsAt?.isAfter(now) ?: true })

    /** builder.ts moreWords: "8 more", null when every place is drawn. */
    fun more(all: Boolean): String? {
        val hidden = places.size - visible(all).size
        return if (hidden > 0) "$hidden more" else null
    }

    companion object {
        /** builder.ts IDEAS_SHOWN. */
        const val SHOWN = 3
    }
}

/**
 * The Trades screen at one read (TradeScreen.svelte, builder-first since Lane 260): our ideas, the picks
 * it opens with, the verb and the platform's page, and the basis once under the builder. The answer drawn
 * at `now`; every rule is the API's, nothing is computed but the words and the order.
 */
class TradesModel(
    answer: TradeAdvice,
    host: LeagueHost,
    now: Instant,
    zone: ZoneId,
    /** The platform's words: the league's own, or the store graphics' neutral one (Lane 310). */
    words: HostWords = HostWords.of(host),
) {
    private val advice: TradeAdvice = TradeFinder.held(answer, now)
    private val presets = TradeFinder.presets(advice.teams)

    val platform: String = words.name
    val verb: String = TradesWords.verb(advice.moves, words)

    /** The platform's trade page the verb opens; null when the API knows none, and the verb stands
     * disabled with [reason] under it. */
    val page: String? = advice.hostTradesUrl.ifEmpty { null }
    val reason: String? = if (advice.hostTradesUrl.isEmpty()) advice.hostNote else null

    val ideas: TradeIdeas =
        TradeIdeas(
            Words.Analyzer.ideas,
            IdeaPlace.row(TradeOffers.presets(advice, platform, now, zone), presets, NoIdeaLine.of(advice.teams)),
        )

    /** The builder's opening picks: our best trade's team, nothing ticked. */
    val opening: TradePicks = TradePicks(presets.firstOrNull { it.lead }?.rosterId, emptyList(), emptyList())

    /** The phone's basis paragraph, the record's link after it. */
    val basis: String =
        run {
            val lines = advice.roster + advice.teams.flatMap { team -> team.roster + team.trades.flatMap { it.give + it.get } }
            TradesBasis.phone(TradesBasis.Facts(advice, host, lines, zone, now))
        }

    /** The ticks the place with this key loads at `now`, null for one that loads nothing. */
    fun picks(
        key: String,
        now: Instant,
    ): TradePicks? =
        ideas
            .at(now)
            .places
            .firstOrNull { it.key == key }
            ?.picks
}

/** trades.ts's finder as the builder's ideas read it: its rows, the strip's pick, the held week. */
object TradeFinder {
    /** A trade of the finder with its team and its key. */
    class Entry(
        val key: String,
        val team: TradeTeam,
        val row: TradeRow,
    )

    /** state.ts tradeKey: "8:96>12481+8116". */
    fun key(
        team: Int,
        row: TradeRow,
    ): String {
        val ids = { side: List<PlayerLine> -> side.map { it.player.hostId }.sorted().joinToString("+") }
        return "$team:${ids(row.give)}>${ids(row.get)}"
    }

    /** trades.ts tradeRank, the finder's one team order on the API's own keys (Lane 290 review M3): a trade
     * that is not a close call for them first, then one that fills a slot of the member's, then the member's
     * gain on the printed tenth. Ties keep the answer's order, the standings'. */
    private val rank: Comparator<Entry> =
        compareBy<Entry> { it.row.closeForThem }
            .thenByDescending { it.row.fills != null }
            .thenByDescending { TradesWords.shown(it.row.myGain) }

    /** trades.ts finderRows with each team's best: its first trade (the API's order within a team kept), the
     * teams by tradeRank (a stable sort, as JavaScript's). */
    fun best(teams: List<TradeTeam>): List<Entry> =
        teams
            .flatMap { team -> team.trades.take(1).map { Entry(key(team.rosterId, it), team, it) } }
            .sortedWith(rank)

    /** trades.ts worthProposing: each team's best the other team gains from, at most two. */
    fun worthProposing(teams: List<TradeTeam>): List<Entry> = best(teams).filter { !it.row.closeForThem && it.row.myGain > 0 }.take(2)

    /** builder.ts presetsFrom: each team's best whose players can all be ticked, in the finder's order; the
     * lead is our best trade, marked Best where there is more than one idea (strip.ts stripMark). */
    fun presets(teams: List<TradeTeam>): List<TradePreset> {
        val proposed = worthProposing(teams).firstOrNull()?.key
        val loadable = best(teams).mapNotNull { entry -> TradeBuilder.built(entry.team.rosterId, entry.row)?.let { entry to it } }
        return loadable.mapIndexed { index, (entry, picks) ->
            val row = entry.row
            val lead = entry.key == proposed
            TradePreset(
                key = entry.key,
                rosterId = entry.team.rosterId,
                team = entry.team.name,
                with = "${Words.Trades.with} ${entry.team.name}",
                mark = if (lead && index == 0 && loadable.size > 1) Words.Strip.best else null,
                gains =
                    "${TradesWords.gain(row.myGain)} ${Words.Analyzer.yours}, " +
                        "${TradesWords.gain(row.theirGain)} ${Words.Analyzer.theirs}",
                deal = "${TradesWords.shortSide(row.give)} ${TradesWords.FOR} ${TradesWords.shortSide(row.get)}",
                fills = TradesWords.fills(row.fills),
                picks = picks,
                lead = lead,
            )
        }
    }

    /** trades.ts heldTrades: every trade's week change held once a player it moves has kicked off. */
    fun held(
        advice: TradeAdvice,
        now: Instant,
    ): TradeAdvice = advice.copy(teams = advice.teams.map { team -> team.copy(trades = team.trades.map { TradeChecks.held(it, now) }) })
}
