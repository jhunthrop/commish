package app.trycommish.api

import app.trycommish.api.apis.SheetsApi
import app.trycommish.api.infrastructure.HttpResponse
import app.trycommish.api.infrastructure.RequestConfig
import app.trycommish.api.infrastructure.RequestMethod
import app.trycommish.api.infrastructure.wrap
import app.trycommish.api.models.ImportSheet200Response
import io.ktor.client.HttpClientConfig
import io.ktor.client.engine.HttpClientEngine
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import java.util.UUID

/** The sheets' client with the import sent as the spec names it: the text whole as the body, typed by what it
 * is. The generated call types every body JSON, and the API reads the import's body as the file or the list.
 * A CSV goes as text/csv ([importSheet]); a list of names in the drafter's order goes as text/plain
 * ([importNames]), which the API reads against the board of the sheet's format. */
class CsvSheetsApi internal constructor(
    baseUrl: String,
    engine: HttpClientEngine,
    config: (HttpClientConfig<*>) -> Unit,
) : SheetsApi(baseUrl, engine, config) {
    override suspend fun importSheet(
        id: UUID,
        body: String,
    ): HttpResponse<ImportSheet200Response> = import(id, body, ContentType.Text.CSV)

    /** POST /sheets/{id}/import with a list of names, typed text/plain. */
    suspend fun importNames(
        id: UUID,
        body: String,
    ): HttpResponse<ImportSheet200Response> = import(id, body, ContentType.Text.Plain)

    private suspend fun import(
        id: UUID,
        body: String,
        type: ContentType,
    ): HttpResponse<ImportSheet200Response> {
        val request =
            RequestConfig<Any?>(
                RequestMethod.POST,
                "/sheets/$id/import",
                headers = mutableMapOf(HttpHeaders.ContentType to type.toString()),
                requiresAuthentication = true,
            )
        return request(request, body, AUTH_NAMES).wrap()
    }

    private companion object {
        val AUTH_NAMES = listOf("session", "device")
    }
}
