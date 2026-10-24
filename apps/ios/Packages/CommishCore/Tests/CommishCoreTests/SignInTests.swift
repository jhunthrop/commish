import CommishAPI
@testable import CommishCore
import CryptoKit
import Foundation
import Testing

/// Sign-in through the system browser sheet onto the device bearer path, with PKCE (Lane 172's
/// contract): the challenge out on /auth/login, the verifier in on /devices/pair, held in memory only.
struct SignInTests {
    private let base = URL(string: "http://localhost:8080")!

    @Test func theVerifierIsLongRandomAndURLSafe() {
        let verifier = PKCE.verifier()
        #expect((43 ... 128).contains(verifier.count))
        #expect(verifier.allSatisfy { $0.isLetter || $0.isNumber || "-._~".contains($0) })
        #expect(PKCE.verifier() != verifier)
    }

    @Test func theChallengeIsS256Base64URLWithoutPadding() {
        // base64url(SHA-256(verifier)) with the padding cut, as Python's hashlib and base64 give it.
        let verifier = "dBjftJeZ4CVP-mJ92ZjVeoFNnQVxTE3w2Dn2v6MxLm0"
        #expect(PKCE.challenge(for: verifier) == "Kc99hkXx1SJ7Fb5JPyU2VyN6ZTuQqykRwolDWLlrsG0")
    }

    @Test func theLoginURLCarriesClientReturnAndChallenge() throws {
        let url = SignInRoute.login(base: base, challenge: "abc")
        let items = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        #expect(url.path == "/auth/login")
        #expect(items.first { $0.name == "client" }?.value == "ios")
        #expect(items.first { $0.name == "return_to" }?.value == "https://trycommish.app/app/signed-in")
        #expect(items.first { $0.name == "code_challenge" }?.value == "abc")
        #expect(items.first { $0.name == "code_challenge_method" }?.value == "S256")
    }

    @Test func theReturnLinkYieldsItsCode() throws {
        let link = try #require(URL(string: "https://trycommish.app/app/signed-in?code=word-one&client=ios"))
        #expect(SignInRoute.code(from: link) == "word-one")
    }

    @Test(arguments: [
        "https://evil.example/app/signed-in?code=x&client=ios",
        "https://trycommish.app/somewhere?code=x&client=ios",
        "https://trycommish.app/app/signed-in?client=ios",
        "https://trycommish.app/app/signed-in?code=x&client=android",
    ])
    func aLinkThatIsNotOurReturnYieldsNothing(link: String) throws {
        #expect(try SignInRoute.code(from: #require(URL(string: link))) == nil)
    }

    @Test func aCompletedSignInPairsWithTheVerifierAndKeepsTheToken() async throws {
        let pairing = RecordingPairing()
        let store = MemorySessionStore()
        let flow = SignIn(pairing: pairing, store: store, deviceName: "Justin's iPhone")
        let started = flow.start(base: base)
        let link = try #require(URL(string: "https://trycommish.app/app/signed-in?code=c-1&client=ios"))
        try await flow.finish(started, link: link)
        let sent = try #require(await pairing.sent)
        #expect(sent == PairInput(code: "c-1", name: "Justin's iPhone", kind: .ios, codeVerifier: started.verifier))
        #expect(PKCE.challenge(for: started.verifier) == started.challenge)
        #expect(await store.token() == "token-1")
        #expect(await store.deviceID() == "device-1")
    }

    @Test func aForeignLinkIsRefusedBeforeAnyPairing() async throws {
        let pairing = RecordingPairing()
        let flow = SignIn(pairing: pairing, store: MemorySessionStore(), deviceName: "x")
        let started = flow.start(base: base)
        await #expect(throws: SignInError.notOurLink) {
            try await flow.finish(started, link: #require(URL(string: "https://evil.example/app/signed-in?code=c")))
        }
        #expect(await pairing.sent == nil)
    }

    @Test func signingOutForgetsTheToken() async {
        let store = MemorySessionStore()
        await store.save(token: "t", deviceID: "d")
        await store.clear()
        #expect(await store.token() == nil)
    }
}

actor RecordingPairing: DevicePairing {
    private(set) var sent: PairInput?

    func pair(_ input: PairInput) async throws -> PairedDevice {
        sent = input
        return PairedDevice(token: "token-1", deviceID: "device-1")
    }
}
