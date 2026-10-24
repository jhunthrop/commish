package app.trycommish.api

import app.trycommish.api.apis.DevicesApi
import app.trycommish.api.apis.LeagueSyncApi
import app.trycommish.api.infrastructure.HttpResponse
import app.trycommish.api.models.Paired
import io.ktor.client.HttpClient
import io.ktor.client.HttpClientConfig
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.api.createClientPlugin
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
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

    private val client by lazy { HttpClient(engine, config) }

    /**
     * Trades the sign-in's pairing code for this device's token (`POST /devices/pair`). Written by
     * hand while the generated PairInput lacks `kind` and `code_verifier` (Task B adds them to
     * api/openapi.yaml); once it carries them this calls `devices().pairDevice`.
     */
    suspend fun pair(input: AppPairInput): Paired {
        val response =
            client.post("${baseUrl.trimEnd('/')}/devices/pair") {
                contentType(ContentType.Application.Json)
                setBody(input)
            }
        return decodeEnvelope(response.bodyAsText(), response.status.value)
    }
}

/** The pairing body an app sends: the code from the sign-in's return link, the device's name, the
 * app's kind (ios, android) and the PKCE verifier the sign-in began with. */
@Serializable
data class AppPairInput(
    val code: String,
    val name: String,
    val kind: String,
    @SerialName("code_verifier") val codeVerifier: String,
)

/** The envelope's data from a generated call's answer, or the API's failure. */
suspend inline fun <reified T> HttpResponse<*>.data(): T = decodeEnvelope(response.bodyAsText(), status)
