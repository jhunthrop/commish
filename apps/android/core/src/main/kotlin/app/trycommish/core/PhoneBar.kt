package app.trycommish.core

import app.trycommish.api.models.LeaguePhase
import app.trycommish.core.leaguehome.LeagueChoice
import app.trycommish.design.Rail
import app.trycommish.design.RailItem

/** The rail key the web reads for a league's phase (rail-order.ts railOfKey): the phase, or
 * "playoffs_waivers" while the playoffs' wire is open; null for a phase this build does not know. */
fun railKey(
    phase: LeaguePhase,
    waiversOpen: Boolean,
): String? =
    when (phase) {
        LeaguePhase.unknown_default_open_api -> null
        LeaguePhase.playoffs -> if (waiversOpen) "playoffs_waivers" else phase.value
        else -> phase.value
    }

/** The bottom bar's five for what the League tab opened: the chosen league's phase rail, else the
 * season's bar with no league (RAIL_WITHOUT_LEAGUE). */
fun phoneBar(choice: LeagueChoice?): List<RailItem> {
    val chosen = choice as? LeagueChoice.Chosen ?: return Rail.withoutLeague
    return railKey(chosen.phase, chosen.waiversOpen)?.let { Rail.byKey[it] } ?: Rail.withoutLeague
}
