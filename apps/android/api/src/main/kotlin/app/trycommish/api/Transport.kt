package app.trycommish.api

import app.trycommish.api.apis.AuthApi
import app.trycommish.api.apis.BillingApi
import app.trycommish.api.apis.CompanionsApi
import app.trycommish.api.apis.DevicesApi
import app.trycommish.api.apis.ExportsApi
import app.trycommish.api.apis.LeagueSyncApi
import app.trycommish.api.apis.LeaguesApi
import app.trycommish.api.apis.MocksApi
import app.trycommish.api.apis.RoomsApi
import app.trycommish.api.apis.RunApi
import app.trycommish.api.infrastructure.HttpResponse
import io.ktor.client.HttpClient
import io.ktor.client.HttpClientConfig
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.api.createClientPlugin
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.client.statement.readBytes
import io.ktor.http.HttpHeaders
import io.ktor.serialization.kotlinx.json.json
import java.util.UUID

/** The header the API logs a request under, so a member's report finds its line. */
const val REQUEST_ID_HEADER = "X-Request-Id"

private const val TIMEOUT_MS = 15_000L

/**
 * The one way the app reaches the API: the generated clients, each sharing one engine and one
 * configuration that adds the device token as a bearer (when there is one) and a fresh request id
 * on every request, a request's body written with [CommishRequestJson]. `token` is read per request,
 * so a sign-in or a sign-out takes effect at once.
 */
class Transport(
    private val baseUrl: String,
    private val engine: HttpClientEngine = OkHttp.create(),
    private val token: () -> String?,
    private val requestId: () -> String = { UUID.randomUUID().toString() },
) {
    private val config: (HttpClientConfig<*>) -> Unit = { client ->
        client.install(ContentNegotiation) { json(CommishRequestJson) }
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
    private val runApi by lazy { RunApi(baseUrl, engine, config) }
    private val billingApi by lazy { BillingApi(baseUrl, engine, config) }
    private val companionsApi by lazy { CompanionsApi(baseUrl, engine, config) }
    private val mocksApi by lazy { MocksApi(baseUrl, engine, config) }
    private val leaguesApi by lazy { LeaguesApi(baseUrl, engine, config) }
    private val roomsApi by lazy { RoomsApi(baseUrl, engine, config) }
    private val sheetsApi by lazy { CsvSheetsApi(baseUrl, engine, config) }
    private val exportsApi by lazy { ExportsApi(baseUrl, engine, config) }

    /** A plain client on the same engine for a signed link: no bearer and no request id, since the link
     * carries its own grant and goes to the file store, not the API. */
    private val files by lazy {
        HttpClient(engine) {
            install(HttpTimeout) {
                requestTimeoutMillis = TIMEOUT_MS
                connectTimeoutMillis = TIMEOUT_MS
            }
        }
    }

    fun leagueSync(): LeagueSyncApi = leagueSyncApi

    fun devices(): DevicesApi = devicesApi

    fun auth(): AuthApi = authApi

    /** The plans' answer, read by the app only for its free-season flag, never a price. */
    fun billing(): BillingApi = billingApi

    /** The published run's files (the GET /run routes): each takes the ETag kept for it and answers 304 when it
     * still stands. No HTTP cache is installed on this client, so a 304 always reaches the caller. */
    fun run(): RunApi = runApi

    /** The live-draft companion: the followed drafts, following one, a draft since a pick, its report. */
    fun companions(): CompanionsApi = companionsApi

    /** The solo mock room: start, read, draft, undo, Pick for me, Finish, the queue, the call, the report and a
     * shared draft by its code. */
    fun mocks(): MocksApi = mocksApi

    /** The account's saved leagues, which a mock reruns from. */
    fun leagues(): LeaguesApi = leaguesApi

    /** The lobby: the formats and how full each filling room is, a seat in one, the room, leaving it, the turn's
     * call and the report. Picks and the queue go over the room's socket, never through these. */
    fun rooms(): RoomsApi = roomsApi

    /** The account's cheat sheets: the list, a sheet with its rows, a new one, its rows written in one
     * guarded request, and an import that sends a CSV as text/csv and a list of names as text/plain. */
    fun sheets(): CsvSheetsApi = sheetsApi

    /** A sheet written as a file, with a signed link to it. */
    fun exports(): ExportsApi = exportsApi

    /** The file a signed link names, its bytes as the store holds them; a refusal is an [ApiFailure] with
     * the store's status and no sentence. */
    suspend fun download(url: String): ByteArray {
        val response = files.get(url)
        val status = response.status.value
        if (status !in HTTP_OK until HTTP_MULTIPLE_CHOICES) throw ApiFailure(status, "download", "")
        return response.readBytes()
    }
}

private const val HTTP_MULTIPLE_CHOICES = 300

/** An answer's body whole, or Unauthorized when the API no longer takes the device's token. */
suspend fun HttpResponse<*>.bodyText(): String {
    if (status == HTTP_UNAUTHORIZED) throw Unauthorized()
    return response.bodyAsText()
}

/** The envelope's data from a generated call's answer, or the API's failure. */
suspend inline fun <reified T> HttpResponse<*>.data(): T = decodeEnvelope(bodyText(), status)
