package app.trycommish.api

import app.trycommish.api.models.RunBoardAnswer
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.math.BigDecimal

/** The run's routes through the generated client: the kept ETag goes out as the API gave it (never
 * URI-encoded, the iOS generator's bug), a 304 reaches the caller with its ETag, and the run's figures
 * read as written. */
class RunRoutesTest {
    private val tag = "W/\"2026-10-21T12-ros/boards/ppr-12.json\""
    private val board =
        """{"ok":true,"data":{"run_id":"2026-10-21T12-ros","format":"ppr-12","rows":[{"id":"1","slug":"a-b","name":"A B",""" +
            """"position":"WR","positionRank":1,"team":"LAR","headshot":"https://x/1.png","ourRank":1,"vorRound":1,"adp":1.5,""" +
            """"projected":344.1,"vor":164.1,"expectedGames":17,"floor":null,"median":null,"ceiling":null,"tier":1,""" +
            """"tierDrop":23.4,"gap":0.1}],"market":[]},"error":null,"request_id":"r"}"""

    @Test
    fun `the kept ETag is sent raw and a 304 reaches the caller with its ETag`() =
        runTest {
            val sent = mutableListOf<String?>()
            val engine =
                MockEngine { request ->
                    sent += request.headers[HttpHeaders.IfNoneMatch]
                    respond("", HttpStatusCode.NotModified, headersOf(HttpHeaders.ETag, tag))
                }
            val answer = Transport("http://api.test", engine, token = { null }).run().runBoard("ppr-12", tag)
            assertEquals(listOf(tag), sent)
            assertEquals(HTTP_NOT_MODIFIED, answer.status)
            assertEquals(tag, answer.response.headers[HttpHeaders.ETag])
        }

    @Test
    fun `a board's figures read exactly as the API wrote them`() =
        runTest {
            val engine = MockEngine { respond(board, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json")) }
            val answer: RunBoardAnswer = Transport("http://api.test", engine, token = { null }).run().runBoard("ppr-12", null).data()
            val row = answer.rows.single()
            assertEquals(BigDecimal("344.1"), row.projected)
            assertEquals(BigDecimal("23.4"), row.tierDrop)
            assertEquals(BigDecimal("0.1"), row.gap)
        }

    private companion object {
        const val HTTP_NOT_MODIFIED = 304
    }
}
