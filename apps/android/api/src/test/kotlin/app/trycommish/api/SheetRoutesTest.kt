package app.trycommish.api

import app.trycommish.api.models.SheetImportResult
import app.trycommish.api.models.SheetRowsReplace
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.util.UUID

/** The sheet's routes as the phone sends them (Lanes 267 and 278): the import's CSV whole as a text/csv body and
 * a list of names as text/plain (the API reads the body as the file or the list), the rows' write guarded by the stamp exactly as it was read, and an export's
 * signed link fetched with no bearer. */
class SheetRoutesTest {
    private val id = UUID.fromString("0b7a3c9e-5d1f-4a26-9a26-000000000254")
    private val json = headersOf(HttpHeaders.ContentType, "application/json")
    private val sheet =
        """{"id":"$id","name":"My sheet","format":"ppr","row_count":0,"created_at":"2026-10-23T15:41:07.123456Z",""" +
            """"updated_at":"2026-10-23T15:41:07.123456Z","rows":[]}"""

    @Test
    fun `an import sends the CSV as text, not a JSON string`() =
        runTest {
            var type: String? = null
            var sent: String? = null
            var path: String? = null
            val engine =
                MockEngine { request ->
                    path = request.url.encodedPath
                    type = request.body.contentType?.toString()
                    sent = (request.body as TextContent).text
                    respond("""{"ok":true,"data":{"imported":0,"skipped":[],"sheet":$sheet},"error":null}""", HttpStatusCode.OK, json)
                }
            val csv = "rank,player_id,name,position\n1,4362628,\"Ja'Marr Chase\",WR\n"
            val result: SheetImportResult = Transport("http://api.test", engine, token = { "tok" }).sheets().importSheet(id, csv).data()
            assertEquals("/sheets/$id/import", path)
            assertEquals("text/csv", type?.substringBefore(';'))
            assertEquals(csv, sent)
            assertEquals(0, result.imported)
        }

    @Test
    fun `an import of a list of names sends it as plain text`() =
        runTest {
            var type: String? = null
            var sent: String? = null
            val engine =
                MockEngine { request ->
                    type = request.body.contentType?.toString()
                    sent = (request.body as TextContent).text
                    respond("""{"ok":true,"data":{"imported":0,"skipped":[],"sheet":$sheet},"error":null}""", HttpStatusCode.OK, json)
                }
            val list = "1. Puka Nacua\n2. Ja'Marr Chase, WR"
            Transport("http://api.test", engine, token = { "tok" }).sheets().importNames(id, list).data()
            assertEquals("text/plain", type?.substringBefore(';'))
            assertEquals(list, sent)
        }

    @Test
    fun `a rows write carries the stamp to the microsecond as it was read`() =
        runTest {
            var sent: String? = null
            val engine =
                MockEngine { request ->
                    sent = (request.body as TextContent).text
                    respond("""{"ok":true,"data":$sheet,"error":null}""", HttpStatusCode.OK, json)
                }
            Transport("http://api.test", engine, token = { "tok" })
                .sheets()
                .replaceSheetRows(id, SheetRowsReplace(rows = emptyList(), ifUpdatedAt = "2026-10-23T15:41:07.123456Z"))
                .bodyText()
            assertEquals("""{"rows":[],"if_updated_at":"2026-10-23T15:41:07.123456Z"}""", sent)
        }

    @Test
    fun `an export's file is fetched with no bearer, its bytes whole`() =
        runTest {
            var auth: String? = "unset"
            val bytes = "rank,player_id\n1,x\n".toByteArray()
            val engine =
                MockEngine { request ->
                    auth = request.headers[HttpHeaders.Authorization]
                    respond(bytes, HttpStatusCode.OK)
                }
            val file = Transport("http://api.test", engine, token = { "tok" }).download("https://files.example/e1.csv?sig=abc")
            assertNull(auth)
            assertArrayEquals(bytes, file)
        }

    @Test
    fun `a refused link is a failure with the store's status`() =
        runTest {
            val engine = MockEngine { respond("denied", HttpStatusCode.Forbidden) }
            val failure =
                assertThrows<ApiFailure> { Transport("http://api.test", engine, token = { null }).download("https://files.example/x") }
            assertEquals(403, failure.status)
        }
}
