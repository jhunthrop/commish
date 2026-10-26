package app.trycommish.core.shell

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource

/** Which links open signed out (B213, iOS's aRouteOpensSignedOutOnlyWherePublic): one case per screen,
 * the web's public pages open at once and the account's, a league's and the companion's wait. */
class ShellRouteTest {
    @ParameterizedTest(name = "{0} opens signed out: {1}")
    @MethodSource("routes")
    fun `a link opens signed out only where its page is public`(
        route: ShellRoute,
        public: Boolean,
    ) {
        assertEquals(public, route.isPublic)
    }

    companion object {
        @JvmStatic
        fun routes(): List<Arguments> =
            listOf(
                Arguments.of(ShellRoute.Players("puka"), true),
                Arguments.of(ShellRoute.Player("puka-nacua"), true),
                Arguments.of(ShellRoute.Adp("ppr-12"), true),
                Arguments.of(ShellRoute.Compare("puka-nacua", null), true),
                Arguments.of(ShellRoute.Clubs, true),
                Arguments.of(ShellRoute.Club("LAR"), true),
                Arguments.of(ShellRoute.Schedule, true),
                Arguments.of(ShellRoute.MockSetup(), true),
                Arguments.of(ShellRoute.SharedMock("abc123"), true),
                Arguments.of(ShellRoute.Account, false),
                Arguments.of(ShellRoute.LeagueHome("league"), false),
                Arguments.of(ShellRoute.Game("league", null), false),
                Arguments.of(ShellRoute.CompanionNew(replay = false), false),
                Arguments.of(ShellRoute.Companion("draft"), false),
            )
    }
}
