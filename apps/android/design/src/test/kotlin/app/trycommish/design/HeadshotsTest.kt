package app.trycommish.design

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** A face is asked of the site's image route at its drawn width (web headshot.ts headshotAt), so the
 * disk cache holds thumbnails; any other address is asked as it is. */
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
    fun `any other address is asked as it is`() {
        val other = "https://example.com/face.png"
        assertEquals(other, Headshots.sized(other, 96))
        val league = "https://a.espncdn.com/i/headshots/nba/players/full/1.png"
        assertEquals(league, Headshots.sized(league, 96))
    }

    @Test
    fun `a face asks for its side overfilled as the web's does`() {
        assertEquals(113, Headshots.widthFor(80.5f))
        assertEquals(56, Headshots.widthFor(40f))
    }
}
