import CommishAPI
import Foundation
import Observation

/// Whether the phone is signed in and which league it opens: the first the account follows, until
/// the Leagues screen lets the member choose (spec §3).
@MainActor
@Observable
public final class AppSession {
    public enum State: Equatable, Sendable {
        case restoring
        case signedOut
        /// Signed in; nil while the account follows no league.
        case signedIn(leagueID: String?)
    }

    public private(set) var state: State = .restoring

    private let account: any AccountAPI
    private let store: any SessionStore
    private let cache: any AnswerCache
    private let defaults: UserDefaults

    public init(
        account: any AccountAPI, store: any SessionStore, cache: any AnswerCache, defaults: UserDefaults = .standard
    ) {
        self.account = account
        self.store = store
        self.cache = cache
        self.defaults = defaults
    }

    /// Reads the saved token and, with one, the followed leagues. A refused token signs the phone out;
    /// no signal keeps it signed in on the saved home.
    public func restore() async {
        guard await store.token() != nil else {
            state = .signedOut
            return
        }
        do {
            state = try await .signedIn(leagueID: account.attachedLeagueIDs().first)
        } catch APIError.status(401), APIError.envelope(code: "unauthorized", _) {
            await forget()
        } catch {
            state = .signedIn(leagueID: lastLeague)
        }
        if case let .signedIn(leagueID?) = state {
            lastLeague = leagueID
        }
    }

    /// Unpairs this phone on the API, then forgets its token and its saved answers whatever the API
    /// said: a sign-out on the phone always signs out.
    public func signOut() async {
        if let device = await store.deviceID() {
            try? await account.revokeDevice(id: device)
        }
        await forget()
    }

    private func forget() async {
        await store.clear()
        await cache.clear()
        lastLeague = nil
        state = .signedOut
    }

    /// The league last opened, so a phone with no signal opens it again on its saved home.
    private var lastLeague: String? {
        get { defaults.string(forKey: Self.lastLeagueKey) }
        set { defaults.set(newValue, forKey: Self.lastLeagueKey) }
    }

    private static let lastLeagueKey = "app.trycommish.lastLeague"
}
