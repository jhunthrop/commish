package app.trycommish.storeshots

import app.trycommish.core.leaguehome.HostWords
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.lang.reflect.Modifier
import java.util.IdentityHashMap

/** The neutral platform the store shots draw in place of the league's own (shared/store/store-host.json,
 * Lane 310), read through the same words every screen takes. */
val storeHost: HostWords by lazy {
    val path = requireNotNull(System.getProperty("storeHost")) { "storeHost names no file" }
    val entry = Json.parseToJsonElement(File(path).readText()).jsonObject

    fun field(name: String) = requireNotNull(entry[name]) { "store-host.json has no $name" }.jsonPrimitive.content
    HostWords(field("name"), field("placed"), field("stamp"), field("own"))
}

/** Where the store shots' scene strings are written: one JSON list per shot, which the store check
 * (shared/store/scene-strings.ts) reads for a platform's name. */
private const val SCENE_STRINGS = "scene-strings"

/** The packages whose objects a scene draws from: the app's models, the API's answers. */
private const val APP_PACKAGE = "app.trycommish."

/**
 * Every string a scene draws from (Lane 310): each string reachable from the objects handed to the screen
 * (its model, stamp, pin and the shell's bars), sorted once each. The screen can only draw what these hold,
 * so a platform's name in none of them is a platform's name in no pixel.
 */
fun sceneStrings(roots: List<Any?>): List<String> {
    val found = sortedSetOf<String>()
    val seen = IdentityHashMap<Any, Unit>()

    fun walk(value: Any?) {
        when (value) {
            null, is Number, is Boolean, is Char, is Enum<*> -> return
            is String -> {
                if (value.isNotBlank()) found += value
                return
            }
            is CharSequence -> {
                if (value.isNotBlank()) found += value.toString()
                return
            }
        }
        val node = value ?: return
        if (seen.put(node, Unit) != null) return
        when (node) {
            is Iterable<*> -> node.forEach(::walk)
            is Map<*, *> ->
                node.forEach { (k, v) ->
                    walk(k)
                    walk(v)
                }
            is Array<*> -> node.forEach(::walk)
            is Pair<*, *> -> {
                walk(node.first)
                walk(node.second)
            }
            is Triple<*, *, *> -> {
                walk(node.first)
                walk(node.second)
                walk(node.third)
            }
            else -> if (node.javaClass.name.startsWith(APP_PACKAGE)) fields(node).forEach(::walk)
        }
    }
    roots.forEach(::walk)
    return found.toList()
}

/** An app object's own fields, its supertypes' with them, the static ones left out. */
private fun fields(node: Any): List<Any?> =
    generateSequence(node.javaClass as Class<*>?) { it.superclass }
        .takeWhile { it.name.startsWith(APP_PACKAGE) }
        .flatMap { it.declaredFields.asSequence() }
        .filterNot { Modifier.isStatic(it.modifiers) || it.isSynthetic }
        .map { field ->
            runCatching {
                field.isAccessible = true
                field.get(node)
            }.getOrNull()
        }.toList()

/** Writes a shot's scene strings beside its PNG, as the JSON list the store check reads. */
fun writeSceneStrings(
    shot: StoreShot,
    roots: List<Any?>,
) {
    val dir = File(StoreGraphics.folder, SCENE_STRINGS).apply { mkdirs() }
    val json = Json { prettyPrint = true }
    File(dir, "${shot.file}.json").writeText(
        json.encodeToString(JsonArray.serializer(), JsonArray(sceneStrings(roots).map(::JsonPrimitive))) + "\n",
    )
}
