package app.trycommish.core.player

import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.PlayerLine
import app.trycommish.api.models.PlayerVerb
import app.trycommish.api.models.PlayerWeek
import app.trycommish.core.leaguehome.ValueWords
import app.trycommish.core.shell.LINEUP_PAGE
import app.trycommish.core.shell.WAIVERS_PAGE
import app.trycommish.core.start.LineRead
import app.trycommish.design.Words
import java.time.Instant

/** The one verb the league's screens give him, as his page pins it (web/src/lib/player/week-words.ts
 * CardVerb): its words, where it goes, and the line under it. */
data class CardVerb(
    val label: String,
    val target: Target,
    val note: String?,
) {
    /** Where the verb goes: one of the app's league screens, or the platform's own page. */
    sealed interface Target {
        data object Lineup : Target

        data object Trades : Target

        data object Waivers : Target

        /** The platform's waiver page: his name is put on the clipboard first, so its search takes it. */
        data class Platform(
            val url: String,
        ) : Target
    }
}

/** The bar's Trades page (Rail.generated.kt's trades item). */
private const val TRADES_PAGE = "trades"

/** The bar's page the verb opens, null for the platform's own page. */
val CardVerb.Target.page: String?
    get() =
        when (this) {
            CardVerb.Target.Lineup -> LINEUP_PAGE
            CardVerb.Target.Waivers -> WAIVERS_PAGE
            CardVerb.Target.Trades -> TRADES_PAGE
            is CardVerb.Target.Platform -> null
        }

/** week-words.ts verbOf, heldVerb and verbFits, held to the parity's verbs. */
object CardVerbs {
    /** verbOf: the verb in the platform's name; null for a kind this build does not know. */
    fun of(
        verb: PlayerVerb,
        host: LeagueHost,
    ): CardVerb? {
        val platform = ValueWords.platform(host)
        return when (verb.kind) {
            PlayerVerb.Kind.start -> CardVerb(Words.Card.startHim, CardVerb.Target.Lineup, null)
            PlayerVerb.Kind.lineup -> CardVerb(Words.Card.openLineup, CardVerb.Target.Lineup, null)
            PlayerVerb.Kind.trade -> CardVerb("Trade for him", CardVerb.Target.Trades, null)
            PlayerVerb.Kind.claim -> CardVerb("Add on $platform", CardVerb.Target.Waivers, verb.note)
            PlayerVerb.Kind.waivers -> waivers(verb, platform)
            PlayerVerb.Kind.unknown_default_open_api -> null
        }
    }

    private fun waivers(
        verb: PlayerVerb,
        platform: String,
    ): CardVerb {
        val address =
            verb.hostUrl?.takeIf { it.startsWith("https://") }
                ?: return CardVerb(Words.Card.findOnWaivers, CardVerb.Target.Waivers, verb.note)
        val note =
            verb.note
                ?: "Claims are not sent to $platform from here, so this copies his name and opens $platform's waiver page."
        return CardVerb("Open $platform waivers", CardVerb.Target.Platform(address), note)
    }

    /** heldVerb: Start him becomes the way to the lineup once his game has kicked off. */
    fun held(
        verb: PlayerVerb,
        line: PlayerLine,
        now: Instant,
    ): PlayerVerb =
        if (verb.kind == PlayerVerb.Kind.start &&
            LineRead.started(line, now)
        ) {
            verb.copy(kind = PlayerVerb.Kind.lineup)
        } else {
            verb
        }

    /** verbFits: his lineup's verbs only while the week's lineup can still be set, by its last kickoff on
     * the run's schedule (a week the schedule does not hold keeps them); the others always. */
    fun fits(
        verb: PlayerVerb,
        lastKickoff: Instant?,
        now: Instant,
    ): Boolean {
        val lineup = verb.kind == PlayerVerb.Kind.start || verb.kind == PlayerVerb.Kind.lineup
        return !lineup || (lastKickoff?.isAfter(now) ?: true)
    }

    /** The page's verb from his week in the league at the page's clock: none with no league, a verb that no
     * longer fits the week, or a kind this build does not know. */
    fun pinned(
        week: PlayerWeek,
        host: LeagueHost,
        lastKickoff: Instant?,
        now: Instant,
    ): CardVerb? {
        val verb = week.verb?.takeIf { fits(it, lastKickoff, now) } ?: return null
        return of(held(verb, week.line, now), host)
    }
}
