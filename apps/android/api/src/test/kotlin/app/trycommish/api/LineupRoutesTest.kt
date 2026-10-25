package app.trycommish.api

import app.trycommish.api.models.GameStateCell
import app.trycommish.api.models.HostMoveChange
import app.trycommish.api.models.HostMoveConfirm
import app.trycommish.api.models.HostMoveInput
import app.trycommish.api.models.HostMovePlan
import app.trycommish.api.models.HostMoveResult
import app.trycommish.api.models.LineupAdvice
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import java.io.File
import java.util.UUID

/** The Start screen's routes through the generated client: the lineup at every fixture clock with each
 * line's game state, an older answer without the later fields, and the move's plan and make with their
 * bodies, their answers and a refusal's sentence per field. */
class LineupRoutesTest {
    private val leagueId = UUID.fromString("6f1d1c52-2626-4a26-9a26-000000000026")
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun lineupBody(clock: String): String = File(System.getProperty("fixtures"), "inseason/lineup-$leagueId-$clock.json").readText()

    private fun transport(engine: MockEngine) = Transport("http://api.test", engine, token = { "t" })

    private val move =
        HostMoveInput(
            kind = HostMoveInput.Kind.lineup,
            week = 6,
            changes =
                listOf(
                    HostMoveChange(HostMoveChange.Slot.QB, "4046", "96"),
                    HostMoveChange(HostMoveChange.Slot.FLEX, "7543", null),
                ),
        )

    @ParameterizedTest
    @ValueSource(
        strings = [
            "2026-10-16T02-00-00Z", "2026-10-17T17-00-00Z", "2026-10-18T18-56-00Z",
            "2026-10-19T16-00-00Z", "2026-10-20T00-40-00Z", "2026-10-20T17-00-00Z",
        ],
    )
    fun `the lineup reads at every clock with each line's game state`(clock: String) =
        runTest {
            val engine = MockEngine { respond(lineupBody(clock), HttpStatusCode.OK, json) }
            val advice: LineupAdvice = transport(engine).leagueSync().leagueLineup(leagueId).data()
            assertEquals(6, advice.week)
            val lines = advice.slots.flatMap { listOfNotNull(it.ours, it.host) } + advice.bench + advice.reserve
            assertTrue(lines.all { it.gameState != null && it.gameState?.state != GameStateCell.State.unknown_default_open_api })
        }

    @Test
    fun `an older answer without the later fields still reads`() {
        val later = Regex("\"(projected_final|basis_note_list|week_done|week_done_state|missed|game_state|games_played)\":")
        val advice = decodeEnvelope<LineupAdvice>(lineupBody("2026-10-17T17-00-00Z").replace(later, "\"old_$1\":"))
        assertNull(advice.projectedFinal)
        assertNull(
            advice.slots
                .first()
                .ours.gameState,
        )
    }

    @Test
    fun `the plan sends the move and reads its sentence and token`() =
        runTest {
            var sent: String? = null
            var path: String? = null
            val plan =
                """{"ok":true,"data":{"status":"ready","sentence":"Start Patrick Mahomes over Aaron Rodgers at QB on ESPN now.",""" +
                    """"confirm":"tok-1","expires_at":null,"host_url":"https://fantasy.espn.com/football/team","bid":null},"error":null}"""
            val engine =
                MockEngine { request ->
                    path = request.url.encodedPath
                    sent = (request.body as TextContent).text
                    respond(plan, HttpStatusCode.OK, json)
                }
            val answer: HostMovePlan = transport(engine).leagueSync().planHostMove(leagueId, move).data()
            assertEquals("/leagues/attached/$leagueId/moves/plan", path)
            assertEquals(
                """{"kind":"lineup","week":6,"changes":[{"slot":"QB","in":"4046","out":"96"},{"slot":"FLEX","in":"7543","out":null}]}""",
                sent,
            )
            assertEquals(HostMovePlan.Status.ready, answer.status)
            assertEquals("tok-1", answer.confirm)
        }

    @Test
    fun `the make sends the move with its token and reads the outcome in the platform's words`() =
        runTest {
            var path: String? = null
            val made =
                """{"ok":true,"data":{"outcome":"refused","sentence":"ESPN did not take the move, and nothing changed.",""" +
                    """"host_words":"Alexander Mattison is locked","host_url":"https://fantasy.espn.com/football/team",""" +
                    """"move_id":null,"processes_at":null},"error":null}"""
            val engine =
                MockEngine { request ->
                    path = request.url.encodedPath
                    respond(made, HttpStatusCode.OK, json)
                }
            val result: HostMoveResult = transport(engine).leagueSync().makeHostMove(leagueId, HostMoveConfirm(move, "tok-1")).data()
            assertEquals("/leagues/attached/$leagueId/moves", path)
            assertEquals(HostMoveResult.Outcome.refused, result.outcome)
            assertEquals("Alexander Mattison is locked", result.hostWords)
        }

    @Test
    fun `a refused move carries the API's sentence per field`() =
        runTest {
            val body =
                """{"ok":false,"data":null,"error":{"code":"invalid","message":"The move was refused.",""" +
                    """"fields":{"confirm":"That confirmation has been used. Plan the move again."}}}"""
            val engine = MockEngine { respond(body, HttpStatusCode.Conflict, json) }
            val failure =
                assertThrows<ApiFailure> {
                    transport(engine).leagueSync().makeHostMove(leagueId, HostMoveConfirm(move, "tok-1")).data<HostMoveResult>()
                }
            assertEquals(409, failure.status)
            assertEquals("That confirmation has been used. Plan the move again.", failure.fields["confirm"])
        }
}
