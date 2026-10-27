package app.trycommish.core.liveorder

import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.PlayerWeek
import app.trycommish.api.models.RunAdpAnswer
import app.trycommish.api.models.RunBoardAnswer
import app.trycommish.api.models.RunClubsAnswer
import app.trycommish.api.models.RunDesignationsAnswer
import app.trycommish.api.models.RunManifestAnswer
import app.trycommish.api.models.RunScheduleAnswer
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.core.board.BoardModel
import app.trycommish.core.board.BoardPosition
import app.trycommish.core.board.RunBoardRead
import app.trycommish.core.board.RunFixture
import app.trycommish.core.board.StubRunReads
import app.trycommish.core.player.PageInput
import app.trycommish.core.player.PageSource
import app.trycommish.core.player.PlayerPageModel
import app.trycommish.core.player.PlayerPages
import app.trycommish.core.player.StubPages
import app.trycommish.core.player.page
import app.trycommish.core.reference.ClubPageModel
import app.trycommish.core.reference.ClubScreens
import app.trycommish.core.reference.ClubsModel
import app.trycommish.core.reference.CompareModel
import app.trycommish.core.reference.CompareOutcome
import app.trycommish.core.reference.CompareReader
import app.trycommish.core.reference.CompareTable
import app.trycommish.core.reference.ReferenceReads
import app.trycommish.core.reference.RunScreenState
import app.trycommish.core.reference.RunScreenViewModel
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.ZoneId

/** The one-value stand-in's screens as the tests read them (the iOS OneValueReads'): the order at the
 * Sunday clock, the Board, a club, the clubs index, Compare and a player page over the stand-in run, each
 * held to shared/fixtures/parity/one-value.json. */
object OneValueReads {
    const val PPR = "ppr-12"
    val now = OneValueFixture.now
    val zone: ZoneId = ZoneId.of(parity.text("zone"))
    val parity: JsonObject get() = OneValueFixture.parity

    // The parity's fields.

    fun JsonObject.obj(key: String): JsonObject = getValue(key).jsonObject

    fun JsonObject.text(key: String): String = requireNotNull(get(key)?.takeIf { it != JsonNull }?.jsonPrimitive?.contentOrNull) { key }

    fun JsonObject.textOrNull(key: String): String? = get(key)?.takeIf { it != JsonNull }?.jsonPrimitive?.contentOrNull

    fun JsonObject.int(key: String): Int = requireNotNull(getValue(key).jsonPrimitive.intOrNull) { key }

    fun JsonObject.number(key: String): Double = requireNotNull(getValue(key).jsonPrimitive.doubleOrNull) { key }

    fun JsonObject.strings(key: String): List<String> = getValue(key).jsonArray.map { it.jsonPrimitive.content }

    fun JsonElement.objects(): List<JsonObject> = jsonArray.map { it.jsonObject }

    val players: List<JsonObject> get() = parity.getValue("players").objects()

    fun player(name: String): JsonObject = players.first { it.text("name") == name }

    val basis: JsonObject get() = parity.obj("basis")

    // The reads.

    /** The share over the fixture's order at the Sunday clock, `offline` failing every read. */
    fun orders(search: StubOrderSearch = StubOrderSearch()): OrderReader = OrderReader(OrderShare(search, FixedClock(now)))

    fun offline(): OrderReader = orders(StubOrderSearch(offline = true))

    /** The whole read the in-season pages take, as it landed at the Sunday clock. */
    suspend fun order(search: StubOrderSearch = StubOrderSearch()): OrderAtClock = orders(search).read()

    fun run(): RunBoardRead = RunFixture.OneValue.read(PPR)

    fun board(
        order: OrderAtClock?,
        position: BoardPosition? = null,
        read: RunBoardRead = run(),
    ): BoardModel = BoardModel.of(read, position, inSeason = true, following = false, now = now, zone = zone, order = order)

    fun references(): ReferenceReads =
        ReferenceReads(StubRunReads(RunFixture.OneValue), StubPages(RunFixture.OneValue), MemoryCache(), FixedClock(now))

    suspend fun <Model> loaded(vm: RunScreenViewModel<Model>): Model {
        vm.load().join()
        val state = vm.state.value
        check(state is RunScreenState.Loaded) { "$state" }
        return state.model
    }

    suspend fun club(
        abbr: String,
        orders: OrderReader?,
    ): ClubPageModel = loaded(ClubScreens.club(abbr, references(), zone, SessionEnd {}, orders))

    suspend fun clubs(orders: OrderReader?): ClubsModel = loaded(ClubScreens.clubs(references(), zone, SessionEnd {}, orders))

    /** Compare with the parity's first two players. */
    fun compare(orders: OrderReader?): RunScreenViewModel<CompareModel> =
        CompareReader.viewModel(players.take(2).map { it.text("slug") }, null, references(), zone, SessionEnd {}, orders)

    fun table(model: CompareModel): CompareTable =
        (model.outcome as? CompareOutcome.Table)?.table ?: error("Compare drew no table: ${model.outcome}")

    /** His page over the stand-in run with his week at the Sunday clock, or none (`week` null). */
    fun page(
        id: String,
        week: PlayerWeek?,
    ): PlayerPageModel {
        val fixture = RunFixture.OneValue
        val input =
            PageInput(
                source = PageSource.Page(fixture.page(id)),
                manifest = decodeEnvelope<RunManifestAnswer>(fixture.manifestAnswer()).manifest,
                sources = decodeEnvelope<RunAdpAnswer>(fixture.adpAnswer()).adp.sources,
                capture = decodeEnvelope<RunDesignationsAnswer>(fixture.designationsAnswer()).designations,
                clubs = decodeEnvelope<RunClubsAnswer>(fixture.clubsAnswer()).clubs,
                schedule = decodeEnvelope<RunScheduleAnswer>(fixture.scheduleAnswer()).schedule,
                board = decodeEnvelope<RunBoardAnswer>(fixture.boardAnswer(PPR)),
                week = week,
                host = null,
                league = null,
                zone = zone,
                now = now,
            )
        return requireNotNull(PlayerPages.page(input)) { id }
    }

    /** His week with each format's position rank as the parity's `ranked` case gives it (Lane 227's field). */
    fun rankedWeek(player: JsonObject): PlayerWeek {
        val ranks = player.obj("formats").obj("ranked").obj("ranks")
        val week = OneValueFixture.week(player.text("id"))
        return week.copy(
            restOfSeason = week.restOfSeason?.map { it.copy(positionRank = ranks[it.format.value]?.jsonPrimitive?.intOrNull) },
        )
    }
}
