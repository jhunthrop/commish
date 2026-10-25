package app.trycommish.core.shell

import app.trycommish.api.CommishJson
import app.trycommish.api.models.BoardFormat
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.LeaguePhase
import app.trycommish.api.models.ScoringPreset
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.time.Instant

/** A followed league as shell.json writes it, the web's ContextLeague in part. */
data class WebLeague(
    val id: String,
    val name: String,
    val host: LeagueHost,
    val phase: LeaguePhase,
    val draftAt: String?,
)

/** One clock over one set of followed leagues, with the web's names and phase words for them. */
data class ShellCase(
    val set: String,
    val now: String,
    val leagues: List<WebLeague>,
    val names: Map<String, String>,
    val phases: Map<String, String>,
)

/** One platform, scoring and board with the web's line under the league's name. */
data class ShellLine(
    val host: LeagueHost,
    val scoring: ScoringPreset,
    val format: BoardFormat,
    val line: String,
)

/** shared/fixtures/parity/shell.json, written from the web's menu-words.ts, names.ts and card.ts. */
data class ShellParity(
    val zone: String,
    val cases: List<ShellCase>,
    val lines: List<ShellLine>,
    val sheetLoading: String,
)

/** The parity file read by hand: the test fixtures' source set carries no serialization plugin. */
private object ShellParityReader {
    fun read(text: String): ShellParity {
        val root = CommishJson.parseToJsonElement(text).jsonObject
        return ShellParity(
            zone = root.text("zone"),
            cases = root.getValue("cases").jsonArray.map { case(it.jsonObject) },
            lines = root.getValue("lines").jsonArray.map { line(it.jsonObject) },
            sheetLoading = root.text("sheetLoading"),
        )
    }

    private fun case(o: JsonObject) =
        ShellCase(
            set = o.text("set"),
            now = o.text("now"),
            leagues = o.getValue("leagues").jsonArray.map { league(it.jsonObject) },
            names = o.words("names"),
            phases = o.words("phases"),
        )

    private fun league(o: JsonObject) =
        WebLeague(
            id = o.text("id"),
            name = o.text("name"),
            host = o.value("host", LeagueHost.serializer()),
            phase = o.value("phase", LeaguePhase.serializer()),
            draftAt = o["draft_at"]?.takeUnless { it is JsonNull }?.jsonPrimitive?.content,
        )

    private fun line(o: JsonObject) =
        ShellLine(
            host = o.value("host", LeagueHost.serializer()),
            scoring = o.value("scoring", ScoringPreset.serializer()),
            format = o.value("format", BoardFormat.serializer()),
            line = o.text("line"),
        )

    private fun JsonObject.text(key: String): String = getValue(key).jsonPrimitive.content

    private fun JsonObject.words(key: String): Map<String, String> =
        getValue(key).jsonObject.mapValues { (_, v: JsonElement) -> v.jsonPrimitive.content }

    private fun <T> JsonObject.value(
        key: String,
        serializer: KSerializer<T>,
    ): T = CommishJson.decodeFromJsonElement(serializer, getValue(key))
}

/** The shell's fixtures: the web's parity file, and the account's three leagues the iOS mock draws. */
object ShellFixtures {
    val parity: ShellParity by lazy {
        ShellParityReader.read(File(System.getProperty("fixtures"), "parity/shell.json").readText())
    }

    /** The fixture's week clock: Saturday noon Central. */
    val week: Instant = Instant.parse("2026-10-17T17:00:00Z")

    fun followed(
        league: WebLeague,
        scoring: ScoringPreset? = ScoringPreset.ppr,
        waiversOpen: Boolean = true,
    ): FollowedLeague =
        FollowedLeague(
            id = league.id,
            name = league.name,
            host = league.host,
            scoring = scoring,
            format = BoardFormat.ppr,
            phase = league.phase,
            draftAt = league.draftAt?.let(Instant::parse),
            waiversOpen = waiversOpen,
        )

    /** The FFPC league in season, a Sleeper league before its draft and one in its playoffs, each
     * scoring PPR as the fixture API's GET /me says (the iOS shell's mock). */
    fun three(): List<FollowedLeague> =
        parity.cases
            .first { it.set == "account" }
            .leagues
            .filter { it.id.takeLast(3) in setOf("026", "040", "042") }
            .map { followed(it) }

    /** A GET /me answer for these leagues, the selection and the season, as the API writes it. */
    fun meBody(
        leagues: List<FollowedLeague>,
        selected: String?,
        season: String? = "in_season",
    ): String {
        fun context(l: FollowedLeague): String =
            """{"id":"${l.id}","name":"${l.name}","host":"${l.host.value}","team_name":"","standing":null,""" +
                """"scoring":"${l.scoring?.value ?: "ppr"}","format":"${l.format?.value ?: "ppr"}","settings_league_id":null,""" +
                """"phase":"${l.phase.value}","phase_basis":"","draft_at":${l.draftAt?.let { "\"$it\"" } ?: "null"},""" +
                """"playoff_start_week":null,"waivers_open":${l.waiversOpen}}"""
        val chosen = leagues.firstOrNull { it.id == selected }?.let(::context) ?: "null"
        val seasonField = season?.let { ""","season":{"phase":"$it","week":7,"basis":""}""" } ?: ""
        return """{"ok":true,"data":{"id":"00000000-0000-0000-0000-000000000001","email":"m@example.com",""" +
            """"league":$chosen,"leagues":[${leagues.joinToString(",", transform = ::context)}]$seasonField}}"""
    }
}
