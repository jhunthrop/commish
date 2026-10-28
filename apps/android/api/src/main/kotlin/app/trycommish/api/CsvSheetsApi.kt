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

/** The sheets' client with the import sent as the spec names it: the CSV whole as the body, typed
 * text/csv. The generated call types every body JSON, and the API reads the import's body as the file. */
internal class CsvSheetsApi(
    baseUrl: String,
    engine: HttpClientEngine,
    config: (HttpClientConfig<*>) -> Unit,
) : SheetsApi(baseUrl, engine, config) {
    override suspend fun importSheet(
        id: UUID,
        body: String,
    ): HttpResponse<ImportSheet200Response> {
        val request =
            RequestConfig<Any?>(
                RequestMethod.POST,
                "/sheets/$id/import",
                headers = mutableMapOf(HttpHeaders.ContentType to ContentType.Text.CSV.toString()),
                requiresAuthentication = true,
            )
        return request(request, body, AUTH_NAMES).wrap()
    }

    private companion object {
        val AUTH_NAMES = listOf("session", "device")
    }
}
