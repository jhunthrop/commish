import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// The sign-in against a running API, off unless asked: `COMMISH_LIVE_API` (the API's base URL),
/// `COMMISH_LIVE_VERIFIER` and `COMMISH_LIVE_CODE` (a pairing code bound to that verifier's challenge,
/// as the API's callback mints one). Never production: a lane's own API on its own database.
struct LiveSignInTests {
    private static let environment = ProcessInfo.processInfo.environment
    private static let live = environment["COMMISH_LIVE_API"] != nil

    /// Follows no redirect, so the login's 302 is read as it is answered.
    private final class Stay: NSObject, URLSessionTaskDelegate {
        func urlSession(
            _: URLSession, task _: URLSessionTask, willPerformHTTPRedirection _: HTTPURLResponse,
            newRequest _: URLRequest
        ) async -> URLRequest? {
            nil
        }
    }

    @Test(.enabled(if: live))
    func theAppSignsInPairsAndReadsWithTheDeviceToken() async throws {
        let base = try #require(Self.environment["COMMISH_LIVE_API"].flatMap(URL.init(string:)))
        let verifier = try #require(Self.environment["COMMISH_LIVE_VERIFIER"])
        let code = try #require(Self.environment["COMMISH_LIVE_CODE"])
        let challenge = PKCE.challenge(for: verifier)
        let started = SignIn.Started(
            url: SignInRoute.login(base: base, challenge: challenge), verifier: verifier, challenge: challenge
        )

        // The login the sheet opens: the API sends the browser on to AuthKit.
        let (_, login) = try await URLSession.shared.data(for: URLRequest(url: started.url), delegate: Stay())
        let answer = try #require(login as? HTTPURLResponse)
        #expect(answer.statusCode == 302)
        #expect(answer.value(forHTTPHeaderField: "Location")?.contains("/user_management/authorize") == true)

        // The return link the callback sends to the app, then the pairing with the verifier.
        var link = try #require(URLComponents(url: SignInRoute.returnTo, resolvingAgainstBaseURL: false))
        link.queryItems = [URLQueryItem(name: "code", value: code), URLQueryItem(name: "client", value: "ios")]
        let store = MemorySessionStore()
        let flow = SignIn(
            pairing: PairingClient(baseURL: base, tokens: store),
            store: store,
            deviceName: "Lane 173 test"
        )
        try await flow.finish(started, link: #require(link.url))
        #expect(await store.token() != nil)

        // The token opens a signed-in read: the account's leagues.
        let client = Transport.client(baseURL: base, tokens: store)
        let leagues = try await client.listAttached()
        guard case .ok = leagues else {
            Issue.record("Expected 200 from /leagues/attached, got \(leagues)")
            return
        }
    }
}
