package app.trycommish.core.companion

import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertInstanceOf
import java.io.File

/** The web's companion at 390 (shared/fixtures/parity/companion.json) and the readers the parity tests
 * hold the port to it with. */
internal object CompanionParity {
    val parity: JsonObject =
        Json.parseToJsonElement(File(System.getProperty("fixtures"), "parity/companion.json").readText()).jsonObject

    fun web(moment: CompanionFixtures.Moment): JsonObject =
        parity
            .getValue("moments")
            .jsonObject
            .getValue(moment.id)
            .jsonObject

    /** The moments the room is drawn at: once the draft is over the report takes the screen. */
    val roomMoments =
        listOf(
            CompanionFixtures.Moment.Waiting,
            CompanionFixtures.Moment.Between,
            CompanionFixtures.Moment.Turn,
            CompanionFixtures.Moment.Taken,
        )

    /** The view model after reading every moment up to `moment`, in order, as the page reads them. */
    fun viewModel(
        moment: CompanionFixtures.Moment,
        main: CoroutineDispatcher,
    ): CompanionViewModel {
        val read = CompanionFixtures.through(moment)
        val vm =
            CompanionViewModel(
                CompanionFixtures.ID,
                StubCompanion(read),
                MemoryCache(),
                FixedClock(CompanionFixtures.readAt),
                CompanionFixtures.zone,
                SessionEnd {},
            )
        runTest(main) { read.forEach { _ -> vm.load() } }
        return vm
    }

    fun room(
        moment: CompanionFixtures.Moment,
        main: CoroutineDispatcher,
    ): Pair<CompanionViewModel, CompanionModel> {
        val vm = viewModel(moment, main)
        return vm to assertInstanceOf(CompanionState.Room::class.java, vm.state.value).model
    }
}

internal fun JsonObject.text(key: String): String? = (get(key) as? JsonElement)?.takeIf { it != JsonNull }?.jsonPrimitive?.contentOrNull

internal fun JsonObject.obj(key: String): JsonObject? = (get(key) as? JsonElement)?.takeIf { it != JsonNull }?.jsonObject

internal fun JsonObject.list(key: String): List<JsonObject> = (get(key) as? JsonArray)?.map { it.jsonObject }.orEmpty()

internal fun JsonObject.strings(key: String): List<String> = (get(key) as? JsonArray)?.map { it.jsonPrimitive.content }.orEmpty()

internal fun JsonObject.flag(key: String): Boolean =
    (get(key) as? JsonElement)?.takeIf { it != JsonNull }?.jsonPrimitive?.booleanOrNull == true

internal fun JsonObject.number(key: String): Int? = (get(key) as? JsonElement)?.takeIf { it != JsonNull }?.jsonPrimitive?.intOrNull

internal fun JsonObject.real(key: String): Double? = (get(key) as? JsonElement)?.takeIf { it != JsonNull }?.jsonPrimitive?.doubleOrNull

internal fun JsonObject.ints(key: String): List<Int> = (get(key) as? JsonArray)?.map { it.jsonPrimitive.content.toInt() }.orEmpty()
