package app.trycommish.android

import app.trycommish.core.leaguehome.LeagueHomeWords
import app.trycommish.core.signin.SignInWords
import app.trycommish.design.Words
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File
import java.lang.reflect.Modifier

/**
 * The app's copy guard, the web's (web/src/lib/format/copy-guard.ts) over the same list
 * (shared/words/banned-words.json): no betting or trading word, never "host", no em dash, en dash or
 * semicolon, in strings.xml or in any word table the screens print from.
 */
class CopyGuardTest {
    private val repository = File(requireNotNull(System.getProperty("repository")))
    private val list = Json.parseToJsonElement(File(repository, "shared/words/banned-words.json").readText()).jsonObject

    private fun keys(name: String): List<String> =
        list
            .getValue(name)
            .jsonObject.keys
            .toList()

    private fun strings(name: String): List<String> = list.getValue(name).jsonArray.map { it.jsonPrimitive.content }

    /** The betting line, the field's own lines spared, built as the web builds it. */
    private fun fieldLine(): String {
        val line = list.getValue("line").jsonObject
        val word = line.getValue("word").jsonPrimitive.content
        val after = line.getValue("sparedAfter").jsonArray.joinToString("") { "(?<!${it.jsonPrimitive.content}[ -])" }
        val side = line.getValue("sparedSide").jsonArray.joinToString("") { "(?<!\\b${it.jsonPrimitive.content}-)" }
        val before = line.getValue("sparedBefore").jsonArray.joinToString("") { "(?! ${it.jsonPrimitive.content})" }
        return "$after$side$word$before"
    }

    private val pattern: Regex by lazy {
        val words = keys("bettingOnly") + fieldLine() + keys("bettingShared") + keys("trading") + keys("platform")
        val marks = strings("marks").joinToString("") { Regex.escape(it).removePrefix("\\Q").removeSuffix("\\E") }
        Regex("\\b(${words.joinToString("|")})\\b|[$marks]", RegexOption.IGNORE_CASE)
    }

    private fun bannedIn(text: String): String? = pattern.find(text)?.value

    /** Every string constant a word table holds. */
    private fun table(owner: Class<*>): List<String> =
        owner.declaredFields
            .filter { Modifier.isStatic(it.modifiers) && it.type == String::class.java }
            .map {
                it.isAccessible = true
                it.get(null) as String
            }

    private fun stringsXml(): List<String> {
        val xml = File(repository, "apps/android/app/src/main/res/values/strings.xml").readText()
        return Regex("<string name=\"[^\"]+\">([^<]*)</string>").findAll(xml).map { it.groupValues[1] }.toList()
    }

    @Test
    fun `the guard catches what the list's examples say it catches and spares the rest`() {
        val examples = list.getValue("examples").jsonObject
        examples.getValue("caught").jsonArray.forEach { assertNotNull(it.jsonPrimitive.content, bannedIn(it.jsonPrimitive.content)) }
        examples.getValue("spared").jsonArray.forEach { assertNull(it.jsonPrimitive.content, bannedIn(it.jsonPrimitive.content)) }
    }

    @Test
    fun `no word the app prints is on the list`() {
        val printed =
            stringsXml() + table(Words.LeagueHome::class.java) + table(LeagueHomeWords::class.java) + table(SignInWords::class.java)
        assertEquals(emptyList<String>(), printed.filter { bannedIn(it) != null })
    }

    @Test
    fun `the word tables are read, not empty`() {
        assert(stringsXml().size >= 6)
        assert(table(LeagueHomeWords::class.java).contains(LeagueHomeWords.cannotLoad))
        assert(table(Words.LeagueHome::class.java).contains(Words.LeagueHome.noMoves))
    }
}
