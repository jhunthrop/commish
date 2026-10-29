package app.trycommish.core.push

import app.trycommish.api.ApiFailure
import app.trycommish.core.MemorySession
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.io.IOException

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

    /** The shell's routing of a tap (review M1): a fixture case whose league the member follows opens its
     * screen; the same case with the league no longer followed, and a case with no route, open the league
     * list. */
    @Test
    fun `a tap opens a followed league's screen, else the league list`() {
        val cases = parity.getValue("cases").jsonArray.map { it.jsonObject }
        val lineup = cases.first { (it["route"] as? JsonObject)?.get("screen")?.jsonPrimitive?.content == "lineup" }
        val route = checkNotNull(PushRoute.of(dataOf(lineup)))
        assertEquals(PushDestination.League(route), PushRoute.destination(route, listOf(route.league)))
        assertEquals(PushDestination.LeagueList, PushRoute.destination(route, listOf(OTHER_LEAGUE)))
        val unknown = cases.first { it["route"] !is JsonObject }
        assertEquals(PushDestination.LeagueList, PushRoute.destination(PushRoute.of(dataOf(unknown)), listOf(route.league)))
    }

    private fun dataOf(item: JsonObject): Map<String, String> =
        item
            .getValue("fcm")
            .jsonObject
            .getValue("data")
            .jsonObject
            .mapValues { it.value.jsonPrimitive.content }

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

    /** The push routes, each call recorded ("put <device> <token>", "delete <device>"); removals can fail as
     * with no signal, and the next registrations can be refused with the API's 409. */
    private class Api : PushApi {
        var calls: List<String> = emptyList()
        var offline = false
        var conflicts = 0

        val registered get() = calls.filter { it.startsWith("put") }
        val removed get() = calls.filter { it.startsWith("delete") }

        override suspend fun register(
            device: String,
            token: String,
        ) {
            calls = calls + "put $device $token"
            if (conflicts > 0) {
                conflicts--
                throw ApiFailure(CONFLICT, "conflict", "That token is another account's.")
            }
        }

        override suspend fun remove(device: String) {
            if (offline) throw IOException("no signal")
            calls = calls + "delete $device"
        }
    }

    private class Phone(
        granted: PushPermission,
        answer: Boolean = true,
    ) {
        val api = Api()
        val pendingApi = Api()
        val session = MemorySession()
        val pending = MemorySession()
        val platform = Platform(granted, answer)
        val flag = MemoryPushOffFlag()

        fun registrar() = PushRegistrar(api, platform, session, PendingRemoval(pending, pendingApi), flag) { _, _ -> }

        fun signIn() = session.signIn("t", DEVICE)
    }

    @Test
    fun `signed in with push allowed the token registers, and a new one replaces it`() =
        runTest {
            val phone = Phone(PushPermission.Allowed).apply { signIn() }
            val push = phone.registrar()
            push.start()
            push.tokenArrived(NEW_TOKEN)
            assertEquals(listOf("put $DEVICE $TOKEN", "put $DEVICE $NEW_TOKEN"), phone.api.registered)
            assertEquals(0, phone.platform.asks)
        }

    @Test
    fun `a launch never asks, signed out nothing registers, nor a token before push is allowed`() =
        runTest {
            val phone = Phone(PushPermission.NotAsked)
            phone.registrar().start()
            phone.signIn()
            phone.registrar().tokenArrived(NEW_TOKEN)
            assertEquals(0, phone.platform.asks)
            assertTrue(phone.api.registered.isEmpty())
        }

    @Test
    fun `the switch asks once, then registers, and all off takes the token off`() =
        runTest {
            val phone = Phone(PushPermission.NotAsked).apply { signIn() }
            val push = phone.registrar()
            assertEquals(PushPermission.Allowed, push.enable())
            assertEquals(1, phone.platform.asks)
            assertEquals(listOf("put $DEVICE $TOKEN"), phone.api.registered)
            push.disable()
            assertEquals(listOf("delete $DEVICE"), phone.api.removed)
            assertFalse(push.wanted)
            // Every switch off: a relaunch registers nothing, nor does a new token.
            val relaunched = phone.registrar()
            relaunched.start()
            relaunched.tokenArrived(NEW_TOKEN)
            assertEquals(1, phone.api.registered.size)
            assertEquals(PushPermission.Allowed, relaunched.enable())
            assertEquals(1, phone.platform.asks)
            assertTrue(relaunched.wanted)
        }

    @Test
    fun `a refused prompt registers nothing`() =
        runTest {
            val phone = Phone(PushPermission.NotAsked, answer = false).apply { signIn() }
            assertEquals(PushPermission.Refused, phone.registrar().enable())
            assertTrue(phone.api.registered.isEmpty())
        }

    @Test
    fun `sign out takes the token off, forgets it, and the next account wants push`() =
        runTest {
            val phone = Phone(PushPermission.Allowed).apply { signIn() }
            phone.flag.off = true
            phone.registrar().signingOut()
            assertEquals(listOf("delete $DEVICE"), phone.api.removed)
            assertEquals(1, phone.platform.deletes)
            assertFalse(phone.flag.off)
            assertNull(phone.pending.deviceId)
        }

    /** Security M1: a sign out without signal keeps the removal, with the signed-out device's token, and the
     * next launch takes the token off with it before anything registers. */
    @Test
    fun `a failed removal at sign out is finished at the next launch first`() =
        runTest {
            val phone = Phone(PushPermission.Allowed).apply { signIn() }
            phone.api.offline = true
            phone.registrar().signingOut()
            assertEquals(DEVICE, phone.pending.deviceId)
            assertEquals("t", phone.pending.token)
            phone.session.signOut()

            phone.registrar().launched()
            assertEquals(listOf("delete $DEVICE"), phone.pendingApi.removed)
            assertNull(phone.pending.deviceId)

            // Kept again (still no signal there), then finished before the next sign-in's registration.
            phone.pending.signIn("old", EARLIER)
            phone.pendingApi.offline = true
            phone.registrar().launched()
            assertEquals(EARLIER, phone.pending.deviceId)
            phone.pendingApi.offline = false
            phone.signIn()
            phone.registrar().tokenArrived(TOKEN)
            assertEquals("delete $EARLIER", phone.pendingApi.removed.last())
            assertNull(phone.pending.deviceId)
            assertEquals(listOf("put $DEVICE $TOKEN"), phone.api.registered)
        }

    /** Security M1: a token the API says another account's device holds tries the kept removal, then registers
     * once more, and never loops. */
    @Test
    fun `a token another account holds removes, then registers once`() =
        runTest {
            val phone = Phone(PushPermission.Allowed).apply { signIn() }
            val push = phone.registrar()
            phone.api.conflicts = 5
            push.tokenArrived(TOKEN)
            assertEquals(2, phone.api.registered.size)
            phone.api.conflicts = 1
            phone.pending.signIn("old", EARLIER)
            push.tokenArrived(TOKEN)
            assertEquals(listOf("delete $EARLIER"), phone.pendingApi.removed)
            assertNull(phone.pending.deviceId)
            assertEquals(4, phone.api.registered.size)
        }

    private companion object {
        const val DEVICE = "6f1d1c52-2626-4a26-9a26-0000000000d1"
        const val EARLIER = "6f1d1c52-2626-4a26-9a26-0000000000d9"
        const val OTHER_LEAGUE = "6f1d1c52-2626-4a26-9a26-000000000099"
        const val TOKEN = "fcm-token-one:APA91bExample"
        const val NEW_TOKEN = "fcm-token-two:APA91bExample"
        const val CONFLICT = 409
    }
}
