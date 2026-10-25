package app.trycommish.design

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

/** A face is asked of the site's image route at the web's widths (headshot.ts headshotAt and
 * headshotSources), so the disk cache holds thumbnails; any other address draws the initials and is
 * never asked of its host. */
class HeadshotsTest {
    private val espn = "https://a.espncdn.com/i/headshots/nfl/players/full/4426515.png"

    @Test
    fun `a provider headshot is the site's route at its width`() {
        assertEquals("https://trycommish.app/img/headshots/nfl/4426515/96", Headshots.sized(espn, 96))
        assertEquals(
            "https://trycommish.app/img/headshots/college-football/4685720/96",
            Headshots.sized("https://a.espncdn.com/i/headshots/college-football/players/full/4685720.png", 96),
        )
    }

    @Test
    fun `the width stays inside what the route serves`() {
        assertEquals("https://trycommish.app/img/headshots/nfl/4426515/16", Headshots.sized(espn, 4))
        assertEquals("https://trycommish.app/img/headshots/nfl/4426515/480", Headshots.sized(espn, 900))
    }

    @Test
    fun `any other address is none, so the row draws the initials`() {
        assertNull(Headshots.sized("https://example.com/face.png", 96))
        assertNull(Headshots.sized("https://a.espncdn.com/i/headshots/nba/players/full/1.png", 96))
        assertNull(Headshots.sized("http://a.espncdn.com/i/headshots/nfl/players/full/4426515.png", 96))
        assertNull(Headshots.sized("https://a.espncdn.com/i/headshots/nfl/players/full/4426515.png?x=1", 96))
    }

    @Test
    fun `a face asks for the web's two widths, overfilled at 1x and twice that on a denser screen`() {
        assertEquals(56, Headshots.widthFor(40f, 1f))
        assertEquals(112, Headshots.widthFor(40f, 2f))
        assertEquals(112, Headshots.widthFor(40f, 2.625f))
        assertEquals(45, Headshots.widthFor(32f, 1f))
    }
}
