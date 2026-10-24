package app.trycommish.api

import app.trycommish.api.apis.DevicesApi
import app.trycommish.api.apis.LeagueSyncApi
import app.trycommish.api.infrastructure.HttpResponse
import io.ktor.client.HttpClientConfig
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.api.createClientPlugin
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.serialization.kotlinx.json.json
import java.util.UUID

/** The header the API logs a request under, so a member's report finds its line. */
const val REQUEST_ID_HEADER = "X-Request-Id"

private const val TIMEOUT_MS = 15_000L

/**
 * The one way the app reaches the API: the generated clients, each sharing one engine and one
 * configuration that adds the device token as a bearer (when there is one) and a fresh request id
 * on every request. `token` is read per request, so a sign-in or a sign-out takes effect at once.
 */
class Transport(
    private val baseUrl: String,
    private val engine: HttpClientEngine = OkHttp.create(),
    private val token: () -> String?,
    private val requestId: () -> String = { UUID.randomUUID().toString() },
) {
    private val config: (HttpClientConfig<*>) -> Unit = { client ->
        client.install(ContentNegotiation) { json(CommishJson) }
        client.install(HttpTimeout) {
            requestTimeoutMillis = TIMEOUT_MS
            connectTimeoutMillis = TIMEOUT_MS
        }
        client.install(
            createClientPlugin("CommishTransport") {
                onRequest { request, _ ->
                    token()?.let { request.headers[HttpHeaders.Authorization] = "Bearer $it" }
                    request.headers[REQUEST_ID_HEADER] = requestId()
                }
            },
        )
    }

    fun leagueSync(): LeagueSyncApi = LeagueSyncApi(baseUrl, engine, config)

    fun devices(): DevicesApi = DevicesApi(baseUrl, engine, config)
}

/** The envelope's data from a generated call's answer, or the API's failure. */
suspend inline fun <reified T> HttpResponse<*>.data(): T = decodeEnvelope(response.bodyAsText(), status)
