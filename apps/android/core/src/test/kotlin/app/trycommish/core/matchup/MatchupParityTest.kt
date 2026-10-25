package app.trycommish.core.matchup

import app.trycommish.api.CommishJson
import app.trycommish.api.models.LeagueHost
import app.trycommish.core.leaguehome.Fixtures
import app.trycommish.core.start.StartFixtures
import app.trycommish.core.start.TeamRow
import app.trycommish.core.start.rowOf
import app.trycommish.core.start.rows
import app.trycommish.core.start.text
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.MethodSource
import java.time.Instant

/**
 * The Matchup's port held to the web's Matchup at 390 (shared/fixtures/parity/matchup.json), as the iOS
 * port is: the title, the score bug (each side's figures, the game's head and words, the read beside a
 * live score, the standing), the notes, each team's box (every row's cells, the Team row, the bench, the
 * sentence for starters a platform does not send) and the phone's basis at all six fixture clocks; the
 * same reads without the box; and every gap sentence with no matchup.
 */
class MatchupParityTest {
    private val parity: JsonObject = CommishJson.parseToJsonElement(MatchupFixtures.parity()).jsonObject

    private fun web(
        clock: String,
        box: Boolean,
    ): JsonObject =
        parity
            .getValue(if (box) "clocks" else "withoutBox")
            .jsonObject
            .getValue(clock)
            .jsonObject

    private fun week(
        clock: String,
        box: Boolean,
    ): MatchupWeek {
        val model =
            matchupModel(
                MatchupFixtures.sync(clock),
                if (box) MatchupFixtures.box(clock) else null,
                StartFixtures.instant(clock),
                Fixtures.zone,
            )
        return (model as? MatchupModel.Week)?.week ?: error("no week at $clock")
    }

    private fun sideOf(side: JsonObject?): List<String?>? =
        side?.let { listOf(it.text("label"), it.text("name"), it.text("big"), it.text("bigLabel"), it.text("small"), it.text("toPlay")) }

    private fun sideOf(team: BugTeam?): List<String?>? = team?.let { listOf(it.label, it.name, it.big, it.bigLabel, it.small, it.toPlay) }

    @ParameterizedTest
    @MethodSource("cases")
    fun `the title and the bug are the web's`(
        clock: String,
        box: Boolean,
    ) {
        val web = web(clock, box)
        val week = week(clock, box)
        val title = web.getValue("title").jsonObject
        val bug = web.getValue("bug").jsonObject
        val kickoff = bug["kickoff"] as? JsonObject
        assertEquals(web.text("week"), week.week)
        assertEquals(title.text("mine"), week.mine)
        assertEquals(title.text("opponent"), week.opponent)
        assertEquals(bug.text("week"), week.bug.week)
        assertEquals(sideOf(bug["mine"] as? JsonObject), sideOf(week.bug.mine))
        assertEquals(sideOf(bug["opponent"] as? JsonObject), sideOf(week.bug.opponent))
        assertEquals(kickoff?.text("head"), week.bug.head)
        assertEquals(kickoff?.text("words").orEmpty(), week.bug.words)
        assertEquals(bug.getValue("started").jsonPrimitive.boolean, week.bug.started)
        assertEquals(bug.text("read"), week.bug.read)
        assertEquals(bug.text("standing"), week.bug.standing)
    }

    @ParameterizedTest
    @MethodSource("cases")
    fun `the notes are the web's`(
        clock: String,
        box: Boolean,
    ) {
        val web = web(clock, box)
        val week = week(clock, box)
        assertEquals(listOfNotNull(web.text("allPlay"), web.text("scoreGap")), week.notes)
        assertEquals(web.text("noOpponent"), week.noOpponent)
    }

    @ParameterizedTest
    @MethodSource("cases")
    fun `every box is the web's`(
        clock: String,
        box: Boolean,
    ) {
        val boxes = web(clock, box).getValue("boxes").jsonArray.map { it.jsonObject }
        val week = week(clock, box)
        assertEquals(boxes.size, week.boxes.size)
        boxes.zip(week.boxes).forEach { (theirs, ours) ->
            val label = "$clock ${ours.team}"
            assertEquals(theirs.text("team"), ours.team, label)
            assertEquals(theirs.getValue("mine").jsonPrimitive.boolean, ours.mine, label)
            assertEquals(theirs.text("empty"), ours.empty, label)
            assertEquals(theirs.rows("starters"), ours.starters.map(::rowOf), label)
            val team = theirs.getValue("team_row").jsonObject
            assertEquals(
                TeamRow(
                    team.text("note"),
                    team.getValue("live").jsonPrimitive.boolean,
                    team.text("caption"),
                    team.text("proj").orEmpty(),
                    team.text("pts").orEmpty(),
                ),
                ours.teamRow,
                label,
            )
            assertEquals(theirs.rows("bench"), ours.bench.map(::rowOf), "$label bench")
        }
    }

    @ParameterizedTest
    @MethodSource("cases")
    fun `the basis is the web's phone paragraph`(
        clock: String,
        box: Boolean,
    ) {
        assertEquals(web(clock, box).text("basis"), week(clock, box).basis)
    }

    @Test
    fun `a week we hold no game for says the read we could not make`() {
        val clock = StartFixtures.clocks.first()
        val gaps = parity.getValue("gaps").jsonObject
        val sync = MatchupFixtures.sync(clock).copy(matchup = null)
        val at = StartFixtures.instant(clock)
        assertEquals(
            MatchupModel.Gap(
                gaps
                    .getValue("unread")
                    .jsonObject
                    .text("gap")
                    .orEmpty(),
            ),
            matchupModel(sync, null, at, Fixtures.zone),
        )
        assertEquals(
            MatchupModel.Gap(
                gaps
                    .getValue("noWeek")
                    .jsonObject
                    .text("gap")
                    .orEmpty(),
            ),
            matchupModel(sync.copy(week = 0), null, at, Fixtures.zone),
        )
    }

    /** Every branch of the gap sentences (model.ts readLine and agoWords): fresh, signed out, not
     * answering and reading again, each just now, in minutes and in hours, on FFPC and on Sleeper. */
    @Test
    fun `every read line is the web's`() {
        val base = MatchupFixtures.sync(StartFixtures.clocks.first())
        val reads =
            parity
                .getValue("gaps")
                .jsonObject
                .getValue("reads")
                .jsonArray
                .map { it.jsonObject }
        assertEquals(READ_CASES, reads.size)
        reads.forEach { read ->
            val state = read.text("state")
            val sync =
                base.copy(
                    host = LeagueHost.entries.first { it.value == read.text("host") },
                    hostSignedOut = state == "signedOut",
                    hostFailed = state == "failed",
                    hostStaleSeconds = if (state == "stale") STALE_SECONDS else 0,
                )
            val now =
                Instant.parse(base.readAt).plusSeconds(
                    read
                        .getValue("seconds")
                        .jsonPrimitive.double
                        .toLong(),
                )
            val label = "${read.text("host")} $state ${read.text("age")}"
            assertEquals(read.text("gap"), MatchupWords.gap(sync, now), label)
            assertEquals(read.text("scoreGap"), MatchupWords.scoreGap(sync, now), label)
        }
    }

    /** Another team's game at every clock (Lane 207, as iOS Lane 206): drawn from its own box and the
     * Sleeper league's scoreboard, its head the web's whose line, no You or Opponent, no note and no box
     * or row of the member's, every cell and the basis the web's. */
    @ParameterizedTest
    @MethodSource("clocks")
    fun `another team's game is the web's`(clock: String) {
        val web =
            parity
                .getValue("otherGame")
                .jsonObject
                .getValue(clock)
                .jsonObject
        val model =
            matchupModel(
                MatchupFixtures.otherSync(clock),
                MatchupFixtures.otherBox(clock),
                StartFixtures.instant(clock),
                Fixtures.zone,
                MatchupFixtures.otherBoard(clock),
            )
        val week = (model as? MatchupModel.Week)?.week ?: error("no week at $clock")
        val whose = web.getValue("whose").jsonObject
        assertEquals(GameWhose(whose.text("head").orEmpty(), whose.text("link").orEmpty()), week.whose)
        val title = web.getValue("title").jsonObject
        val bug = web.getValue("bug").jsonObject
        val kickoff = bug["kickoff"] as? JsonObject
        assertEquals(web.text("week"), week.week)
        assertEquals(title.text("mine"), week.mine)
        assertEquals(title.text("opponent"), week.opponent)
        assertEquals(sideOf(bug["mine"] as? JsonObject), sideOf(week.bug.mine), clock)
        assertEquals(sideOf(bug["opponent"] as? JsonObject), sideOf(week.bug.opponent), clock)
        assertTrue(!week.bug.mine.me && week.bug.opponent?.me != true)
        assertEquals(kickoff?.text("head"), week.bug.head)
        assertEquals(kickoff?.text("words").orEmpty(), week.bug.words)
        assertEquals(bug.text("read"), week.bug.read)
        assertEquals(bug.text("standing"), week.bug.standing)
        assertEquals(listOfNotNull(web.text("allPlay"), web.text("scoreGap")), week.notes)
        val boxes = web.getValue("boxes").jsonArray.map { it.jsonObject }
        assertEquals(boxes.map { it.text("team") }, week.boxes.map { it.team })
        assertEquals(boxes.map { it.getValue("mine").jsonPrimitive.boolean }, week.boxes.map { it.mine })
        boxes.zip(week.boxes).forEach { (theirs, ours) ->
            val label = "$clock ${ours.team}"
            assertEquals(theirs.text("empty"), ours.empty, label)
            assertEquals(theirs.rows("starters"), ours.starters.map(::rowOf), label)
            val team = theirs.getValue("team_row").jsonObject
            assertEquals(team.text("proj").orEmpty(), ours.teamRow.proj, label)
            assertEquals(team.text("pts").orEmpty(), ours.teamRow.pts, label)
            assertEquals(theirs.rows("bench"), ours.bench.map(::rowOf), "$label bench")
        }
        assertEquals(web.text("basis"), week.basis)
        assertTrue(week.sheetPlayers.none(week::isMine))
    }

    /** No screen computes game state: every line the fixture's boxes hold carries the API's field. */
    @ParameterizedTest
    @MethodSource("clocks")
    fun `every line carries the API's game state`(clock: String) {
        val lines = MatchupFixtures.box(clock).sides.flatMap { side -> side.starters.map { it.line } + side.bench }
        assertTrue(lines.isNotEmpty() && lines.all { it.gameState != null }, clock)
    }

    companion object {
        private const val READ_CASES = 24
        private const val STALE_SECONDS = 120

        @JvmStatic
        fun clocks(): List<String> = StartFixtures.clocks

        @JvmStatic
        fun cases(): List<Array<Any>> = StartFixtures.clocks.flatMap { listOf(arrayOf<Any>(it, true), arrayOf<Any>(it, false)) }
    }
}
