import CommishAPI
import CommishCore
import Foundation

/// What the app is built against and the services it holds, made once at launch and handed down: the
/// API's base URL from the build setting, the Keychain session, the answer cache, the system clock and
/// this phone's push registration.
struct AppEnvironment {
    /// The Info.plist key the build writes API_BASE_URL into.
    static let baseURLKey = "CommishAPIBaseURL"
    /// The launch argument a development build reads for the companion's replay.
    static let replayArgument = "CommishCompanionReplay"
    /// The Keychain item a push removal left from a sign out is kept in (Lane 288 security M1).
    static let pendingRemovalService = "app.trycommish.ios.push-pending"

    let baseURL: URL
    let session: any SessionStore
    let cache: any AnswerCache
    let clock: any Clock
    /// This phone's push: its token on its own device, the Account's switches behind it.
    let push: PushRegistrar
    /// A development build launched with `-CommishCompanionReplay YES` follows the API's recorded draft
    /// from the companion's start page (the web's /companion/new?replay=1, COMPANION_REPLAY on a
    /// development API). The site's `?replay=1` link asks the same in any build, as the web reads it;
    /// a production API refuses a replay with its own sentence.
    var companionReplay = false
    /// The order the in-season screens share (Lane 224): one read at a time for the Board, the clubs and
    /// Compare opened together.
    let orderMemo = OrderMemo()

    /// The API's base URL from the bundle, failing fast on a build that does not carry one.
    static func baseURL(in info: [String: Any]) -> URL? {
        (info[baseURLKey] as? String).flatMap(URL.init(string:)).flatMap { $0.scheme == nil ? nil : $0 }
    }

    @MainActor
    static func live(bundle: Bundle = .main) -> AppEnvironment {
        guard let url = baseURL(in: bundle.infoDictionary ?? [:]) else {
            preconditionFailure("The build carries no \(baseURLKey): set API_BASE_URL in project.yml.")
        }
        #if DEBUG
            let replay = UserDefaults.standard.bool(forKey: replayArgument)
        #else
            let replay = false
        #endif
        let session = KeychainSessionStore()
        // A removal a sign out without signal could not finish, with the signed-out device's own token.
        let pending = KeychainSessionStore(service: pendingRemovalService)
        let push = PushRegistrar(
            api: APIClient(baseURL: url, tokens: session), platform: SystemPush(), session: session,
            pending: PendingRemoval(store: pending, api: APIClient(baseURL: url, tokens: pending))
        )
        return AppEnvironment(
            baseURL: url,
            session: session,
            cache: FileCache.standard(),
            clock: SystemClock(),
            push: push,
            companionReplay: replay
        )
    }

    var api: APIClient {
        APIClient(baseURL: baseURL, tokens: session)
    }

    /// The in-season screens' read of our order at their clock, the Rankings' own read.
    var orders: OrderReader {
        OrderReader(api: api, clock: clock, memo: orderMemo)
    }

    var pairing: PairingClient {
        PairingClient(baseURL: baseURL, tokens: session)
    }
}
