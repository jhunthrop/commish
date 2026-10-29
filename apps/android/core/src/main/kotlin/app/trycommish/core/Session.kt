package app.trycommish.core

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** The device's sign-in: the device token the API minted at pairing and the device's id, the one
 * `DELETE /devices/{id}` signs out. */
interface Session {
    val token: String?
    val deviceId: String?

    fun signIn(
        token: String,
        deviceId: String,
    )

    fun signOut()
}

/** What the app does when the API refuses the device's token: forget it and ask for a sign-in. */
fun interface SessionEnd {
    fun signedOut()
}

/** A session in memory, for tests and previews. */
class MemorySession(
    override var token: String? = null,
    override var deviceId: String? = null,
) : Session {
    override fun signIn(
        token: String,
        deviceId: String,
    ) {
        this.token = token
        this.deviceId = deviceId
    }

    override fun signOut() {
        token = null
        deviceId = null
    }
}

/** The session in EncryptedSharedPreferences, keyed by a master key in the Android Keystore: the token
 * never sits in plain storage. `file` names the store: the sign-in's, or push's kept removal (Lane 288). */
class EncryptedSession(
    context: Context,
    file: String = FILE,
) : Session {
    private val prefs: SharedPreferences =
        EncryptedSharedPreferences.create(
            context,
            file,
            MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )

    override val token: String? get() = prefs.getString(TOKEN, null)
    override val deviceId: String? get() = prefs.getString(DEVICE, null)

    override fun signIn(
        token: String,
        deviceId: String,
    ) {
        prefs
            .edit()
            .putString(TOKEN, token)
            .putString(DEVICE, deviceId)
            .apply()
    }

    override fun signOut() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val FILE = "commish_session"

        /** The store push keeps a removal a sign out could not finish in (Lane 288 security M1). */
        const val PUSH_PENDING = "commish_push_pending"
        private const val TOKEN = "device_token"
        private const val DEVICE = "device_id"
    }
}
