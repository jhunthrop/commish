package app.trycommish.core.reference

import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.DesignationStatus
import app.trycommish.api.models.RunAdpAnswer
import app.trycommish.api.models.RunClubsAnswer
import app.trycommish.api.models.RunDesignationsAnswer
import app.trycommish.api.models.RunIndexAnswer
import app.trycommish.api.models.RunIndexEntry
import app.trycommish.api.models.RunManifestAnswer
import app.trycommish.api.models.RunPlayerStatus
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.core.board.BoardColumns
import app.trycommish.core.board.GapTone
import app.trycommish.core.board.RunFixture
import app.trycommish.core.board.RunWords
import app.trycommish.core.board.StubRunReads
import app.trycommish.core.player.StubPages
import app.trycommish.core.player.page
import app.trycommish.design.Words
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.io.File
import java.time.Instant

/**
 * The reference screens held to the web's (shared/fixtures/parity/reference.json, Lane 199's), over the two
 * fixture runs through the view models and the run's routes, as the iOS ReferenceParityTests hold them: ADP
 * in every format the run carries (the drafters' order, each row's ADP, Rk, Gap and tint, the basis, the
 * drafts' players the board lacks and the board's with no ADP left out), every pair Compare can set from
 * the run's pages in every format (the call, the evidence, the rows with their better side and tone, the
 * basis) and the held pairs, the clubs index, every club's page and the strength of schedule grid.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ReferenceParityTest {
    private val parity: JsonObject =
        Json.parseToJsonElement(File(System.getProperty("fixtures"), "parity/reference.json").readText()).jsonObject
    private val runs = parity.getValue("runs").jsonArray.map { it.jsonObject }
    private val zone = RunFixture.zone

    @BeforeEach
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @AfterEach
    fun tearDown() = Dispatchers.resetMain()

    private fun JsonObject.text(key: String): String? = get(key)?.takeIf { it != JsonNull }?.jsonPrimitive?.contentOrNull

    private fun JsonObject.string(key: String): String = requireNotNull(text(key)) { "$key is missing" }

    private fun JsonObject.list(key: String): List<JsonObject> = getValue(key).jsonArray.map { it.jsonObject }

    private fun JsonObject.strings(key: String): List<String> = getValue(key).jsonArray.map { it.jsonPrimitive.content }

    private fun fixture(run: JsonObject): RunFixture =
        if (run.string("fixture").endsWith("standin-run")) RunFixture.StandIn else RunFixture.Contract

    private fun now(run: JsonObject): Instant = Instant.parse(run.string("now"))

    private fun reads(run: JsonObject): ReferenceReads {
        val fixture = fixture(run)
        return ReferenceReads(StubRunReads(fixture), StubPages(fixture), MemoryCache(), FixedClock(now(run)))
    }

    private suspend fun <Model> loaded(vm: RunScreenViewModel<Model>): Model {
        vm.load().join()
        val state = vm.state.value
        check(state is RunScreenState.Loaded) { "$state" }
        return state.model
    }

    private fun <Model> vm(
        run: JsonObject,
        build: ScreenBuild<Model>,
    ) = RunScreenViewModel(reads(run), zone, SessionEnd {}, build)

    private fun index(fixture: RunFixture): List<RunIndexEntry> = decodeEnvelope<RunIndexAnswer>(fixture.indexAnswer()).pages

    @Test
    fun `the absent words for a format the run lacks are the web's`() {
        assertEquals(parity.string("absent"), RunWords.absent(Words.BoardFormat.half))
    }

    @Test
    fun `ADP draws the web's rows in the drafters' order with its basis`() =
        runTest {
            runs.forEach { run ->
                val capture = decodeEnvelope<RunDesignationsAnswer>(fixture(run).designationsAnswer()).designations
                run.list("adp").forEach { want ->
                    val format = want.string("format")
                    val model = loaded(vm(run, AdpModel.build(format, zone)))
                    val label = "${run.string("fixture")} $format"
                    assertEquals(format, model.format)
                    assertEquals(want.getValue("gap").jsonPrimitive.boolean, model.gap, label)
                    val rows = want.list("rows")
                    assertEquals(rows.map { it.string("id") }, model.rows.map { it.id }, "$label order")
                    model.rows.zip(rows).forEach { (row, wanted) ->
                        val id = wanted.string("id")
                        assertEquals(wanted.string("adp"), row.adp, id)
                        assertEquals(wanted.string("rank"), row.rank, id)
                        assertEquals(wanted.string("gap"), row.row.gap, id)
                        wanted.text("heat")?.let { assertEquals(it, row.row.heat.id, id) }
                    }
                    val basis = want.strings("basis")
                    assertEquals(basis, model.basis.take(basis.size), label)
                    assertEquals(if (capture == null) 0 else 1, model.basis.size - basis.size, label)
                    // Review Focus: the drafts' players the board does not carry, and the board's with no ADP, are
                    // not drawn, as the web draws neither.
                    val shown = model.rows.map { it.id }.toSet()
                    assertTrue(want.strings("sourcesOnly").none { it in shown }, label)
                    assertTrue(want.strings("noAdp").none { it in shown }, label)
                }
            }
        }

    @Test
    fun `the contract run has players the drafts have and the board does not, and the stand-in the reverse`() {
        val contract = runs.first { fixture(it) == RunFixture.Contract }
        val standIn = runs.first { fixture(it) == RunFixture.StandIn }
        assertTrue(
            contract
                .list("adp")
                .first()
                .strings("sourcesOnly")
                .isNotEmpty(),
        )
        assertTrue(
            standIn
                .list("adp")
                .first()
                .strings("noAdp")
                .isNotEmpty(),
        )
    }

    @Test
    fun `Compare sets every pair as the web does`() =
        runTest {
            runs.forEach { run ->
                val slugs = index(fixture(run)).associate { it.id to it.slug }
                run.getValue("compare").jsonObject.list("pairs").forEach { want ->
                    val ask = CompareAsk(listOf(slugs[want.string("a")], slugs[want.string("b")]), want.string("format"), null)
                    val model = loaded(vm(run, CompareReader.build(ask)))
                    val label = "${run.string("fixture")} ${want.string("a")} ${want.string("b")} ${want.string("format")}"
                    assertNull(model.lead, label)
                    expect(model.outcome, want, label)
                }
            }
        }

    private fun expect(
        outcome: CompareOutcome,
        want: JsonObject,
        label: String,
    ) {
        when (outcome) {
            CompareOutcome.None -> error("no outcome for $label")
            is CompareOutcome.Same -> assertEquals("same", want.string("kind"), label)
            is CompareOutcome.Table -> {
                val table = outcome.table
                assertEquals("call", want.string("kind"), label)
                assertEquals(want.text("leader"), table.heads.first().id, label)
                assertEquals(want.text("call"), table.call, label)
                assertEquals(want.text("evidence"), table.evidence, label)
                assertEquals(want.strings("basis"), table.basis, label)
                val rows = want.list("rows")
                assertEquals(rows.map { it.string("label") }, table.rows.map { it.label }, label)
                table.rows.zip(rows).forEach { (row, wanted) ->
                    val cells = wanted.list("cells")
                    val at = "$label ${wanted.string("label")}"
                    assertEquals(wanted.getValue("range").jsonPrimitive.boolean, row.range, at)
                    assertEquals(cells.map { it.string("text") }, row.cells.map { it.text }, at)
                    assertEquals(cells.map { it["wins"]?.jsonPrimitive?.booleanOrNull }, row.cells.map { it.wins }, at)
                    assertEquals(cells.map { it.text("tone") }, row.cells.map { tone(it.tone) }, at)
                }
            }
        }
    }

    private fun tone(tone: GapTone?): String? = tone?.name?.lowercase()

    @Test
    fun `a player on a season-long list loses the call as on the web`() {
        runs.forEach { run ->
            val fixture = fixture(run)
            val manifest = decodeEnvelope<RunManifestAnswer>(fixture.manifestAnswer()).manifest
            val capture = decodeEnvelope<RunDesignationsAnswer>(fixture.designationsAnswer()).designations
            val entries = index(fixture)
            run.getValue("compare").jsonObject.list("held").forEach { want ->
                fun player(
                    id: String,
                    held: Boolean,
                ): ComparePlayer {
                    val entry = entries.first { it.id == id }
                    val status =
                        if (held) {
                            RunPlayerStatus(
                                DesignationStatus.injured_reserve,
                                seasonLong = true,
                                since = null,
                            )
                        } else {
                            capture?.players?.get(id)
                        }
                    return CompareReader.comparePlayer(fixture.page(id), entry).with(status, manifest.season)
                }
                val format = manifest.formats.first { it.id == want.string("format") }
                val input =
                    CompareInput(
                        manifest = manifest,
                        format = format,
                        sources = decodeEnvelope<RunAdpAnswer>(fixture.adpAnswer()).adp.sources,
                        clubs = decodeEnvelope<RunClubsAnswer>(fixture.clubsAnswer()).clubs,
                        underway = run.getValue("underway").jsonPrimitive.boolean,
                        reach = Reach.NONE,
                        scoring = format.label,
                        index = entries,
                        sides =
                            listOf(
                                CompareFound.Player(player(want.string("a"), true)),
                                CompareFound.Player(player(want.string("b"), false)),
                            ),
                    )
                val table = assertInstanceOf(CompareOutcome.Table::class.java, CompareModel.of(input).outcome).table
                assertEquals(want.text("call"), table.call)
                assertEquals(want.text("evidence"), table.evidence)
                val rows = want.list("rows").take(2).map { row -> row.list("cells").map { it.string("text") } }
                assertEquals(rows, table.rows.take(2).map { row -> row.cells.map { it.text } })
                assertTrue(table.rows.take(2).all { row -> row.cells.all { it.wins == null } })
            }
        }
    }

    @Test
    fun `Compare says its first steps and its basis as the web does`() =
        runTest {
            runs.forEach { run ->
                val compare = run.getValue("compare").jsonObject
                val steps = compare.getValue("steps").jsonObject
                assertEquals(steps.string("none"), CompareModel.firstStep(0))
                assertEquals(steps.string("one"), CompareModel.firstStep(1))
                val slugs = index(fixture(run)).take(2).map { it.slug }
                compare.getValue("basis").jsonObject.forEach { (format, lines) ->
                    val basis = lines.jsonArray.map { it.jsonPrimitive.content }
                    val model = loaded(vm(run, CompareReader.build(CompareAsk(slugs, format, null))))
                    val table = assertInstanceOf(CompareOutcome.Table::class.java, model.outcome).table
                    // Exactly the one basis the table prints: the Gap's sentence only beside a Gap row.
                    val gapRow = table.rows.any { it.label == CompareRows.GAP_LABEL }
                    assertEquals(
                        if (gapRow) basis else basis.filter { it != Words.BoardBasis.gap },
                        table.basis,
                        "${run.string("fixture")} $format",
                    )
                    assertEquals(basis.contains(Words.BoardBasis.gap), gapRow, "a format that compares draws the Gap")
                }
            }
        }

    @Test
    fun `the clubs index leads and lists every club as the web does`() =
        runTest {
            runs.forEach { run ->
                val model = loaded(ClubScreens.clubs(reads(run), zone, SessionEnd {}))
                val want = run.getValue("clubs").jsonObject
                assertEquals(want.string("lead"), model.lead)
                val cards = want.list("clubs")
                assertEquals(cards.map { it.string("abbr") }, model.clubs.map { it.abbr })
                model.clubs.zip(cards).forEach { (card, wanted) ->
                    assertEquals(wanted.string("name"), card.name)
                    assertEquals(wanted.string("meta"), card.meta)
                    val strength = wanted["strength"]?.takeIf { it != JsonNull }?.jsonObject
                    assertEquals(
                        strength?.let { StrengthFigure(it.string("value"), it.string("caption")) },
                        card.strength,
                        wanted.string("abbr"),
                    )
                    assertEquals(wanted.text("lead"), card.lead?.sheetPlayer?.id, wanted.string("abbr"))
                    assertEquals(wanted.string("players"), card.players)
                }
            }
        }

    @Test
    fun `every club's page says its hero, games, rows and basis as the web does`() =
        runTest {
            runs.forEach { run ->
                val files = ClubFiles.read(reads(run), sources = true)
                val played = run.getValue("played").jsonObject
                assertEquals(run.getValue("underway").jsonPrimitive.boolean, files.underway)
                assertEquals(played.getValue("complete").jsonPrimitive.int, files.played.complete)
                val partial = played["partial"]?.takeIf { it != JsonNull }?.jsonObject
                assertEquals(partial?.strings("days"), files.played.partial?.days)
                val capture = if (files.capture == null) 0 else 1
                run.list("clubPages").forEach { want ->
                    val abbr = want.string("abbr")
                    val model = requireNotNull(clubPageModel(files, abbr.lowercase(), now(run), zone)) { abbr }
                    val hero = want["hero"]?.takeIf { it != JsonNull }?.jsonObject
                    assertEquals(hero?.string("value"), model.hero?.value, abbr)
                    assertEquals(hero?.string("caption"), model.hero?.caption, abbr)
                    assertEquals(hero?.string("note"), model.hero?.note, abbr)
                    assertEquals(hero?.getValue("hardest")?.jsonObject?.string("figure"), model.hero?.hardest, abbr)
                    assertEquals(hero?.getValue("hardest")?.jsonObject?.string("caption"), model.hero?.hardestCaption, abbr)
                    assertEquals(want.string("scheduleCaption"), model.scheduleCaption, abbr)
                    val games = want.list("games")
                    assertEquals(games.map { it.getValue("week").jsonPrimitive.int }, model.games.map { it.week }, abbr)
                    assertEquals(games.map { it.string("opponent") }, model.games.map { it.opponent }, abbr)
                    assertEquals(games.map { it.string("value") }, model.games.map { it.value }, abbr)
                    assertEquals(games.map { it.getValue("played").jsonPrimitive.boolean }, model.games.map { it.played }, abbr)
                    assertEquals(want.strings("rows"), model.rows.map { it.id }, abbr)
                    assertEquals(want.strings("market"), model.market.map { it.id }, abbr)
                    assertEquals(BoardColumns.Ranked(want.getValue("gap").jsonPrimitive.boolean), model.columns, abbr)
                    val pair = want.strings("pair")
                    assertEquals(if (pair.size == 2) pair else emptyList(), model.compare?.ids.orEmpty(), abbr)
                    val basis = want.strings("basis")
                    assertEquals(basis, model.basis.take(basis.size), abbr)
                    assertEquals(basis.size + capture, model.basis.size, abbr)
                }
                assertNull(clubPageModel(files, "zzz", now(run), zone), "a club the run does not carry")
            }
        }

    @Test
    fun `the schedule grid is the web's cell for cell`() =
        runTest {
            runs.forEach { run ->
                val model = scheduleModel(ClubFiles.read(reads(run), sources = false))
                val want = run.getValue("schedule").jsonObject
                assertEquals(want.string("lead"), model.grid.lead)
                assertEquals(want.text("strengthLabel"), model.grid.strengthLabel)
                assertEquals(want.getValue("played").jsonPrimitive.int, model.grid.played)
                assertEquals(want.getValue("weeks").jsonArray.map { it.jsonPrimitive.int }, model.grid.weeks)
                assertEquals(want.string("legendHard"), model.legendHard)
                val rows = want.list("rows")
                assertEquals(rows.map { it.string("abbr") }, model.grid.rows.map { it.abbr })
                model.grid.rows.zip(rows).forEach { (row, wanted) ->
                    val abbr = wanted.string("abbr")
                    assertEquals(wanted.string("name"), row.name, abbr)
                    assertEquals(wanted["face"]?.takeIf { it != JsonNull }?.jsonObject?.string("name"), row.faceName, abbr)
                    assertEquals(wanted["rank"]?.jsonPrimitive?.intOrNull, row.rank, abbr)
                    assertEquals(wanted.text("strength"), row.strength, abbr)
                    val cells = wanted.list("cells")
                    assertEquals(cells.map { it.text("opponent") }, row.cells.map { it.club }, abbr)
                    assertEquals(cells.map { it.string("value") }, row.cells.map { it.value }, abbr)
                    assertEquals(cells.map { it.getValue("hard").jsonPrimitive.boolean }, row.cells.map { it.hard }, abbr)
                    assertEquals(cells.map { it.getValue("played").jsonPrimitive.boolean }, row.cells.map { it.played }, abbr)
                    val opponents =
                        cells.map { cell ->
                            cell.text("opponent")?.let {
                                "${if (cell.getValue("home").jsonPrimitive.boolean) Words.ClubPage.home else Words.ClubPage.away} $it"
                            }
                        }
                    assertEquals(opponents, row.cells.map { it.opponent }, abbr)
                }
            }
        }

    @Test
    fun `the reach words read as reach's own writes them`() {
        assertEquals("", SeasonReach.words(Reach.NONE))
        assertEquals("through week 5", SeasonReach.words(Reach(5, null)))
        val partial = Reach(5, Reach.Partial(6, listOf("Thursday"), 1))
        assertEquals("through week 5 and week 6's Thursday game", SeasonReach.words(partial))
        assertEquals("weeks 1 to 5 and week 6's Thursday game are played", SeasonReach.playedThrough(partial))
        assertEquals("week 1 is played", SeasonReach.playedThrough(Reach(1, null)))
        assertEquals("through part of week 6", SeasonReach.words(Reach(0, Reach.Partial(6, emptyList(), 0))))
        assertFalse(SeasonReach.playedThrough(Reach.NONE).isNotEmpty())
    }
}
