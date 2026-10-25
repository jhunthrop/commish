package app.trycommish.api

import app.trycommish.api.apis.AuthApi
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

    /** Each generated client once per transport: each holds one HttpClient for the app's life. */
    private val leagueSyncApi by lazy { LeagueSyncApi(baseUrl, engine, config) }
    private val devicesApi by lazy { DevicesApi(baseUrl, engine, config) }
    private val authApi by lazy { AuthApi(baseUrl, engine, config) }

    fun leagueSync(): LeagueSyncApi = leagueSyncApi

    fun devices(): DevicesApi = devicesApi

    fun auth(): AuthApi = authApi
}

/** An answer's body whole, or Unauthorized when the API no longer takes the device's token. */
suspend fun HttpResponse<*>.bodyText(): String {
    if (status == HTTP_UNAUTHORIZED) throw Unauthorized()
    return response.bodyAsText()
}

/** The envelope's data from a generated call's answer, or the API's failure. */
suspend inline fun <reified T> HttpResponse<*>.data(): T = decodeEnvelope(bodyText(), status)
