package app.trycommish.api

import app.trycommish.api.models.ImportSkip
import app.trycommish.api.models.SheetImportResult
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.io.File
import java.util.UUID

/** The import's refusal through the client (Lane 297): each parity refusal's error, as the API's handler is held
 * to sending it, is read as an [ApiFailure] with the API's sentence for the body and every skipped line, an empty
 * list when no line said why; a 400 without skipped lines (a header the import cannot use, or an API from before
 * Lane 297) carries none. */
class ImportRefusalTest {
    private val id = UUID.fromString("0b7a3c9e-5d1f-4a26-9a26-000000000254")
    private val json = headersOf(HttpHeaders.ContentType, "application/json")

    private fun refusals(): List<JsonObject> =
        Json
            .parseToJsonElement(File(System.getProperty("fixtures"), "parity/sheet.json").readText())
            .jsonObject
            .getValue("refusals")
            .jsonArray
            .map { it.jsonObject }

    private suspend fun refused(error: String): ApiFailure {
        val engine = MockEngine { respond("""{"ok":false,"data":null,"error":$error,"request_id":"r"}""", HttpStatusCode.BadRequest, json) }
        return assertThrows<ApiFailure> {
            Transport("http://api.test", engine, token = { "tok" }).sheets().importNames(id, "Gibbs").data<SheetImportResult>()
        }
    }

    private fun JsonObject.obj(key: String): JsonObject = getValue(key).jsonObject

    private fun JsonObject.text(key: String): String = getValue(key).jsonPrimitive.content

    private fun JsonObject.skips(): List<ImportSkip> =
        getValue("skipped").jsonArray.map { it.jsonObject }.map { ImportSkip(it.getValue("line").jsonPrimitive.int, it.text("reason")) }

    @Test
    fun `a refusal of a body that reads no player carries its skipped lines`() =
        runTest {
            val errors = refusals().map { it.obj("error") }
            assertTrue(errors.any { it.skips().isNotEmpty() })
            assertTrue(errors.any { it.skips().isEmpty() })
            for (error in errors) {
                val failure = refused(error.toString())
                assertEquals(400, failure.status)
                assertEquals(error.text("code"), failure.code)
                assertEquals(error.obj("fields").text("body"), failure.fields["body"])
                assertEquals(error.skips(), failure.skipped)
            }
        }

    @Test
    fun `a refusal without skipped lines carries none`() =
        runTest {
            val error = """{"code":"invalid","message":"Some of that did not check out","fields":{"body":"The first row must name rank"}}"""
            val failure = refused(error)
            assertEquals("The first row must name rank", failure.fields["body"])
            assertNull(failure.skipped)
        }
}
