package app.trycommish.core

import app.trycommish.api.models.LeaguePhase
import app.trycommish.api.models.SiteSeason
import app.trycommish.core.shell.FollowedLeague
import app.trycommish.design.Rail
import app.trycommish.design.RailItem

/** The rail key the web reads for a league's phase (nav.ts railKey): the phase, or "playoffs_waivers"
 * while the playoffs' wire is open; null for a phase this build does not know. */
fun railKey(
    phase: LeaguePhase,
    waiversOpen: Boolean,
): String? =
    when (phase) {
        LeaguePhase.unknown_default_open_api -> null
        LeaguePhase.playoffs -> if (waiversOpen) "playoffs_waivers" else phase.value
        else -> phase.value
    }

/** The bottom bar's five: the shown league's phase rail; with no league (or a phase this build does
 * not know) the bar by the site's season, the web's railShown over railPhase(null, season), where no
 * season read and a season this build does not know read as in season. */
fun phoneBar(
    league: FollowedLeague?,
    season: SiteSeason.Phase?,
): List<RailItem> =
    league?.let { railKey(it.phase, it.waiversOpen) }?.let { Rail.byKey[it] }
        ?: Rail.withoutLeagueBySeason[season?.value]
        ?: Rail.withoutLeague
