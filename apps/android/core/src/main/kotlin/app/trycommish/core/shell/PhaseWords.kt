package app.trycommish.core.shell

import app.trycommish.api.models.BoardFormat
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.LeaguePhase
import app.trycommish.api.models.ScoringPreset
import app.trycommish.core.Format
import app.trycommish.core.leaguehome.ValueWords
import app.trycommish.design.Words
import java.time.Duration
import java.time.Instant
import java.time.ZoneId

/** A draft this far off is named by its weekday, further off by its date. */
private val WEEK_AHEAD: Duration = Duration.ofDays(6)

/**
 * A league's place in its season in a word, beside its name in the league switch: a port of
 * web/src/lib/league/phase-words.ts phaseWord, held to the web by shared/fixtures/parity/shell.json.
 * "Draft Mon 7:00 pm", "Draft today 7:00 pm", "Drafting", "Drafted", "Playoffs", "Season over"; a
 * phase this build does not know reads as in season. Every instant on the member's own clock.
 */
fun phaseWord(
    phase: LeaguePhase,
    draftAt: Instant?,
    now: Instant,
    zone: ZoneId,
): String =
    when (phase) {
        LeaguePhase.playoffs -> "Playoffs"
        LeaguePhase.offseason -> "Season over"
        LeaguePhase.pre_draft, LeaguePhase.draft_day -> draftWord(phase, draftAt, now, zone)
        else -> "Drafted"
    }

/** menu-words.ts phaseWords: each league's phase word by its id, only when the leagues are not all in
 * one phase; empty when they agree. */
fun phaseWords(
    leagues: List<FollowedLeague>,
    now: Instant,
    zone: ZoneId,
): Map<String, String> {
    if (leagues.map { known(it.phase) }.toSet().size < 2) return emptyMap()
    return leagues.associate { it.id to phaseWord(it.phase, it.draftAt, now, zone) }
}

/** A phase this build does not know counts as in season, as phaseWord reads it. */
private fun known(phase: LeaguePhase): LeaguePhase = if (phase == LeaguePhase.unknown_default_open_api) LeaguePhase.in_season else phase

private fun draftWord(
    phase: LeaguePhase,
    draftAt: Instant?,
    now: Instant,
    zone: ZoneId,
): String {
    if (draftAt == null) return if (phase == LeaguePhase.draft_day) "Drafting" else "Not drafted"
    if (!draftAt.isAfter(now)) return "Drafting"
    val ahead = Duration.between(now, draftAt)
    val near = nearDay(draftAt, now, zone)
    if (near != null) return "Draft $near ${Format.timeOfDay(draftAt, zone)}"
    return if (ahead <= WEEK_AHEAD) "Draft ${Format.weekdayTime(draftAt, zone)}" else "Draft ${Format.shortDay(draftAt, zone)}"
}

/** "today" or "tomorrow" for an instant on those days of the member's clock, else null. */
private fun nearDay(
    at: Instant,
    now: Instant,
    zone: ZoneId,
): String? =
    when {
        Format.sameDay(at, now, zone) -> "today"
        Format.sameDay(at, now.plus(Duration.ofDays(1)), zone) -> "tomorrow"
        else -> null
    }

/**
 * menu-words.ts leagueLine: the league's platform and scoring under its name in the switch, "Sleeper,
 * PPR", "FFPC, extra points per catch for tight ends", with its lineup when it reads on its own board,
 * "Sleeper, half PPR, superflex". A scoring this build does not know leaves the platform alone.
 */
fun leagueLine(league: FollowedLeague): String {
    val parts = listOfNotNull(ValueWords.platform(league.host), league.scoring?.let(::scoringWords))
    val board = if (league.format == BoardFormat.superflex) listOf("superflex") else emptyList()
    return (parts + board).joinToString(", ")
}

/** names.ts SCORING_WORDS, TE premium in the switch's own words (menu-words.ts TE_PREMIUM_WORDS). */
private fun scoringWords(scoring: ScoringPreset): String? =
    when (scoring) {
        ScoringPreset.ppr -> Words.Scoring.ppr
        ScoringPreset.half_ppr -> Words.Scoring.half_ppr
        ScoringPreset.standard -> Words.Scoring.standard
        ScoringPreset.te_premium -> Words.LeagueSwitch.tePremium
        else -> null
    }

/** names.ts followedName: the league's own name, or its platform's when its read has none yet ("Your
 * Yahoo league"). */
fun followedName(league: FollowedLeague): String = followedName(league.name, league.host)

/** names.ts followedName from a league's name and platform, as the Account's table reads it. */
fun followedName(
    name: String,
    host: LeagueHost,
): String = name.ifEmpty { "Your ${ValueWords.platform(host)} league" }
