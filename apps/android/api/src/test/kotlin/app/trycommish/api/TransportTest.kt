package app.trycommish.api

import app.trycommish.api.models.DeviceKind
import app.trycommish.api.models.LeagueSync
import app.trycommish.api.models.PairInput
import app.trycommish.api.models.Paired
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.io.File
import java.util.UUID

/** The transport sends the device token as a bearer and a request id on every request, and reads the
 * envelope's data or fails with the API's own error. */
class TransportTest {
    private val leagueId = UUID.fromString("6f1d1c52-2626-4a26-9a26-000000000026")
    private val syncBody =
        File(System.getProperty("fixtures"), "inseason/leagues-attached-$leagueId.json").readText()
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    @Test
    fun `a signed-in request carries the bearer and a request id`() =
        runTest {
            val seen = mutableListOf<Pair<String?, String?>>()
            val engine =
                MockEngine { request ->
                    seen += request.headers[HttpHeaders.Authorization] to request.headers[REQUEST_ID_HEADER]
                    respond(syncBody, HttpStatusCode.OK, json)
                }
            val transport = Transport("http://api.test", engine, token = { "tok_abc" }, requestId = { "req-1" })
            val sync: LeagueSync = transport.leagueSync().leagueSync(leagueId).data()
            assertEquals(12, sync.teams.size)
            assertEquals(listOf("Bearer tok_abc" to "req-1"), seen)
        }

    @Test
    fun `a request with no token carries no bearer`() =
        runTest {
            var auth: String? = "unset"
            val engine =
                MockEngine { request ->
                    auth = request.headers[HttpHeaders.Authorization]
                    respond(syncBody, HttpStatusCode.OK, json)
                }
            Transport("http://api.test", engine, token = { null }).leagueSync().leagueSync(leagueId).data<LeagueSync>()
            assertNull(auth)
        }

    @Test
    fun `pairing sends the code, the kind and the PKCE verifier, and reads the token`() =
        runTest {
            var sent: String? = null
            var path: String? = null
            val paired =
                """{"ok":true,"data":{"token":"tok_new","device":{"id":"0d6f6c1e-8b1a-4c55-9d0e-7a0f3c2b1a99",""" +
                    """"name":"Pixel 8","scopes":["session","league:write"],"created_at":"2026-10-24T12:00:00Z","last_used_at":null}},"error":null}"""
            val engine =
                MockEngine { request ->
                    path = request.url.encodedPath
                    sent = (request.body as io.ktor.http.content.TextContent).text
                    respond(paired, HttpStatusCode.Created, json)
                }
            val result =
                Transport("http://api.test", engine, token = { null })
                    .devices()
                    .pairDevice(PairInput(code = "c0de", name = "Pixel 8", kind = DeviceKind.android, codeVerifier = "v3rifier"))
                    .data<Paired>()
            assertEquals("/devices/pair", path)
            assertEquals("""{"code":"c0de","name":"Pixel 8","kind":"android","code_verifier":"v3rifier"}""", sent)
            assertEquals("tok_new", result.token)
            assertEquals("0d6f6c1e-8b1a-4c55-9d0e-7a0f3c2b1a99", result.device.id.toString())
        }

    @Test
    fun `an error envelope fails with the API's code and message`() =
        runTest {
            val body = """{"ok":false,"data":null,"error":{"code":"not_found","message":"No such league."}}"""
            val engine = MockEngine { respond(body, HttpStatusCode.NotFound, json) }
            val failure =
                assertThrows<ApiFailure> {
                    Transport("http://api.test", engine, token = { null }).leagueSync().leagueSync(leagueId).data<LeagueSync>()
                }
            assertEquals(404, failure.status)
            assertEquals("not_found", failure.code)
        }
}
