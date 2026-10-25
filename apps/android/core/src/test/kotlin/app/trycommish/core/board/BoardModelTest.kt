package app.trycommish.core.board

import app.trycommish.design.Words
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The Board's model over the fixture runs. Review Focus 4: under every filter the tier breaks and each
 * row's position number are the run's own (his positionRank and tier), never renumbered after a player
 * is filtered out or held on a season-long list; the chips are the run's formats and the positions it
 * carries; the columns, the bye and the round tint follow the run.
 */
class BoardModelTest {
    private val standIn = RunFixture.StandIn.read()
    private val contract = RunFixture.Contract.read()

    private fun model(
        read: RunBoardRead = standIn,
        position: BoardPosition? = null,
        inSeason: Boolean = false,
        following: Boolean = false,
    ): BoardModel =
        BoardModel.of(
            read,
            position,
            inSeason,
            following,
            if (inSeason) RunFixture.inSeason else RunFixture.preDraft,
            RunFixture.zone,
        )

    @Test
    fun `under every filter each row's number is the run's place at his position`() {
        val byId = standIn.board.rows.associateBy { it.id }
        val statuses = standIn.designations?.players.orEmpty()
        (listOf<BoardPosition?>(null) + BoardPosition.entries.filterNot { it.draftOrder }).forEach { position ->
            model(position = position).rows.forEach { row ->
                val run = byId.getValue(row.id)
                val rank = if (statuses[row.id]?.seasonLong == true) row.status?.rank else run.positionRank.toString()
                assertEquals("${row.pill.substringBefore(' ')} $rank", row.pill, "${position?.id} ${row.name}")
            }
        }
    }

    @Test
    fun `a position's tier breaks are the run's tiers in its order`() {
        val statuses = standIn.designations?.players.orEmpty()
        BoardPosition.entries.filterNot { it.draftOrder }.forEach { position ->
            val run =
                standIn.board.rows
                    .filter { it.position.value == position.id && statuses[it.id]?.seasonLong != true }
                    .sortedBy { it.positionRank }
            val drawn = model(position = position).sections.filter { it.band != null }
            assertEquals(run.map { it.id }, drawn.flatMap { s -> s.rows.map { it.id } }, position.id)
            assertEquals(run.map { it.tier }.distinct(), drawn.map { it.band?.tier }, position.id)
            drawn.forEach { section ->
                val tiers = section.rows.map { row -> run.first { it.id == row.id }.tier }.distinct()
                assertEquals(listOf(section.band?.tier), tiers, "${position.id} ${section.id}")
            }
        }
    }

    @Test
    fun `a position's season-long list sits under its own head after its tiers`() {
        val wr = model(position = BoardPosition.Receiver)
        val held = wr.sections.last()
        assertEquals(Words.Board.heldHead, held.head)
        assertTrue(held.rows.isNotEmpty())
        assertTrue(held.rows.all { it.status?.onList == true && it.gap == Words.Box.none })
    }

    @Test
    fun `the chips are the run's formats and the positions its board carries`() {
        val all = model()
        assertEquals(listOf("ppr-12" to true), all.formats.map { it.value to it.pressed })
        assertEquals(listOf("All", "QB", "RB", "WR", "TE", "K", "DST"), all.positions.map { it.label })
        assertEquals(listOf(true), all.positions.filter { it.pressed }.map { it.value == null })
        val rest = model(contract, inSeason = true)
        assertEquals(listOf("ppr-12", "half-ppr-12", "standard-12"), rest.formats.map { it.value })
        assertEquals(listOf("All", "QB", "RB"), rest.positions.map { it.label })
    }

    @Test
    fun `the columns are the run's, the Gap before the season and none in season, the drafts order for kickers`() {
        assertEquals(BoardColumns.Ranked(gap = true), model().columns)
        assertEquals(BoardColumns.Ranked(gap = false), model(contract, inSeason = true).columns)
        val kickers = model(position = BoardPosition.Kicker)
        assertEquals(BoardColumns.DraftOrder, kickers.columns)
        assertTrue(kickers.rows.all { it.sheetPlayer == null && it.heat == Heat.None })
    }

    @Test
    fun `the round tint is the run's vorRound and rose below replacement`() {
        val byId = standIn.board.rows.associateBy { it.id }
        model().rows.forEach { row ->
            val run = byId.getValue(row.id)
            assertEquals(Heat.of(run.vor.toDouble(), run.vorRound), row.heat, row.name)
        }
        assertEquals(Heat.Below, Heat.of(-0.1, 1))
        assertEquals(Heat.None, Heat.of(4.0, 5))
    }

    @Test
    fun `in season the head says the rest of the season and a bye before its week is done`() {
        val rest = model(contract, inSeason = true)
        assertEquals("Rest of 2026", rest.words.heading)
        assertEquals("PPR points for the rest of the 2026 season from week 7, refreshed October 21", rest.restLine)
        assertEquals(PageVerb.Follow, rest.words.verb)
        assertNull(model(contract, inSeason = true, following = true).words.verb)
        assertEquals(PageVerb.Mock, model().words.verb)
    }

    @Test
    fun `a row opens the sheet on his id with the row's own facts`() {
        val row = model(position = BoardPosition.Receiver).rows.first()
        val player = requireNotNull(row.sheetPlayer)
        assertEquals(row.id, player.id)
        assertEquals(row.pill, "${player.position} ${player.rank}")
        assertEquals(row.club, player.club)
    }
}
