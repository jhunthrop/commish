import CommishAPI
import CommishCore
import Foundation

/// What the app is built against and the services it holds, made once at launch and handed down: the
/// API's base URL from the build setting, the Keychain session, the answer cache, the system clock.
struct AppEnvironment {
    /// The Info.plist key the build writes API_BASE_URL into.
    static let baseURLKey = "CommishAPIBaseURL"

    let baseURL: URL
    let session: any SessionStore
    let cache: any AnswerCache
    let clock: any Clock

    /// The API's base URL from the bundle, failing fast on a build that does not carry one.
    static func baseURL(in info: [String: Any]) -> URL? {
        (info[baseURLKey] as? String).flatMap(URL.init(string:)).flatMap { $0.scheme == nil ? nil : $0 }
    }

    static func live(bundle: Bundle = .main) -> AppEnvironment {
        guard let url = baseURL(in: bundle.infoDictionary ?? [:]) else {
            preconditionFailure("The build carries no \(baseURLKey): set API_BASE_URL in project.yml.")
        }
        return AppEnvironment(
            baseURL: url,
            session: KeychainSessionStore(),
            cache: FileCache.standard(),
            clock: SystemClock()
        )
    }

    var api: APIClient {
        APIClient(baseURL: baseURL, tokens: session)
    }

    var pairing: PairingClient {
        PairingClient(baseURL: baseURL, tokens: session)
    }
}
