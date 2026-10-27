package app.trycommish.core.player

import app.trycommish.api.CommishJson
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.BoardFormat
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.PlayerVerb
import app.trycommish.api.models.RunAdpAnswer
import app.trycommish.api.models.RunBoardAnswer
import app.trycommish.api.models.RunClubsAnswer
import app.trycommish.api.models.RunDesignations
import app.trycommish.api.models.RunLastGameClub
import app.trycommish.api.models.RunPlayerStatus
import app.trycommish.api.models.RunScheduleAnswer
import app.trycommish.api.models.ScoringPreset
import app.trycommish.core.Format
import app.trycommish.core.board.BoardStatus
import app.trycommish.core.board.RunFixture
import app.trycommish.core.board.RunWords
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Instant

/**
 * The player page held to the web's (shared/fixtures/parity/player-sheet.json), as the iOS
 * PlayerPageParityTests hold it: every page of both fixture runs (where drafters take him and his value,
 * shown before the season only, his range's caption, his club, the card as built, his season block, his
 * tier box, the every-format table, the read's stamp and figures, the held tier, whether the run is under
 * way, and B165's status note and club line); what a read not written will be built from; the club line,
 * the status note and the league line on every case; and the league verb's words for every kind on every
 * platform, Start him turning to the lineup once his game has kicked off.
 */
class PlayerPageParityTest {
    private val noteClock: Instant = Instant.parse(SheetParity.json.string("noteClock"))

    private fun input(
        run: RunFixture,
        player: String,
        format: String,
    ): PageInput =
        PageInput(
            source = PageSource.Page(run.page(player)),
            manifest = SheetParity.manifest(run).manifest,
            sources = decodeEnvelope<RunAdpAnswer>(run.adpAnswer()).adp.sources,
            capture = SheetParity.capture(run),
            clubs = decodeEnvelope<RunClubsAnswer>(run.clubsAnswer()).clubs,
            schedule = decodeEnvelope<RunScheduleAnswer>(run.scheduleAnswer()).schedule,
            board = decodeEnvelope<RunBoardAnswer>(run.boardAnswer(format)),
            week = null,
            host = null,
            league = null,
            zone = SheetParity.zone,
            now = noteClock,
        )

    @Test
    fun `each page prints the page's words`() {
        val pages = SheetParity.cases("pages")
        assertTrue(pages.size >= 9)
        pages.forEach { page ->
            val run = SheetParity.run(page.string("run"))
            val id = page.string("player")
            val formatId = page.string("format")
            val input = input(run, id, formatId)
            val model = requireNotNull(PlayerPages.page(input)) { id }
            val name = "$id on ${page.string("run")}"
            val player = run.page(id)
            val format = input.manifest.formats.first { it.id == formatId }
            val numbers = requireNotNull(player.formats[formatId])
            val underway = page.getValue("underway").jsonPrimitive.booleanOrNull == true
            val heldTier = page.text("heldTier")
            val words =
                PageWords.line(
                    format,
                    LineNumbers.of(numbers),
                    RunWords.adpDrafts(input.sources, format.id),
                    input.boardSize,
                    PageWords.Season(input.manifest.season, underway, heldTier != null),
                )
            val expected = page.getValue("words").jsonObject
            assertEquals(underway, PlayerPages.underway(input), name)
            assertEquals(expected.string("caption"), words.caption, name)
            assertEquals(expected.string("draftersLabel"), words.draftersLabel, name)
            assertEquals(expected.string("draftersFigure"), words.draftersFigure, name)
            assertEquals(expected.string("drafters"), words.drafters, name)
            expected.text("value")?.let { assertEquals(it, words.value, name) }
            // The facts show before the season only, as the web's page shows them.
            assertEquals(underway, model.facts == null, name)
            model.facts?.let {
                assertEquals(expected.string("drafters"), it.drafters.words, name)
                it.outcomes?.let { outcomes -> assertEquals(page.string("outcomesCaption"), outcomes.caption, name) }
            }
            assertEquals(page.string("figure"), Format.fixed(numbers.projected.toDouble()), name)
            assertEquals(page.string("clubName"), model.hero.club, name)
            assertEquals(heldTier, model.heldTier, name)
            assertEquals(page.text("readStamp"), PageWords.readStamp(player.capsule), name)
            val figures = ReadFigures.preseason(player.capsule?.pulls.orEmpty(), numbers.projected.toDouble())
            assertEquals(
                page.getValue("pulls").jsonArray.map {
                    it.jsonObject.let { f ->
                        listOf(f.text("label"), f.string("figure"), f.string("caption"))
                    }
                },
                figures.map { listOf(it.label, it.figure, it.caption) },
                name,
            )
            assertEquals(listOfNotNull(page.text("clubNote"), page.text("statusNote")), model.notes, name)
            sections(model, page, name)
        }
    }

    /** The card as built, the season block, the tier box and the every-format table. */
    private fun sections(
        model: PlayerPageModel,
        page: JsonObject,
        name: String,
    ) {
        val built = page.getValue("built").jsonObject
        val next = built.obj("next")?.let { CardHead(it.getValue("week").jsonPrimitive.int, it.string("opponent")) }
        assertEquals(next, model.card.head, name)
        assertEquals(built.getValue("tiles").jsonArray.map { tileOf(it.jsonObject) }, model.card.tiles.map(::tile), name)
        season(model.season, page.getValue("season").jsonObject, name)
        tables(model, page, name)
    }

    private fun season(
        season: SeasonView,
        json: JsonObject,
        name: String,
    ) {
        assertEquals(json.string("aside"), season.aside, name)
        assertEquals(
            json.getValue("heads").jsonArray.map { it.jsonObject.let { h -> h.string("short") to h.string("full") } },
            season.heads.map {
                it.short to
                    it.full
            },
            name,
        )
        val points = json.getValue("pointsHead").jsonObject
        assertEquals(points.string("short") to points.string("full"), season.pointsHead.short to season.pointsHead.full, name)
        val line =
            json.obj("line")?.let { l ->
                val cell = { c: JsonObject -> c.string("value") to c.string("caption") }
                listOf(
                    l.string(
                        "lead",
                    ),
                    l.string("sub"),
                    l.string("total"),
                    cell(l.getValue("points").jsonObject),
                    l.getValue("cells").jsonArray.map {
                        cell(it.jsonObject)
                    },
                )
            }
        assertEquals(
            line,
            season.line?.let {
                listOf(
                    it.lead,
                    it.sub,
                    it.total,
                    it.points.value to it.points.caption,
                    it.cells.map { c ->
                        c.value to
                            c.caption
                    },
                )
            },
            name,
        )
        assertEquals(
            json.getValue("rows").jsonArray.map { r ->
                r.jsonObject.let {
                    listOf(
                        it.getValue("week").jsonPrimitive.int,
                        it.string("opponent"),
                        it.string("note"),
                        it.string("tone"),
                        it.text("points"),
                        it["cells"]?.takeIf { c -> c != JsonNull }?.jsonArray?.map { c -> c.jsonPrimitive.content },
                    )
                }
            },
            season.rows.map { listOf(it.week, it.opponent, it.note, it.tone.id, it.points, it.cells) },
            name,
        )
        assertEquals(
            json.getValue("ahead").jsonArray.map { a ->
                a.jsonObject.let {
                    listOf(
                        it.getValue("week").jsonPrimitive.int,
                        it.string("opponent"),
                        it.getValue("bye").jsonPrimitive.booleanOrNull,
                        it.string("day"),
                    )
                }
            },
            season.ahead.map { listOf(it.week, it.opponent, it.bye, it.day) },
            name,
        )
        assertEquals(json.string("none"), season.none, name)
        assertEquals(json.text("basis"), season.basis, name)
        assertEquals(
            json.getValue("prior").jsonArray.map { p ->
                p.jsonObject.let {
                    listOf(
                        it.getValue("season").jsonPrimitive.int,
                        it.string("sub"),
                        it.string("total"),
                        it.getValue("cells").jsonArray.map { c ->
                            c.jsonPrimitive.content
                        },
                    )
                }
            },
            season.prior.map { listOf(it.season, it.sub, it.total, it.cells) },
            name,
        )
    }

    private fun tables(
        model: PlayerPageModel,
        page: JsonObject,
        name: String,
    ) {
        page.obj("tier")?.let { tier ->
            val box = requireNotNull(model.tier) { name }
            assertEquals(tier.getValue("tier").jsonPrimitive.int, box.tier, name)
            assertEquals(tier.text("drop"), box.drop, name)
            assertEquals(tier.string("basis"), box.basis, name)
            assertEquals(
                tier.getValue("mates").jsonArray.map { m ->
                    m.jsonObject.let {
                        listOf(
                            it.string("id"),
                            it.string("name"),
                            it.getValue("positionRank").jsonPrimitive.int,
                            it.string("team"),
                            it.string("projected"),
                            it.text("span"),
                        )
                    }
                },
                box.mates.map { listOf(it.id, it.name, it.positionRank, it.team, it.projected, it.span) },
                name,
            )
        }
        val formats = page.getValue("formats").jsonObject
        val rows = formats.getValue("rows").jsonArray.map { it.jsonObject }
        if (rows.size > 1) {
            val table = requireNotNull(model.formats) { name }
            assertEquals(formats.string("head"), table.head, name)
            assertEquals(formats.text("note"), table.note, name)
            assertNull(table.footnote, "$name: no read, every rank the run's")
            assertEquals(
                rows.map {
                    listOf(
                        it.string("label"),
                        it.string("positionRank"),
                        it.string("points"),
                        it.string("vor"),
                        it.string("tier"),
                    )
                },
                table.rows.map { listOf(it.label, it.rank, it.points, it.vor, it.tier) },
                name,
            )
        } else {
            assertNull(model.formats, "$name: one format draws no table")
        }
    }

    @Test
    fun `a read not written says what it will be built from`() {
        val run = RunFixture.StandIn
        val capture = SheetParity.capture(run)
        SheetParity.cases("unwritten").forEach { test ->
            val id = test.string("player")
            val player = run.page(id)
            val format =
                SheetParity
                    .manifest(run)
                    .manifest.formats
                    .first { it.id == test.string("format") }
            val numbers = requireNotNull(player.formats[format.id])
            val board = decodeEnvelope<RunBoardAnswer>(run.boardAnswer(format.id))
            val held = capture?.players?.get(id)?.let { BoardStatus.view(it, SheetParity.zone)?.rank }
            val facts =
                PageSections.UnwrittenFacts(
                    player.position.value,
                    board.rows.size + board.market.size,
                    format,
                    SheetParity.manifest(run).manifest.season,
                    held,
                )
            assertEquals(
                test.getValue("lines").jsonArray.map { l ->
                    l.jsonObject.let { listOf(it.string("lead"), it.string("text"), it.string("figure")) }
                },
                PageSections.unwritten(numbers, facts).map { listOf(it.lead, it.text, it.figure) },
                id,
            )
        }
    }

    @Test
    fun `every verb is worded as the web words it`() {
        val cases = SheetParity.cases("verbs")
        assertTrue(cases.size >= 30)
        cases.forEach { test ->
            val host = LeagueHost.entries.first { it.value == test.string("host") }
            val verb = requireNotNull(CardVerbs.of(CommishJson.decodeFromJsonElement(PlayerVerb.serializer(), test.getValue("verb")), host))
            val name = "${test.getValue("verb").jsonObject.string("kind")} on ${test.string("host")}"
            assertEquals(test.string("label"), verb.label, name)
            assertEquals(test.text("note"), verb.note, name)
            assertEquals(test.getValue("external").jsonPrimitive.booleanOrNull == true, verb.target is CardVerb.Target.Platform, name)
        }
    }

    @Test
    fun `start him turns to the lineup once his game has kicked off`() {
        val start = PlayerVerb(PlayerVerb.Kind.start, null, null, null)
        SheetParity.cases("heldVerbs").forEach { test ->
            val clock = Instant.parse(test.string("clock"))
            val week = WeekFixture.league(test.string("player"), clock)
            assertEquals(test.string("kind"), CardVerbs.held(start, week.line, clock).kind.value, "$clock")
        }
    }

    @Test
    fun `the club line says where his newest game was played`() {
        val clubs = decodeEnvelope<RunClubsAnswer>(RunFixture.StandIn.clubsAnswer()).clubs
        val cases = SheetParity.cases("clubNotes")
        assertTrue(cases.size >= 4)
        cases.forEach { test ->
            val last = CommishJson.decodeFromJsonElement(RunLastGameClub.serializer(), test.getValue("lastGameClub"))
            assertEquals(test.text("words"), PageNotes.club(test.string("team"), last, clubs), test.toString())
        }
        assertNull(PageNotes.club("MIA", null, clubs))
    }

    @Test
    fun `the status note says his status and the capture it is from`() {
        val cases = SheetParity.cases("statusNotes")
        assertTrue(cases.size >= 20)
        cases.forEach { test ->
            val status = CommishJson.decodeFromJsonElement(RunPlayerStatus.serializer(), test.getValue("status"))
            val stamp = test.getValue("capture").jsonObject
            val capture = RunDesignations(stamp.string("readAt"), stamp.text("checkedAt"), emptyMap())
            val restOfSeason = test.getValue("restOfSeason").jsonPrimitive.booleanOrNull == true
            val said = PageNotes.status(status, capture, restOfSeason, SheetParity.zone, Instant.parse(test.string("now")))
            assertEquals(test.string("words"), said, test.toString())
        }
    }

    @Test
    fun `the league line says the figures against the league's scoring`() {
        val cases = SheetParity.cases("leagueLines")
        assertTrue(cases.size >= 20)
        cases.forEach { test ->
            val league = test.getValue("league").jsonObject
            val host = LeagueHost.entries.first { it.value == league.string("host") }
            val scoring = ScoringPreset.entries.first { it.value == league.string("scoring") }
            val format = BoardFormat.entries.first { it.value == league.string("format") }
            val said = PageNotes.league(host, scoring, format, test.string("figures"))
            assertNotNull(said)
            assertEquals(test.text("text"), said, test.toString())
        }
    }
}
