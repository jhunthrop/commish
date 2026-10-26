package app.trycommish.core.companion

import app.trycommish.core.shell.ShellRoute
import app.trycommish.core.shell.SiteLinks
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/** The site's companion links open in the app (links.ts companionNew and companion), as the iOS AppLink's
 * do: the start page, the start page with the development replay, a followed draft; the section's own
 * address and any other path are left to the site. */
class CompanionLinksTest {
    private val origin = SiteLinks.ORIGIN

    @Test
    fun `the site's companion links open in the app`() {
        assertEquals(ShellRoute.CompanionNew(replay = false), SiteLinks.companion("$origin/companion/new"))
        assertEquals(ShellRoute.CompanionNew(replay = true), SiteLinks.companion("$origin/companion/new?replay=1"))
        assertEquals(ShellRoute.Companion(CompanionFixtures.ID), SiteLinks.companion("$origin/companion/${CompanionFixtures.ID}"))
        assertNull(SiteLinks.companion("$origin/companion"))
        assertNull(SiteLinks.companion("$origin/companion/a/b"))
        assertNull(SiteLinks.companion("$origin/board"))
    }
}
