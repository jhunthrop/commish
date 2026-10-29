package app.trycommish.core.push

import java.net.URI
import java.net.URISyntaxException
import java.net.URLDecoder

/** What a tapped push opens: a followed league's screen, or the league list. */
sealed interface PushDestination {
    data class League(
        val route: PushRoute,
    ) : PushDestination

    data object LeagueList : PushDestination
}

/** One tap on a push: the route its payload names (null for none this build reads). Not a data class, so the
 * same push tapped twice opens twice. */
class PushTap(
    val route: PushRoute?,
)

/** The screens a push opens, the tabs of the league it names. */
enum class PushScreen { League, Lineup, Waivers }

/**
 * Where a push opens the app (Lane 288): the screen its `path` names for the league it names
 * (shared/fixtures/parity/push.json, the API's payload; the iOS PushRoute's). `/league/<id>` is the
 * league's home, `/league/<id>/start` its lineup (`?player=` the player it is about),
 * `/league/<id>/waivers` its waivers. Any other path, an absolute URL or none opens the app where it was.
 */
data class PushRoute(
    val screen: PushScreen,
    val league: String,
    val player: String? = null,
) {
    companion object {
        /** The payload's key that names the screen. */
        const val PATH_KEY = "path"
        private const val LEAGUE = "league"
        private const val LINEUP = "start"
        private const val WAIVERS = "waivers"
        private const val PLAYER = "player"
        private const val HOME_SEGMENTS = 2
        private const val SCREEN_SEGMENTS = 3
        private const val UTF_8 = "UTF-8"

        /** Where a tapped push opens the shell (review M1): its route when it names a league the member
         * follows, else the league list (the switch), so a push for a league since detached, or a path this
         * build does not draw, still lands somewhere that says what is followed. */
        fun destination(
            route: PushRoute?,
            following: List<String>,
        ): PushDestination = if (route != null && route.league in following) PushDestination.League(route) else PushDestination.LeagueList

        /** The route a push's data names (FCM's data map, or a tapped notification's extras). */
        fun of(data: Map<String, String?>): PushRoute? = data[PATH_KEY]?.let(::ofPath)

        /** The route a site path names; null for one the app does not open from a push. */
        fun ofPath(path: String): PushRoute? {
            if (!path.startsWith("/") || path.startsWith("//")) return null
            val uri =
                try {
                    URI(path)
                } catch (e: URISyntaxException) {
                    return null
                }
            if (uri.scheme != null || uri.host != null) return null
            val segments =
                uri.path
                    .orEmpty()
                    .split("/")
                    .filter { it.isNotEmpty() }
            if (segments.size < HOME_SEGMENTS || segments[0] != LEAGUE) return null
            val league = segments[1]
            return when {
                segments.size == HOME_SEGMENTS -> PushRoute(PushScreen.League, league)
                segments.size == SCREEN_SEGMENTS && segments[2] == LINEUP ->
                    PushRoute(PushScreen.Lineup, league, player(uri.rawQuery))
                segments.size == SCREEN_SEGMENTS && segments[2] == WAIVERS -> PushRoute(PushScreen.Waivers, league)
                else -> null
            }
        }

        private fun player(query: String?): String? =
            query
                ?.split("&")
                ?.map { it.split("=", limit = 2) }
                ?.firstOrNull { it.size == 2 && it[0] == PLAYER }
                ?.let { URLDecoder.decode(it[1], UTF_8) }
                ?.takeIf { it.isNotEmpty() }
    }
}
