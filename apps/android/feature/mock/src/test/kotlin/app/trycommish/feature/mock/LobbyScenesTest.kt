package app.trycommish.feature.mock

import app.trycommish.design.Words
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The lobby's mock shows the states it names, as the iOS snapshot tests check theirs. */
class LobbyScenesTest {
    @Test
    fun theLandingHasThreeCardsOneYourSeat() {
        val landing = LobbyScenes.landing()
        assertEquals(3, landing.cards.size)
        assertEquals(listOf(Words.Lobby.yourSeat, Words.Lobby.join, Words.Lobby.join), landing.cards.map { it.verb })
    }

    @Test
    fun theRoomBeforeTheStartWaitsWithNoScoreBug() {
        val model = LobbyScenes.model("filling")
        assertNotNull(model.wait)
        assertNull(model.bug)
    }

    @Test
    fun theRoomOnYourTurnDraftsAndBetweenTurnsQueues() {
        val turn = LobbyScenes.model("yourTurn")
        assertTrue(turn.yourTurn)
        assertEquals(Words.Lobby.now, turn.bug?.yourPick)
        assertTrue(turn.call?.drafts == true)
        val between = LobbyScenes.model("between")
        assertFalse(between.yourTurn)
        assertTrue(between.call == null || between.call?.drafts == false)
    }
}
