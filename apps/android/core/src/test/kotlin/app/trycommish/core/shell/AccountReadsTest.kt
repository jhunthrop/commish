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
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
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
        logoutHost: String = WORKOS_LOGOUT_HOST,
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
        logoutHost,
    )

    private fun signOutBody(url: String) = """{"ok":true,"data":{"url":"$url"},"error":null}"""

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
            assertTrue(reads(HttpStatusCode.OK, seen = seen).selectLeague(leagues[1].id))
            assertEquals(listOf("""PUT /me/league {"league_id":"${leagues[1].id}"}"""), seen)
        }

    @Test
    fun `a 404, 400 or 500 on the write is not taken, and throws nothing`() =
        runTest {
            listOf(HttpStatusCode.NotFound, HttpStatusCode.BadRequest, HttpStatusCode.InternalServerError).forEach {
                assertFalse(reads(it, body = error).selectLeague(leagues[1].id))
            }
        }

    @Test
    fun `a 401 on the read or the write throws Unauthorized`() =
        runTest {
            assertThrows<Unauthorized> { reads(HttpStatusCode.Unauthorized, body = error).me() }
            assertThrows<Unauthorized> { reads(HttpStatusCode.Unauthorized, body = error).selectLeague(leagues[1].id) }
        }

    @Test
    fun `sign out answers the logout URL, url null, or data null`() =
        runTest {
            val url = "https://api.workos.com/user_management/sessions/logout?return_to=https%3A%2F%2Ftrycommish.app%2F&session_id=s1"
            val device = "00000000-0000-0000-0000-0000000000d1"
            val seen = mutableListOf<String>()
            val shapes =
                mapOf(
                    """{"ok":true,"data":{"url":"$url"},"error":null}""" to url,
                    """{"ok":true,"data":{"url":null},"error":null}""" to null,
                    """{"ok":true,"data":null,"error":null}""" to null,
                )
            shapes.forEach { (body, expected) ->
                assertEquals(expected, reads(HttpStatusCode.OK, body = body, seen = seen).revokeDevice(device), body)
            }
            assertEquals(List(3) { "${HttpMethod.Delete.value} /devices/$device " }, seen)
        }

    @Test
    fun `a refused, broken or non-https answer opens nothing, and a 401 throws`() =
        runTest {
            val device = "00000000-0000-0000-0000-0000000000d1"
            assertNull(reads(HttpStatusCode.NotFound, body = error).revokeDevice(device))
            assertNull(reads(HttpStatusCode.OK, body = "<html>").revokeDevice(device))
            assertNull(reads(HttpStatusCode.OK, body = """{"ok":true,"data":{"url":"javascript:x"}}""").revokeDevice(device))
            assertThrows<Unauthorized> { reads(HttpStatusCode.Unauthorized, body = error).revokeDevice(device) }
        }

    @Test
    fun `a logout URL is taken only on WorkOS's host, or the host a rehearsal names`() =
        runTest {
            val device = "00000000-0000-0000-0000-0000000000d1"
            val path = "/user_management/sessions/logout?session_id=s1"
            listOf(
                "https://evil.example$path",
                "https://api.workos.com.evil.example$path",
                "https://user@api.workos.com$path",
                "https://api.workos.com:8443$path",
                "http://api.workos.com$path",
            ).forEach { url -> assertNull(reads(HttpStatusCode.OK, body = signOutBody(url)).revokeDevice(device), url) }
            val stub = "https://localhost:18443$path"
            assertNull(reads(HttpStatusCode.OK, body = signOutBody(stub)).revokeDevice(device))
            assertEquals(stub, reads(HttpStatusCode.OK, body = signOutBody(stub), logoutHost = "localhost:18443").revokeDevice(device))
        }
}
