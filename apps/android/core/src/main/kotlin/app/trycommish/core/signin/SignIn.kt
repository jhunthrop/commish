package app.trycommish.core.signin

import app.trycommish.api.Transport
import app.trycommish.api.data
import app.trycommish.api.models.DeviceKind
import app.trycommish.api.models.PairInput
import app.trycommish.api.models.Paired
import app.trycommish.core.Session
import kotlinx.coroutines.CancellationException
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/** PKCE (RFC 7636) with S256: a random verifier the app keeps, its hashed challenge the login sends. */
object Pkce {
    private const val VERIFIER_BYTES = 32
    private val base64Url = Base64.getUrlEncoder().withoutPadding()

    /** 43 characters of base64url from 32 random bytes. */
    fun verifier(random: SecureRandom): String = base64Url.encodeToString(ByteArray(VERIFIER_BYTES).also(random::nextBytes))

    /** The S256 challenge: base64url of the verifier's SHA-256, no padding. */
    fun challenge(verifier: String): String =
        base64Url.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))
}

/** The device and its token the API minted for a pairing code. */
data class PairedDevice(
    val token: String,
    val deviceId: String,
)

/** `POST /devices/pair` with the app's kind and the PKCE verifier. */
fun interface Pairing {
    suspend fun pair(
        code: String,
        name: String,
        kind: DeviceKind,
        verifier: String,
    ): PairedDevice
}

/** The pairing through the API. */
class ApiPairing(
    private val transport: Transport,
) : Pairing {
    override suspend fun pair(
        code: String,
        name: String,
        kind: DeviceKind,
        verifier: String,
    ): PairedDevice {
        val paired =
            transport
                .devices()
                .pairDevice(PairInput(code = code, name = name, kind = kind, codeVerifier = verifier))
                .data<Paired>()
        return PairedDevice(paired.token, paired.device.id.toString())
    }
}

sealed interface SignInResult {
    data object SignedIn : SignInResult

    /** A return link with no sign-in begun here (used, or the app restarted since): nothing to say,
     * the member signs in again from the button. */
    data object Ignored : SignInResult

    data class Refused(
        val message: String,
    ) : SignInResult
}

/** What the member reads when sign-in does not finish. */
@Suppress("ktlint:standard:property-naming") // Word tables read like Words.LeagueHome.
object SignInWords {
    const val signIn = "Sign in"
    const val lead = "Sign in to see your leagues. Commish opens your browser to sign in, then brings you back here."
    const val didNotFinish = "Sign-in did not finish. Check your connection and sign in again."
}

/**
 * The app's sign-in on the device bearer path (spec §5.2, with PKCE from Task B): `start` makes a
 * verifier, keeps it in memory for this one flow and gives the login URL to open in a Custom Tab;
 * `complete` takes the return link, refuses one that is not the app's own return or has no flow
 * begun, and trades the code with the verifier for the device token, kept in the session.
 */
class SignIn(
    private val apiBaseUrl: String,
    private val returnTo: String,
    private val deviceName: String,
    private val pairing: Pairing,
    private val session: Session,
    private val random: SecureRandom,
) {
    private var verifier: String? = null

    fun start(): String {
        val made = Pkce.verifier(random)
        verifier = made
        val query =
            listOf(
                "client" to KIND.value,
                "return_to" to returnTo,
                "code_challenge" to Pkce.challenge(made),
                "code_challenge_method" to "S256",
            ).joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v, UTF_8)}" }
        return "${apiBaseUrl.trimEnd('/')}/auth/login?$query"
    }

    suspend fun complete(link: String): SignInResult {
        val code = codeOf(link) ?: return SignInResult.Refused(SignInWords.didNotFinish)
        val held = verifier ?: return SignInResult.Ignored
        verifier = null
        return try {
            val device = pairing.pair(code, deviceName, KIND, held)
            session.signIn(device.token, device.deviceId)
            SignInResult.SignedIn
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            SignInResult.Refused(SignInWords.didNotFinish)
        }
    }

    /** The code from a link that is exactly the app's return, null from any other. */
    private fun codeOf(link: String): String? {
        val uri = runCatching { URI(link) }.getOrNull() ?: return null
        val base = "${uri.scheme}://${uri.rawAuthority}${uri.rawPath}"
        if (base != returnTo) return null
        return uri.rawQuery
            ?.split('&')
            ?.map { it.split('=', limit = 2) }
            ?.firstOrNull { it.size == 2 && it[0] == "code" }
            ?.let { URLDecoder.decode(it[1], UTF_8) }
            ?.takeIf { it.isNotBlank() }
    }

    private companion object {
        val KIND = DeviceKind.android

        /** By name: the Charset overloads need API 33. */
        const val UTF_8 = "UTF-8"
    }
}
