package app.trycommish.core.signin

import app.trycommish.core.MemorySession
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.IOException
import java.net.URI
import java.net.URLDecoder
import java.security.SecureRandom

/** The app's sign-in on the device bearer path with PKCE: the login URL carries the S256 challenge,
 * the return link's code is traded with the verifier the flow began with, and the token lands in the
 * session. */
class SignInTest {
    private val api = "http://10.0.2.2:8080"
    private val returnTo = "https://trycommish.app/app/signed-in"

    private class FakePairing(
        private val fail: Boolean = false,
    ) : Pairing {
        val calls = mutableListOf<List<String>>()

        override suspend fun pair(
            code: String,
            name: String,
            kind: String,
            verifier: String,
        ): PairedDevice {
            calls += listOf(code, name, kind, verifier)
            if (fail) throw IOException("offline")
            return PairedDevice(token = "tok_new", deviceId = "dev-1")
        }
    }

    private fun query(url: String): Map<String, String> =
        URI(url).rawQuery.split('&').associate {
            val (k, v) = it.split('=', limit = 2)
            k to URLDecoder.decode(v, Charsets.UTF_8)
        }

    private fun flow(
        pairing: Pairing,
        session: MemorySession = MemorySession(),
    ) = SignIn(api, returnTo, "Pixel 8", pairing, session, SecureRandom())

    @Test
    fun `the S256 challenge is the base64url SHA-256 of the verifier with no padding`() {
        // Computed with openssl: printf %s <verifier> | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | tr -d =
        assertEquals("uiS3WSueen6h69hUyhsgwZjlT2x0OiEvuq1gD48U8gs", Pkce.challenge("dBjftJeZ4CVP-mJ0z0xg1PJqo7Jd5qAkQ8bQ7O3BpZY"))
    }

    @Test
    fun `a verifier is 43 to 128 characters of the unreserved set`() {
        val verifier = Pkce.verifier(SecureRandom())
        assertTrue(verifier.length in 43..128)
        assertTrue(verifier.all { it.isLetterOrDigit() || it in "-._~" })
    }

    @Test
    fun `the login URL names the app, its return and the challenge`() {
        val url = flow(FakePairing()).start()
        assertTrue(url.startsWith("$api/auth/login?"))
        val q = query(url)
        assertEquals("android", q["client"])
        assertEquals(returnTo, q["return_to"])
        assertEquals("S256", q["code_challenge_method"])
        assertEquals(43, q.getValue("code_challenge").length)
    }

    @Test
    fun `the return link's code is traded with the flow's verifier and the token kept`() =
        runTest {
            val pairing = FakePairing()
            val session = MemorySession()
            val signIn = flow(pairing, session)
            val challenge = query(signIn.start()).getValue("code_challenge")
            val result = signIn.complete("$returnTo?code=abc123&client=android")
            assertEquals(SignInResult.SignedIn, result)
            val (code, name, kind, verifier) = pairing.calls.single()
            assertEquals(listOf("abc123", "Pixel 8", "android"), listOf(code, name, kind))
            assertEquals(challenge, Pkce.challenge(verifier))
            assertEquals("tok_new", session.token)
            assertEquals("dev-1", session.deviceId)
        }

    @Test
    fun `a link not from the app's own return is refused without a call`() =
        runTest {
            val pairing = FakePairing()
            val signIn = flow(pairing)
            signIn.start()
            val result = signIn.complete("https://evil.example/app/signed-in?code=abc123")
            assertInstanceOf(SignInResult.Refused::class.java, result)
            assertTrue(pairing.calls.isEmpty())
        }

    @Test
    fun `a return with no sign-in begun is refused, the verifier never guessed`() =
        runTest {
            val pairing = FakePairing()
            val result = flow(pairing).complete("$returnTo?code=abc123&client=android")
            assertEquals(SignInResult.Refused(SignInWords.notStarted), result)
            assertTrue(pairing.calls.isEmpty())
        }

    @Test
    fun `a verifier is used once`() =
        runTest {
            val pairing = FakePairing()
            val signIn = flow(pairing)
            signIn.start()
            signIn.complete("$returnTo?code=abc123&client=android")
            assertEquals(SignInResult.Refused(SignInWords.notStarted), signIn.complete("$returnTo?code=abc123&client=android"))
        }

    @Test
    fun `a pairing that fails leaves the device signed out with a sentence`() =
        runTest {
            val session = MemorySession()
            val signIn = flow(FakePairing(fail = true), session)
            signIn.start()
            assertEquals(SignInResult.Refused(SignInWords.didNotFinish), signIn.complete("$returnTo?code=abc123&client=android"))
            assertNull(session.token)
        }
}
