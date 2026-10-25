package app.trycommish.core.reference

import app.trycommish.core.shell.PlayerSheetHost
import app.trycommish.core.shell.SheetOffer
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.ShellRoute
import app.trycommish.core.shell.SiteLinks
import app.trycommish.design.Words
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/** The reference pages' site links (web links.ts) and the routes the app pushes for them, and the sheet's
 * Compare offer (shelf-state.ts compareOffer) with him on one side. */
class ReferenceLinksTest {
    @Test
    fun `the site's reference links are the web's`() {
        assertEquals("${SiteLinks.ORIGIN}/adp/ppr-12", SiteLinks.adp("ppr-12"))
        assertEquals("${SiteLinks.ORIGIN}/clubs/ari", SiteLinks.club("ARI"))
        assertEquals("${SiteLinks.ORIGIN}/compare", SiteLinks.compare())
        assertEquals("${SiteLinks.ORIGIN}/compare?a=chris-olave", SiteLinks.compare("chris-olave"))
        assertEquals("${SiteLinks.ORIGIN}/compare?a=chris-olave&b=nico-collins", SiteLinks.compare("chris-olave", "nico-collins"))
    }

    @Test
    fun `each reference link opens its screen in the app, any other link the site`() {
        assertEquals(ShellRoute.Adp("half-ppr-12"), SiteLinks.reference(SiteLinks.adp("half-ppr-12")))
        assertEquals(ShellRoute.Compare("a-b", "c-d"), SiteLinks.reference(SiteLinks.compare("a-b", "c-d")))
        assertEquals(ShellRoute.Compare("a-b", null), SiteLinks.reference("${SiteLinks.ORIGIN}/compare?a=a-b&b="))
        assertEquals(ShellRoute.Clubs, SiteLinks.reference(SiteLinks.CLUBS))
        assertEquals(ShellRoute.Club("cin"), SiteLinks.reference(SiteLinks.club("CIN")))
        assertEquals(ShellRoute.Schedule, SiteLinks.reference(SiteLinks.SCHEDULE))
        assertNull(SiteLinks.reference(SiteLinks.MOCK_SETUP))
        assertNull(SiteLinks.reference(SiteLinks.player("puka-nacua")))
        assertNull(SiteLinks.reference("https://example.com/clubs"))
    }

    @Test
    fun `the sheet's Compare offer sets him on one side`() {
        val opened = mutableListOf<String>()
        val player = SheetPlayer("4426515", "puka-nacua", "Puka Nacua", "WR", "1", "LAR", null)
        val offer = SheetOffer.compare(player) { opened += it }
        assertEquals(Words.Card.compare, offer.label)
        assertNull(offer.line)
        assertFalse(offer.lineup)
        val host = PlayerSheetHost()
        host.open(player, offer)
        host.offer?.act?.invoke()
        assertEquals(listOf(SiteLinks.compare("puka-nacua")), opened)
        assertEquals(ShellRoute.Compare("puka-nacua", null), SiteLinks.reference(opened.single()))
    }
}
