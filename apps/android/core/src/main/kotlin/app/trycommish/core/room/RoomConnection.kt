package app.trycommish.core.room

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.Channel
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.ConcurrentHashMap

/** How a socket ended: its close code and reason, and the upgrade's HTTP status when the room refused it
 * before any frame (401, 403, 404, 429; null once the socket had opened). */
data class RoomClosed(
    val code: Int,
    val reason: String = "",
    val status: Int? = null,
) : Exception("room socket closed $code $reason")

/** One open socket on the room: text frames in and out, and a close. `receive` throws [RoomClosed] when the
 * socket ends, however it ended. */
interface RoomConnection {
    suspend fun send(text: String)

    suspend fun receive(): String

    suspend fun close(
        code: Int,
        reason: String,
    )
}

/** Opens a socket on the room's `socket_url` (never one the client builds), signed in by the token. Throws
 * [RoomClosed] with the upgrade's status when the room refuses it. */
fun interface RoomConnector {
    suspend fun open(
        url: String,
        token: String?,
    ): RoomConnection
}

/**
 * The phone's socket: OkHttp's WebSocket over a request carrying the device token as `Authorization: Bearer`
 * (never in the query string), on a client whose cookie jar keeps the front end's affinity cookie for the
 * reconnects. OkHttp answers the room's pings by itself.
 */
class OkHttpRoomConnector(
    client: OkHttpClient = OkHttpClient(),
) : RoomConnector {
    private val client = client.newBuilder().cookieJar(AffinityCookies()).build()

    override suspend fun open(
        url: String,
        token: String?,
    ): RoomConnection {
        val request =
            Request
                .Builder()
                .url(url)
                .apply { token?.takeIf { it.isNotEmpty() }?.let { header(AUTHORIZATION, "Bearer $it") } }
                .build()
        val connection = OkHttpRoomConnection()
        val socket = client.newWebSocket(request, connection.listener)
        connection.attach(socket)
        return try {
            connection.opened()
        } catch (e: CancellationException) {
            // The owner left while the upgrade was on its way: the socket it started is let go now, so no
            // seat stays present with no one reading it (Lane 214 review H2).
            socket.cancel()
            throw e
        }
    }

    private companion object {
        const val AUTHORIZATION = "Authorization"
    }
}

/** The cookies the room's front end sets, kept in memory for this app's life and sent back on reconnects. */
private class AffinityCookies : CookieJar {
    private val kept = ConcurrentHashMap<String, List<Cookie>>()

    override fun saveFromResponse(
        url: HttpUrl,
        cookies: List<Cookie>,
    ) {
        kept[url.host] = cookies
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> = kept[url.host].orEmpty().filter { it.matches(url) }
}

/** One OkHttp socket as a [RoomConnection]: the listener's events onto a channel the reader takes from. */
private class OkHttpRoomConnection : RoomConnection {
    private val frames = Channel<String>(Channel.UNLIMITED)
    private val ready = CompletableDeferred<Unit>()

    @Volatile private var ended: RoomClosed? = null

    @Volatile private var socket: WebSocket? = null

    val listener =
        object : WebSocketListener() {
            override fun onOpen(
                webSocket: WebSocket,
                response: Response,
            ) {
                ready.complete(Unit)
            }

            override fun onMessage(
                webSocket: WebSocket,
                text: String,
            ) {
                frames.trySend(text)
            }

            override fun onClosing(
                webSocket: WebSocket,
                code: Int,
                reason: String,
            ) {
                webSocket.close(code, null)
                end(RoomClosed(code, reason))
            }

            override fun onClosed(
                webSocket: WebSocket,
                code: Int,
                reason: String,
            ) {
                end(RoomClosed(code, reason))
            }

            override fun onFailure(
                webSocket: WebSocket,
                t: Throwable,
                response: Response?,
            ) {
                // Refused before the upgrade: the HTTP status the room answered with; else gone without a close.
                val status = response?.code?.takeIf { it != SWITCHING_PROTOCOLS }
                end(RoomClosed(ABNORMAL, t.message.orEmpty(), status))
            }
        }

    fun attach(socket: WebSocket) {
        this.socket = socket
    }

    /** This connection once the upgrade is through, or the refusal. */
    suspend fun opened(): RoomConnection {
        ready.await()
        ended?.let { throw it }
        return this
    }

    private fun end(closed: RoomClosed) {
        if (ended == null) ended = closed
        ready.complete(Unit)
        frames.close(ended)
    }

    override suspend fun send(text: String) {
        ended?.let { throw it }
        if (socket?.send(text) != true) throw ended ?: RoomClosed(ABNORMAL)
    }

    /** The next frame; a cancelled reader's owner closes the socket (RoomSocket.run). */
    override suspend fun receive(): String = frames.receiveCatching().getOrNull() ?: throw ended ?: RoomClosed(ABNORMAL)

    override suspend fun close(
        code: Int,
        reason: String,
    ) {
        socket?.close(code, reason)
        end(RoomClosed(code, reason))
    }

    private companion object {
        const val SWITCHING_PROTOCOLS = 101
        const val ABNORMAL = 1006
    }
}
