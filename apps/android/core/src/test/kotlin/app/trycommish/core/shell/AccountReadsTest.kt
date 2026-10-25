package app.trycommish.core.shell

import app.trycommish.api.Transport
import app.trycommish.api.Unauthorized
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/** The account's calls on the wire: GET /me read whole, PUT /me/league with the league's id, every
 * answer but a 401 no change for the app. */
class AccountReadsTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")
    private val leagues = ShellFixtures.three()
    private val error = """{"ok":false,"data":null,"error":{"code":"not_found","message":"no such league"}}"""

    private fun reads(
        status: HttpStatusCode,
        body: String = ShellFixtures.meBody(leagues, leagues[0].id),
        seen: MutableList<String> = mutableListOf(),
    ) = ApiAccountReads(
        Transport(
            "http://api.test",
            MockEngine { request ->
                val sent = (request.body as? OutgoingContent.ByteArrayContent)?.bytes()?.decodeToString().orEmpty()
                seen += "${request.method.value} ${request.url.encodedPath} $sent"
                respond(body, status, json)
            },
            token = { "tok" },
        ),
    )

    @Test
    fun `GET me is read whole and decodes to the shell's account`() =
        runTest {
            val seen = mutableListOf<String>()
            val account = accountContext(reads(HttpStatusCode.OK, seen = seen).me())
            assertEquals(listOf("${HttpMethod.Get.value} /me "), seen)
            assertEquals(leagues, account.leagues)
            assertEquals(leagues[0].id, account.selected)
        }

    @Test
    fun `the choice is PUT to me league with its id`() =
        runTest {
            val seen = mutableListOf<String>()
            reads(HttpStatusCode.OK, seen = seen).selectLeague(leagues[1].id)
            assertEquals(listOf("""PUT /me/league {"league_id":"${leagues[1].id}"}"""), seen)
        }

    @Test
    fun `a 404, 400 or 500 on the write is no change`() =
        runTest {
            listOf(HttpStatusCode.NotFound, HttpStatusCode.BadRequest, HttpStatusCode.InternalServerError).forEach {
                reads(it, body = error).selectLeague(leagues[1].id)
            }
        }

    @Test
    fun `a 401 on the read or the write throws Unauthorized`() =
        runTest {
            assertThrows<Unauthorized> { reads(HttpStatusCode.Unauthorized, body = error).me() }
            assertThrows<Unauthorized> { reads(HttpStatusCode.Unauthorized, body = error).selectLeague(leagues[1].id) }
        }
}
