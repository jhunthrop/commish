package app.trycommish.core.shell

import app.trycommish.core.AppWords
import app.trycommish.design.RailItem
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId

/** One league in the switch's list: its name, its platform and scoring on the line under it, its phase
 * word where the account's leagues differ, and whether it is the one the app shows. */
data class LeagueSwitchRow(
    val id: String,
    val name: String,
    val line: String,
    val phase: String?,
    val selected: Boolean,
)

/**
 * The top bar's league switch (web/src/lib/context/LeagueSwitch.svelte and LeagueMenu.svelte): its
 * face names the league the app shows, and opened it lists every followed league as GET /me lists
 * them, newest first, the selected one marked in place. Choosing one opens its home (B149). With none
 * followed the face says how to follow one and the list says where.
 */
data class LeagueSwitchModel(
    val face: String,
    val title: String,
    val rows: List<LeagueSwitchRow>,
    /** Said in place of the list with no league followed. */
    val none: String?,
)

fun leagueSwitch(
    leagues: List<FollowedLeague>,
    selected: String?,
    now: Instant,
    zone: ZoneId,
): LeagueSwitchModel {
    val phases = phaseWords(leagues, now, zone)
    val rows =
        leagues.map { league ->
            LeagueSwitchRow(league.id, followedName(league), leagueLine(league), phases[league.id], league.id == selected)
        }
    return LeagueSwitchModel(
        face = rows.firstOrNull { it.selected }?.name ?: Words.LeagueSwitch.followFirst,
        title = Words.Shell.yourLeagues,
        rows = rows,
        none = if (leagues.isEmpty()) AppWords.followNone else null,
    )
}

/** Where the shell sends the member: a screen pushed on the tab in view. */
sealed interface ShellRoute {
    /** The Players screen with what was typed in the bar's search. */
    data class Players(
        val query: String,
    ) : ShellRoute

    /** The account's way in. */
    data object Account : ShellRoute

    /** A league's home, pushed where the bar has no League tab. */
    data class LeagueHome(
        val id: String,
    ) : ShellRoute

    /** A player's page, by his site link (the sheet's Full page, or a link from elsewhere). */
    data class Player(
        val slug: String,
    ) : ShellRoute
}

/** Where a choice in the shell lands: a tab of the bar, or a screen pushed on the tab in view. */
sealed interface ShellDestination {
    data class Tab(
        val page: String,
    ) : ShellDestination

    data class Push(
        val route: ShellRoute,
    ) : ShellDestination
}

/** The League tab's page, the selected league's home. */
const val LEAGUE_PAGE = "league"

/** The Lineup tab's page, the selected league's Start screen. */
const val LINEUP_PAGE = "start"

/** The Matchup tab's page, the selected league's week as a box score. */
const val MATCHUP_PAGE = "matchup"

/** Where a league home's Open Lineup goes: the Lineup tab where the bar has one and the home is the
 * league the tabs show; null where it has none (a home pushed for a league whose bar has no Lineup),
 * which the app opens on the site. */
fun lineupOf(
    leagueId: String,
    shown: String?,
    bar: List<RailItem>,
): ShellDestination.Tab? = ShellDestination.Tab(LINEUP_PAGE).takeIf { leagueId == shown && bar.any { it.page == LINEUP_PAGE } }

/** Where choosing a league in the switch opens its home: the League tab where the bar has one (the
 * tab shows the selected league), else the home pushed on the tab in view (B149). */
fun homeOf(
    leagueId: String,
    bar: List<RailItem>,
): ShellDestination =
    if (bar.any { it.page == LEAGUE_PAGE }) ShellDestination.Tab(LEAGUE_PAGE) else ShellDestination.Push(ShellRoute.LeagueHome(leagueId))

/** The Players screen for what was typed, null when nothing was. */
fun searchRoute(typed: String): ShellRoute.Players? = typed.trim().takeIf { it.isNotEmpty() }?.let(ShellRoute::Players)
