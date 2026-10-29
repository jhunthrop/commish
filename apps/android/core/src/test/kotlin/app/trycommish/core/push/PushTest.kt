package app.trycommish.core.push

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/** Push on the phone (Lane 288, the iOS PushTests): each payload the API sends opens the screen its path
 * names (shared/fixtures/parity/push.json, held to the API's senders by its own test), and the registrar
 * registers the FCM token on launch signed in and on a new token, takes it off when every switch goes off
 * and at sign out, and never asks the permission itself. */
class PushTest {
    private val parity =
        Json.parseToJsonElement(File(System.getProperty("fixtures"), "parity/push.json").readText()).jsonObject

    @Test
    fun `every payload opens the screen its path names`() {
        val cases = parity.getValue("cases").jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 7)
        cases.forEach { item ->
            val name = item.getValue("name").jsonPrimitive.content
            val data =
                item
                    .getValue("fcm")
                    .jsonObject
                    .getValue("data")
                    .jsonObject
                    .mapValues { it.value.jsonPrimitive.content }
            val want = item["route"] as? JsonObject
            val route = PushRoute.of(data)
            assertEquals(want?.get("screen")?.jsonPrimitive?.content, route?.screen?.name?.lowercase(), name)
            assertEquals(want?.get("league")?.jsonPrimitive?.content, route?.league, name)
            assertEquals(want?.get("player")?.jsonPrimitive?.contentOrNull, route?.player, name)
        }
    }

    private class Platform(
        var granted: PushPermission,
        private val answer: Boolean = true,
        var token: String? = TOKEN,
    ) : PushPlatform {
        var asks = 0
        var deletes = 0

        override fun permission(): PushPermission = granted

        override suspend fun ask(): Boolean {
            asks++
            granted = if (answer) PushPermission.Allowed else PushPermission.Refused
            return answer
        }

        override suspend fun token(): String? = token

        override suspend fun deleteToken() {
            deletes++
        }
    }

    private class Api : PushApi {
        var registered: List<Pair<String, String>> = emptyList()
        var removed: List<String> = emptyList()

        override suspend fun register(
            device: String,
            token: String,
        ) {
            registered = registered + (device to token)
        }

        override suspend fun remove(device: String) {
            removed = removed + device
        }
    }

    private fun registrar(
        api: Api,
        platform: Platform,
        flag: PushOffFlag = MemoryPushOffFlag(),
        device: String? = DEVICE,
    ) = PushRegistrar(api, platform, { device }, flag) { what, e -> throw AssertionError(what, e) }

    @Test
    fun `signed in with push allowed the token registers, and a new one replaces it`() =
        runTest {
            val api = Api()
            val platform = Platform(PushPermission.Allowed)
            val push = registrar(api, platform)
            push.start()
            push.tokenArrived(NEW_TOKEN)
            assertEquals(listOf(DEVICE to TOKEN, DEVICE to NEW_TOKEN), api.registered)
            assertEquals(0, platform.asks)
        }

    @Test
    fun `a launch never asks, and signed out nothing registers`() =
        runTest {
            val api = Api()
            val platform = Platform(PushPermission.NotAsked)
            registrar(api, platform).start()
            registrar(api, Platform(PushPermission.Allowed), device = null).start()
            assertEquals(0, platform.asks)
            assertTrue(api.registered.isEmpty())
        }

    @Test
    fun `the switch asks once, then registers, and all off takes the token off`() =
        runTest {
            val api = Api()
            val platform = Platform(PushPermission.NotAsked)
            val flag = MemoryPushOffFlag()
            val push = registrar(api, platform, flag)
            assertEquals(PushPermission.Allowed, push.enable())
            assertEquals(1, platform.asks)
            assertEquals(listOf(DEVICE to TOKEN), api.registered)
            push.disable()
            assertEquals(listOf(DEVICE), api.removed)
            assertFalse(push.wanted)
            // Every switch off: a relaunch registers nothing, nor does a new token.
            val relaunched = registrar(api, platform, flag)
            relaunched.start()
            relaunched.tokenArrived(NEW_TOKEN)
            assertEquals(1, api.registered.size)
            assertEquals(PushPermission.Allowed, relaunched.enable())
            assertEquals(1, platform.asks)
            assertTrue(relaunched.wanted)
        }

    @Test
    fun `a refused prompt registers nothing`() =
        runTest {
            val api = Api()
            assertEquals(PushPermission.Refused, registrar(api, Platform(PushPermission.NotAsked, answer = false)).enable())
            assertTrue(api.registered.isEmpty())
        }

    @Test
    fun `sign out takes the token off, forgets it, and the next account wants push`() =
        runTest {
            val api = Api()
            val platform = Platform(PushPermission.Allowed)
            val flag = MemoryPushOffFlag(off = true)
            registrar(api, platform, flag).signingOut()
            assertEquals(listOf(DEVICE), api.removed)
            assertEquals(1, platform.deletes)
            assertFalse(flag.off)
        }

    private companion object {
        const val DEVICE = "6f1d1c52-2626-4a26-9a26-0000000000d1"
        const val TOKEN = "fcm-token-one:APA91bExample"
        const val NEW_TOKEN = "fcm-token-two:APA91bExample"
    }
}
