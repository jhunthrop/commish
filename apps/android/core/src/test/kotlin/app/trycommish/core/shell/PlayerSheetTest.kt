package app.trycommish.core.shell

import app.trycommish.design.Words
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/** The player sheet frame every screen presents from a row: its head from the row's own facts, his
 * full page as the site's app link, the shelf's words while his week is read, and the same player kept
 * when the screen under it reads again (plan Review Focus 3: the sheet holds his id, never the row's
 * place). */
class PlayerSheetTest {
    private val rows =
        listOf(
            SheetPlayer("p-1", "puka-nacua", "Puka Nacua", "WR", "4", "LAR", null),
            SheetPlayer("p-2", "bijan-robinson", "Bijan Robinson", "RB", "1", "ATL", null),
            SheetPlayer("p-3", "sam-laporta", "Sam LaPorta", "TE", null, "DET", null),
        )

    @Test
    fun `the head is the row's facts`() {
        val model = playerSheetModel(rows[1])
        assertEquals("Bijan Robinson", model.name)
        assertEquals("BR", model.initials)
        assertEquals("RB 1", model.pill)
        assertEquals("ATL", model.club)
        assertEquals("TE", playerSheetModel(rows[2]).pill)
    }

    @Test
    fun `the face is the row's https headshot, and none where the row has none`() {
        val face = "https://a.espncdn.com/i/headshots/nfl/players/full/4426515.png"
        assertEquals(face, playerSheetModel(rows[0].copy(headshot = face)).headshot)
        assertNull(playerSheetModel(rows[0]).headshot)
        assertEquals(face, headshotOf(face))
        assertNull(headshotOf("http://a.espncdn.com/x.png"))
        assertNull(headshotOf(""))
        assertNull(headshotOf(null))
    }

    @Test
    fun `initials are the web's`() {
        assertEquals("JC", initialsOf("Ja'Marr Chase"))
        assertEquals("KJ", initialsOf("Kyle Juszczyk Jr."))
        assertEquals("PU", initialsOf("Puka"))
        assertEquals("", initialsOf("  "))
    }

    @Test
    fun `the full page is the site's player page`() {
        val model = playerSheetModel(rows[0])
        assertEquals("https://trycommish.app/players/puka-nacua", model.fullPage)
        assertEquals(Words.Shelf.fullPage, model.fullPageWords)
        assertEquals(Words.Shelf.close, model.closeWords)
        assertEquals("puka-nacua", SiteLinks.playerSlug(model.fullPage))
        assertNull(SiteLinks.playerSlug("https://trycommish.app/app/signed-in"))
        assertNull(SiteLinks.playerSlug("https://example.com/players/puka-nacua"))
    }

    @Test
    fun `while his week is read the body says what the shelf says`() {
        val web = ShellFixtures.parity.sheetLoading
        assertEquals(web, playerSheetModel(rows[0]).loading)
        assertEquals(web, unreadBasis(failed = false, weekTile = Words.Card.proj))
    }

    @Test
    fun `the sheet presents and dismisses`() {
        val host = PlayerSheetHost()
        assertNull(host.shown.value)
        host.open(rows[1])
        assertEquals("p-2", host.shown.value?.id)
        host.close()
        assertNull(host.shown.value)
    }

    @Test
    fun `Full page closes the sheet as it opens his page`() {
        val host = PlayerSheetHost()
        host.open(rows[0])
        assertEquals(ShellRoute.Player("puka-nacua"), host.followFullPage(playerSheetModel(rows[0]).fullPage))
        assertNull(host.shown.value)
        host.open(rows[0])
        assertNull(host.followFullPage("https://example.com/players/puka-nacua"))
        assertEquals(rows[0], host.shown.value)
    }

    @Test
    fun `a parent refresh keeps the player the row named`() {
        val host = PlayerSheetHost()
        host.open(rows[1])
        // The list reads again: a new order, his row moved and its facts fresh.
        val fresher = rows[1].copy(rank = "2")
        host.parentRefreshed(listOf(rows[2], rows[0], fresher))
        assertEquals(fresher, host.shown.value)
        // A refresh that no longer lists him keeps him as he was shown.
        host.parentRefreshed(listOf(rows[0]))
        assertEquals(fresher, host.shown.value)
        // A refresh with the sheet closed opens nothing.
        host.close()
        host.parentRefreshed(rows)
        assertNull(host.shown.value)
    }
}
