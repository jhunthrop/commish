package app.trycommish.core.player

import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.matchup.MatchupFixtures
import app.trycommish.core.matchup.MatchupModel
import app.trycommish.core.matchup.matchupModel
import app.trycommish.core.start.StartFixtures
import app.trycommish.core.start.startModel
import app.trycommish.core.waivers.WaiverFixtures
import app.trycommish.core.waivers.WaiverModel
import app.trycommish.core.waivers.WaiverRows
import app.trycommish.design.Words
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** What Start, Matchup and Waivers hand the sheet as its verb (the iOS PlayerSheetOfferTests): the
 * Lineup's swap line under its way back, the Matchup's way to the lineup on the member's own rows only,
 * and Waivers' claim in the screen's words with its pair and gain, every row's player carrying his board
 * id so his week is read by it. */
class ScreenOffersTest {
    @Test
    fun `the lineup's way back says the swap that names his row`() {
        val clock = StartFixtures.WEEK
        val model = startModel(StartFixtures.lineup(clock), StartFixtures.ffpc, StartFixtures.instant(clock), Fixtures.zone)
        assertTrue(model.swaps.isNotEmpty(), "the fixture's advice makes a swap")
        val players = model.sheetPlayers
        assertTrue(players.all { it.boardId != null }, "every row's player carries his board id")
        val lines = players.mapNotNull { player -> model.rowOf(player)?.let(model::swapLine) }
        assertTrue(lines.isNotEmpty(), "a swapped row's sheet says its swap")
        assertTrue(lines.all { it.contains(Words.Lineup.swapIn) })
    }

    @Test
    fun `the matchup offers the lineup on the member's own rows only`() {
        val clock = MatchupFixtures.BEFORE
        val model = matchupModel(MatchupFixtures.sync(clock), MatchupFixtures.box(clock), StartFixtures.instant(clock), Fixtures.zone)
        val week = (model as MatchupModel.Week).week
        val mine =
            week.boxes
                .first { it.mine }
                .starters
                .mapNotNull { it.sheetPlayer }
        val theirs =
            week.boxes
                .filterNot { it.mine }
                .flatMap { it.starters }
                .mapNotNull { it.sheetPlayer }
        assertTrue(mine.isNotEmpty())
        assertTrue(mine.all(week::isMine))
        assertFalse(theirs.any(week::isMine))
    }

    @Test
    fun `waivers offer the claim with its pair and gain`() {
        val week = StartFixtures.instant(WaiverFixtures.WEEK)
        val model = WaiverModel(WaiverFixtures.waivers(WaiverFixtures.FFPC), null, Fixtures.sync().host, week, Fixtures.zone)
        val row = model.rows.first { it.sheetPlayer != null && it.stash == null }
        assertNotNull(row.sheetPlayer?.boardId)
        val (label, line) = model.sheetOffer(row)
        val advised = model.drops(row).firstOrNull()
        assertEquals(model.verb(WaiverRows.with(row.source, advised)), label)
        assertTrue(line.startsWith(model.pairWords(row.source, advised)), line)
        assertTrue(line.contains(Words.Waivers.gain), line)
    }
}
