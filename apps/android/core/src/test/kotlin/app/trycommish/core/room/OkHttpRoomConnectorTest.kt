package app.trycommish.core.room

import kotlinx.coroutines.runBlocking
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.util.concurrent.TimeUnit

/**
 * The phone's socket over OkHttp against a local server (protocol section 1): the device token rides the
 * upgrade as `Authorization: Bearer`, never the query string; a frame goes out and comes back; the room's close
 * reaches the reader with its code and reason; an upgrade the room refuses reads its HTTP status.
 */
class OkHttpRoomConnectorTest {
    private val server = MockWebServer()

    @BeforeEach
    fun start() = server.start()

    @AfterEach
    fun stop() = server.shutdown()

    private fun url(): String = server.url("/rooms/r/ws").toString().replaceFirst("http", "ws")

    @Test
    fun `the token rides the upgrade's header and frames go both ways`() {
        server.enqueue(
            MockResponse().withWebSocketUpgrade(
                object : WebSocketListener() {
                    override fun onOpen(
                        webSocket: WebSocket,
                        response: Response,
                    ) {
                        webSocket.send(RoomSocketTest.WELCOME)
                    }

                    override fun onMessage(
                        webSocket: WebSocket,
                        text: String,
                    ) {
                        webSocket.close(RoomSocket.POLICY_VIOLATION, RoomSocket.SIGNED_OUT_REASON)
                    }
                },
            ),
        )
        runBlocking {
            val connection = OkHttpRoomConnector().open(url(), "device-token")
            assertEquals(RoomSocketTest.WELCOME, connection.receive())
            connection.send(RoomCommand.hello(0))
            val closed = assertThrows<RoomClosed> { runBlocking { connection.receive() } }
            assertEquals(RoomSocket.POLICY_VIOLATION, closed.code)
            assertEquals(RoomSocket.SIGNED_OUT_REASON, closed.reason)
        }
        val upgrade = server.takeRequest(5, TimeUnit.SECONDS)
        assertEquals("Bearer device-token", upgrade?.getHeader("Authorization"))
        assertNull(upgrade?.requestUrl?.query)
    }

    @Test
    fun `an upgrade the room refuses reads its status`() {
        server.enqueue(
            MockResponse().setResponseCode(401).setBody("""{"ok":false,"error":{"code":"unauthorized","message":"Sign in to do that"}}"""),
        )
        val refused = assertThrows<RoomClosed> { runBlocking { OkHttpRoomConnector().open(url(), null) } }
        assertEquals(401, refused.status)
        assertNull(server.takeRequest(5, TimeUnit.SECONDS)?.getHeader("Authorization"))
    }
}
