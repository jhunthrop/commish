import CommishAPI
import CommishCore
import Foundation

/// What the app is built against and the services it holds, made once at launch and handed down: the
/// API's base URL from the build setting, the Keychain session, the answer cache, the system clock.
struct AppEnvironment {
    /// The Info.plist key the build writes API_BASE_URL into.
    static let baseURLKey = "CommishAPIBaseURL"
    /// The launch argument a development build reads for the companion's replay.
    static let replayArgument = "CommishCompanionReplay"

    let baseURL: URL
    let session: any SessionStore
    let cache: any AnswerCache
    let clock: any Clock
    /// A development build launched with `-CommishCompanionReplay YES` follows the API's recorded draft
    /// from the companion's start page (the web's /companion/new?replay=1, COMPANION_REPLAY on a
    /// development API); a release build never does.
    var companionReplay = false

    /// The API's base URL from the bundle, failing fast on a build that does not carry one.
    static func baseURL(in info: [String: Any]) -> URL? {
        (info[baseURLKey] as? String).flatMap(URL.init(string:)).flatMap { $0.scheme == nil ? nil : $0 }
    }

    static func live(bundle: Bundle = .main) -> AppEnvironment {
        guard let url = baseURL(in: bundle.infoDictionary ?? [:]) else {
            preconditionFailure("The build carries no \(baseURLKey): set API_BASE_URL in project.yml.")
        }
        #if DEBUG
            let replay = UserDefaults.standard.bool(forKey: replayArgument)
        #else
            let replay = false
        #endif
        return AppEnvironment(
            baseURL: url,
            session: KeychainSessionStore(),
            cache: FileCache.standard(),
            clock: SystemClock(),
            companionReplay: replay
        )
    }

    var api: APIClient {
        APIClient(baseURL: baseURL, tokens: session)
    }

    var pairing: PairingClient {
        PairingClient(baseURL: baseURL, tokens: session)
    }
}
