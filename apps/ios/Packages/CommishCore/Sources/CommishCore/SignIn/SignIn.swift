import CommishAPI
import CryptoKit
import Foundation
import Security

/// PKCE (RFC 7636): the app makes a verifier, sends its S256 challenge on `/auth/login`, holds the
/// verifier in memory for the one flow and sends it on `/devices/pair`, so a pairing code caught on its
/// way back to the phone opens nothing without it.
public enum PKCE {
    /// 32 bytes from the system's secure random source as base64url: 43 characters.
    public static func verifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        precondition(status == errSecSuccess, "The system's secure random source failed: \(status)")
        return base64URL(Data(bytes))
    }

    public static func challenge(for verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// The two ends of sign-in: the API's login, opened in the system browser sheet, and the app link it
/// returns to with the pairing code (plan Task B).
public enum SignInRoute {
    public static let client = "ios"
    /// The app link the API redirects to: the web serves the association file that hands it to the app.
    public static let returnTo = URL(string: "https://trycommish.app/app/signed-in")!

    public static func login(base: URL, challenge: String) -> URL {
        var parts = URLComponents(url: base.appendingPathComponent("auth/login"), resolvingAgainstBaseURL: false)!
        parts.queryItems = [
            URLQueryItem(name: "client", value: client),
            URLQueryItem(name: "return_to", value: returnTo.absoluteString),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
        ]
        return parts.url!
    }

    /// The pairing code from our return link for this client, nil for any other link.
    public static func code(from link: URL) -> String? {
        guard let parts = URLComponents(url: link, resolvingAgainstBaseURL: false),
              parts.scheme == returnTo.scheme, parts.host == returnTo.host, parts.path == returnTo.path
        else {
            return nil
        }
        let items = parts.queryItems ?? []
        guard items.first(where: { $0.name == "client" })?.value == client,
              let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty
        else {
            return nil
        }
        return code
    }
}

public enum SignInError: Error, Equatable {
    /// The link the sheet came back with is not our return.
    case notOurLink
}

/// One sign-in: started with a fresh verifier, finished with the return link, ending with the device
/// token in the session store.
public struct SignIn: Sendable {
    /// A flow under way: the verifier stays here, in memory, and nowhere else.
    public struct Started: Sendable, Equatable {
        public let url: URL
        public let verifier: String
        public let challenge: String
    }

    private let pairing: any DevicePairing
    private let store: any SessionStore
    private let deviceName: String

    public init(pairing: any DevicePairing, store: any SessionStore, deviceName: String) {
        self.pairing = pairing
        self.store = store
        self.deviceName = deviceName
    }

    public func start(base: URL) -> Started {
        let verifier = PKCE.verifier()
        let challenge = PKCE.challenge(for: verifier)
        return Started(
            url: SignInRoute.login(base: base, challenge: challenge),
            verifier: verifier,
            challenge: challenge
        )
    }

    public func finish(_ started: Started, link: URL) async throws {
        guard let code = SignInRoute.code(from: link) else {
            throw SignInError.notOurLink
        }
        let paired = try await pairing.pair(
            PairInput(code: code, name: deviceName, kind: .ios, codeVerifier: started.verifier)
        )
        try await store.save(token: paired.token, deviceID: paired.deviceID)
    }
}
