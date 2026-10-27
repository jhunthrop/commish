package app.trycommish.core.account

import app.trycommish.api.ApiFailure
import app.trycommish.api.Transport
import app.trycommish.api.Unauthorized
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.io.File

/** The Account's routes through the generated clients: the fixture's answers decode, an answer without
 * the fields this screen can go without still reads, the writes' methods and paths, a refused restore's
 * sentence, and a 401. */
class AccountScreenReadsTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")
    private val inseason = File(System.getProperty("fixtures"), "inseason")
    private val league = AccountFixtures.SHOWN[1]
    private var asked: List<String> = emptyList()

    private fun reads(answer: MockRequestHandleScope.(HttpRequestData) -> HttpResponseData): AccountScreenReads =
        ApiAccountScreenReads(
            Transport(
                "http://api.test",
                MockEngine { request ->
                    asked = asked + "${request.method.value} ${request.url.encodedPath}"
                    answer(request)
                },
                token = { "t" },
            ),
        )

    private fun MockRequestHandleScope.ok(body: String) = respond(body, HttpStatusCode.OK, json)

    @Test
    fun `the fixture's answers decode`() =
        runTest {
            val reads =
                reads { request ->
                    when (request.url.encodedPath) {
                        "/me" -> ok(File(inseason, "me.json").readText())
                        "/leagues/attached" -> ok(File(inseason, "leagues-attached.json").readText())
                        "/devices" -> ok(File(inseason, "devices.json").readText())
                        else -> ok("""{"ok":true,"data":{"season":2026,"free_season":true},"error":null}""")
                    }
                }
            assertEquals("fixture@example.com", reads.me().email)
            assertEquals(12, reads.attached().size)
            assertEquals(listOf("iPhone", "Chrome on a Mac"), reads.devices().map { it.name })
            assertEquals(true, reads.freeSeasonFlag())
            assertEquals(listOf("GET /me", "GET /leagues/attached", "GET /devices", "GET /billing/plans"), asked)
        }

    @Test
    fun `an answer without the optional fields still reads`() =
        runTest {
            val reads =
                reads { request ->
                    when (request.url.encodedPath) {
                        "/me" -> ok("""{"ok":true,"data":{"email":"m@example.com","created_at":"2026-09-01T12:00:00Z"}}""")
                        else -> ok("""{"ok":true,"data":{"season":2026}}""")
                    }
                }
            val me = reads.me()
            assertEquals("m@example.com", AccountWords.displayName(me))
            assertEquals(emptyList<String>(), me.features)
            assertNull(reads.freeSeasonFlag())
        }

    @Test
    fun `detach, restore and unpair send their methods and paths`() =
        runTest {
            val reads = reads { ok("""{"ok":true,"data":null,"error":null}""") }
            reads.detach(league)
            reads.restore(league)
            reads.revokeDevice(AccountFixtures.OTHER)
            assertEquals(
                listOf(
                    "${HttpMethod.Delete.value} /leagues/attached/$league",
                    "${HttpMethod.Post.value} /leagues/attached/$league/restore",
                    "${HttpMethod.Delete.value} /devices/${AccountFixtures.OTHER}",
                ),
                asked,
            )
        }

    @Test
    fun `a refused restore carries the API's sentence and a 401 throws Unauthorized`() =
        runTest {
            val sentence = "Following more than one league is part of Membership."
            val refused =
                reads {
                    respond(
                        """{"ok":false,"data":null,"error":{"code":"many_leagues","message":"$sentence"}}""",
                        HttpStatusCode.Forbidden,
                        json,
                    )
                }
            assertEquals(sentence, assertThrows<ApiFailure> { refused.restore(league) }.message)
            val lapsed = reads { respond("", HttpStatusCode.Unauthorized, json) }
            assertThrows<Unauthorized> { lapsed.me() }
            assertThrows<Unauthorized> { lapsed.detach(league) }
        }

    @Test
    fun `a delete posts the typed email and a 204 is done`() =
        runTest {
            var sent = ""
            val reads =
                reads { request ->
                    sent = (request.body as TextContent).text
                    respond("", HttpStatusCode.NoContent)
                }
            reads.deleteAccount(" Fixture@Example.com ")
            assertEquals(listOf("${HttpMethod.Post.value} /me/delete"), asked)
            assertEquals("""{"email":" Fixture@Example.com "}""", sent)
        }

    @Test
    fun `a refused delete says the API's sentence for the email, a renewing membership's, and a 401 signs out`() =
        runTest {
            val wrong =
                reads {
                    respond(
                        """{"ok":false,"data":null,"error":{"code":"invalid","message":"Some of that did not check out",""" +
                            """"fields":{"email":"Type the email you sign in with"}}}""",
                        HttpStatusCode.BadRequest,
                        json,
                    )
                }
            val refusal = assertThrows<ApiFailure> { wrong.deleteAccount("other@example.com") }
            assertEquals("Type the email you sign in with", refusal.message)
            assertEquals(400, refusal.status)
            val renewing = "Cancel your membership first, so your card is not charged again"
            val membership =
                reads {
                    respond(
                        """{"ok":false,"data":null,"error":{"code":"conflict","message":"$renewing"}}""",
                        HttpStatusCode.Conflict,
                        json,
                    )
                }
            assertEquals(renewing, assertThrows<ApiFailure> { membership.deleteAccount("fixture@example.com") }.message)
            val lapsed = reads { respond("", HttpStatusCode.Unauthorized, json) }
            assertThrows<Unauthorized> { lapsed.deleteAccount("fixture@example.com") }
        }
}
