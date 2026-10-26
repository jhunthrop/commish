package app.trycommish.core.companion

import app.trycommish.api.models.CompanionHost
import app.trycommish.api.models.CompanionStatus
import app.trycommish.api.models.LeaguePhase
import app.trycommish.api.models.NamedPick
import app.trycommish.core.companion.CompanionFixtures.Moment
import app.trycommish.core.companion.CompanionParity.parity
import app.trycommish.core.leaguehome.DraftDayEntry
import app.trycommish.design.Words
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import java.time.Instant
import java.time.ZoneId

/** The sentences the replay never reaches, over edited copies of a recorded answer; our why's first
 * sentence and the shortlist with it; and the League home's draft-day entry
 * (shared/fixtures/parity/companion.json edges, shortlistWhy, draftDay), as the iOS parity holds them. */
class CompanionEdgesParityTest {
    private val edges = requireNotNull(parity.obj("edges"))
    private val between = CompanionFixtures.answer(Moment.Between)

    @Test
    fun `the turn's words off the replay are the web's`() {
        assertEquals(edges.text("preDraft"), CompanionWords.turn(between.copy(status = CompanionStatus.pre_draft)))
        assertEquals(edges.text("paused"), CompanionWords.turn(between.copy(status = CompanionStatus.paused)))
        assertEquals(edges.text("pausedOnTurn"), CompanionWords.turn(between.copy(status = CompanionStatus.paused, yourTurn = true)))
        assertEquals(edges.text("lastPicksIn"), CompanionWords.turn(between.copy(yourNextPick = null, picksUntilTurn = null)))
        assertEquals(edges.text("over"), CompanionWords.turn(between.copy(status = CompanionStatus.complete)))
        assertEquals(edges.text("ffpcTurn"), CompanionWords.turn(between.copy(host = CompanionHost.ffpc)))
    }

    @Test
    fun `the stale, lost and unnamed words are the web's`() {
        assertEquals(edges.text("stale"), CompanionWords.stale(between.copy(hostStaleSeconds = 14)))
        assertEquals(edges.text("lost"), CompanionWords.lost(between.copy(lostAt = 37)))
        assertEquals(edges.text("unnamed"), CompanionWords.draftName(""))
        assertEquals(edges.text("ffpcURL"), CompanionWords.draftUrl(CompanionHost.ffpc, between.hostDraftId))
    }

    @Test
    fun `the notes are the web's`() {
        val named =
            listOf(
                NamedPick("Kenneth Walker", "Kenneth Walker III"),
                NamedPick("Marvin Harrison", "Marvin Harrison Jr."),
                NamedPick("DJ Moore", "D.J. Moore"),
                NamedPick("Hollywood Brown", "Marquise Brown"),
            )
        assertEquals(edges.strings("notesOne"), CompanionWords.notes(between.copy(unplaced = 1, traded = 1), named.take(1)))
        assertEquals(edges.strings("notesMany"), CompanionWords.notes(between.copy(unplaced = 3, traded = 2), named))
    }

    @Test
    fun `the chance words off the replay are the web's`() {
        val last = requireNotNull(between.card).copy(conditional = false, nextPick = null)
        assertEquals(edges.text("chanceLast"), CompanionWords.chanceLabel(last, between.teams))
        val missing = requireNotNull(edges.obj("missing"))
        assertEquals(missing.text("gone"), RoomWords.chanceMissing(gone = true, read = false))
        assertEquals(missing.text("coming"), RoomWords.chanceMissing(gone = false, read = false))
        assertEquals(edges.obj("empty")?.text("left"), RoomWords.poolEmpty("K"))
    }

    @Test
    fun `our why's first sentence is the web's`() {
        edges.list("whys").forEach { why ->
            val text = requireNotNull(why.text("text"))
            assertEquals(why.text("first"), Sentence.first(text), text)
        }
    }

    @Test
    fun `the shortlist with our why is the web's`() {
        val whys = edges.list("whys").mapNotNull { it.text("text") }
        val first = CompanionFixtures.answer(Moment.Waiting)
        val board = RoomBoardView.of(requireNotNull(first.board), first.teams)
        val turn = CompanionFixtures.answer(Moment.Turn)
        val card = requireNotNull(turn.card)
        val written = card.copy(shortlist = card.shortlist.mapIndexed { index, entry -> entry.copy(why = whys[index % whys.size]) })
        val ours = CompanionModel.shortlist(written, board, turn.teams, turn.ranges.orEmpty())
        CompanionParityTest.expectShortlist(ours, parity.list("shortlistWhy"))
    }

    @Test
    fun `the League home's draft-day entry is the web's`() {
        val web = requireNotNull(parity.obj("draftDay"))
        val now = Instant.parse(requireNotNull(web.text("now")))
        listOf("chicago" to "America/Chicago", "newYork" to "America/New_York").forEach { (key, id) ->
            val lines = requireNotNull(web.obj(key))
            val zone = ZoneId.of(id)
            val line = { at: String? -> DraftDayEntry.draftLine(at?.let(Instant::parse), now, zone) }
            assertEquals(lines.text("unset"), line(null))
            assertEquals(lines.text("onNow"), line("2026-09-06T14:00:00Z"))
            assertEquals(lines.text("today"), line("2026-09-06T23:00:00Z"))
            assertEquals(lines.text("tomorrow"), line("2026-09-07T23:30:00Z"))
            assertEquals(lines.text("later"), line("2026-09-10T00:00:00Z"))
            assertEquals(lines.text("zone"), DraftDayEntry.zoneLine(zone))
            val entry = requireNotNull(DraftDayEntry.of(LeaguePhase.draft_day, null, now, zone))
            assertEquals(web.text("verb"), entry.verb)
            assertEquals(listOfNotNull(web.text("turns"), lines.text("zone")).joinToString(" "), entry.line)
        }
        // Before the draft the same panel carries Start a mock draft (SeasonPanel.svelte pre_draft, Lane 214).
        val before = requireNotNull(DraftDayEntry.of(LeaguePhase.pre_draft, null, now, ZoneId.of("America/Chicago")))
        assertEquals(Words.PageVerb.mock, before.verb)
        assertEquals(DraftDayEntry.Opens.Mock, before.opens)
        assertNull(DraftDayEntry.of(LeaguePhase.in_season, null, now, ZoneId.of("America/Chicago")))
    }
}
