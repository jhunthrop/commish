package app.trycommish.core.account

import android.content.Context
import android.content.SharedPreferences
import app.trycommish.api.CommishJson
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException

/** A kind of push the account can turn on or off (spec 2026-10-24-native-mobile-apps-design §5.3): the
 * Thursday read, a starter's status change, waivers clearing. */
@Serializable
enum class PushKind {
    @SerialName("thursday")
    Thursday,

    @SerialName("status")
    Status,

    @SerialName("waivers")
    Waivers,
}

/** Which end of quiet hours is being set. */
enum class QuietEnd { From, To }

/** The push switches and quiet hours, minutes after midnight on the phone's clock. Every kind is on and
 * quiet hours run 23:00 to 08:00 until the member changes them (§5.3's defaults). */
@Serializable
data class PushSettings(
    val off: Set<PushKind> = emptySet(),
    val quietFrom: Int = DEFAULT_FROM,
    val quietTo: Int = DEFAULT_TO,
) {
    fun on(kind: PushKind): Boolean = kind !in off

    /** These settings with one kind turned on or off. */
    fun with(
        kind: PushKind,
        isOn: Boolean,
    ): PushSettings = copy(off = if (isOn) off - kind else off + kind)

    /** These settings with one end of quiet hours moved, kept within a day. */
    fun with(
        end: QuietEnd,
        minutes: Int,
    ): PushSettings {
        val kept = Math.floorMod(minutes, MINUTES_IN_A_DAY)
        return if (end == QuietEnd.From) copy(quietFrom = kept) else copy(quietTo = kept)
    }

    fun minutes(end: QuietEnd): Int = if (end == QuietEnd.From) quietFrom else quietTo

    companion object {
        const val MINUTES_IN_A_DAY = 24 * 60
        private const val DEFAULT_FROM = 23 * 60
        private const val DEFAULT_TO = 8 * 60
        val standard = PushSettings()
    }
}

/** Where the switches are kept. The account does not carry them yet (GET and PATCH /me have no push
 * fields), so the app keeps them on the phone and the screen says so; once the API carries them a store
 * that writes PATCH /me takes this one's place. */
interface PushStore {
    fun load(): PushSettings

    fun save(settings: PushSettings)
}

/** The switches in the app's preferences, as JSON under one key; a value that will not read is the
 * standard settings. */
class DevicePushStore(
    context: Context,
) : PushStore {
    private val prefs: SharedPreferences = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    override fun load(): PushSettings {
        val text = prefs.getString(KEY, null) ?: return PushSettings.standard
        return try {
            CommishJson.decodeFromString(PushSettings.serializer(), text)
        } catch (e: SerializationException) {
            PushSettings.standard
        } catch (e: IllegalArgumentException) {
            PushSettings.standard
        }
    }

    override fun save(settings: PushSettings) {
        prefs.edit().putString(KEY, CommishJson.encodeToString(PushSettings.serializer(), settings)).apply()
    }

    private companion object {
        const val FILE = "commish_push"
        const val KEY = "push"
    }
}

/** The switches in memory, for a test or a snapshot. */
class MemoryPushStore(
    private var settings: PushSettings = PushSettings.standard,
) : PushStore {
    override fun load(): PushSettings = settings

    override fun save(settings: PushSettings) {
        this.settings = settings
    }
}
