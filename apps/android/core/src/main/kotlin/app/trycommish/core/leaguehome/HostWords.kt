package app.trycommish.core.leaguehome

import app.trycommish.api.models.LeagueHost

/**
 * A platform in the words the screens place it with (Lane 310): its name, where a move is made on it
 * (`placed`, "on ESPN"), the lead of a read's stamp ("ESPN 4 min ago") and its own page of a kind ("ESPN trades").
 * A real platform's words are `of(host)`, so every screen says exactly what it said before. The store
 * graphics draw a neutral platform from shared/store/store-host.json through the same parameter, so no
 * platform is named in a store shot; the shipped apps never build one.
 */
data class HostWords(
    val name: String,
    val placed: String,
    val stamp: String,
    private val ownPattern: String,
) {
    /** The platform's own page of a kind: "ESPN trades", "ESPN waivers". */
    fun own(noun: String): String = ownPattern.replace(NOUN, noun)

    companion object {
        /** Where `own` puts the kind of page in the pattern. */
        const val NOUN = "{noun}"

        /** A real platform: names.ts hostWords, placed with "on". */
        fun of(host: LeagueHost): HostWords = named(ValueWords.platform(host))

        /** A platform by its name: "ESPN", "on ESPN", "ESPN", "ESPN {noun}". */
        fun named(name: String): HostWords = HostWords(name, "on $name", name, "$name $NOUN")
    }
}
