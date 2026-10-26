import CommishAPI
import Foundation
import Observation

/// Whether the phone is signed in, the leagues it follows and which one it shows: the site's selection
/// from GET /me (chosen on the web or in the app), else the one last shown on this phone, else the
/// newest followed. With none followed, the site's season, which sets the bar as the web's (spec §3).
/// A choice in the switch shows at once and is written to the site (PUT /me/league), so the web opens
/// on it too.
@MainActor
@Observable
public final class AppSession {
    public enum State: Equatable, Sendable {
        case restoring
        case signedOut
        /// Signed in; nil while the account follows no league.
        case signedIn(league: FollowedLeague?)
    }

    public private(set) var state: State = .restoring
    /// Every followed league, newest first, as GET /me last listed them.
    public private(set) var leagues: [FollowedLeague] = []
    /// The site's season; nil unread or a phase this build does not know.
    public private(set) var sitePhase: SitePhase?
    /// The context's format with no league selected (Account.format), the board a mock starts in.
    public private(set) var format: Components.Schemas.BoardFormatKnown?
    /// The account's features (Account.features).
    public private(set) var features: [String] = []

    /// The phone's five for the league shown: by its phase as the web's bar, or with no league the
    /// bar for the site's season (PhoneRail).
    public var tabs: [RailTab] {
        guard case let .signedIn(league) = state else {
            return []
        }
        return league.map { PhoneRail.tabs(phase: $0.phase, waiversOpen: $0.waiversOpen) }
            ?? PhoneRail.withoutLeague(season: sitePhase)
    }

    /// The top bar's league switch at this moment.
    public var leagueSwitch: LeagueSwitchModel {
        LeagueSwitchModel(leagues: leagues, selected: selected?.id, now: clock.now, zone: zone)
    }

    private var selected: FollowedLeague? {
        guard case let .signedIn(league) = state else {
            return nil
        }
        return league
    }

    /// The last choice's write to the site, kept so a test can await it; the app never waits on it.
    @ObservationIgnored private(set) var selectionWrite: Task<Void, Never>?

    private let account: any AccountAPI
    private let store: any SessionStore
    private let cache: any AnswerCache
    private let clock: any Clock
    private let zone: TimeZone
    private let defaults: UserDefaults

    public init(
        account: any AccountAPI, store: any SessionStore, cache: any AnswerCache, clock: any Clock = SystemClock(),
        zone: TimeZone = .current, defaults: UserDefaults = .standard
    ) {
        self.account = account
        self.store = store
        self.cache = cache
        self.clock = clock
        self.zone = zone
        self.defaults = defaults
    }

    /// The cache key of the account's context.
    static let accountRoute = "/me"

    /// Reads the saved token and, with one, the account: its leagues, the site's selection and season.
    /// A refused token signs the phone out; no signal keeps it signed in on the account last read.
    public func restore() async {
        guard await store.token() != nil else {
            state = .signedOut
            return
        }
        let context: AccountContext?
        // Read fresh, the site's selection leads (a choice made on the web shows here); from the saved
        // copy, this phone's last choice does, being newer than the copy.
        let choices: [String?]
        do {
            let read = try await account.account()
            await cache.write(read, route: Self.accountRoute, stamp: clock.now)
            context = read
            choices = [read.selected, lastLeague]
        } catch where APIError.signsOut(error) {
            await expire()
            return
        } catch {
            context = await cache.read(AccountContext.self, route: Self.accountRoute)?.value
            choices = [lastLeague, context?.selected]
        }
        leagues = context?.leagues ?? []
        sitePhase = context?.season
        format = context?.format
        features = context?.features ?? []
        let league = choices.compactMap { id in leagues.first { $0.id == id } }.first ?? leagues.first
        state = .signedIn(league: league)
        lastLeague = league?.id
    }

    /// The member chose a league in the switch: the app shows it at once and opens on it next time, and
    /// the site selects it too. The write never takes the choice back: a league the API no longer
    /// lists, an older API or no signal leave it as chosen; only a refused token signs out.
    public func choose(_ id: String) {
        guard case .signedIn = state, let league = leagues.first(where: { $0.id == id }) else {
            return
        }
        state = .signedIn(league: league)
        lastLeague = id
        selectionWrite = Task { [account] in
            do {
                try await account.selectLeague(id: id)
            } catch where APIError.signsOut(error) {
                await expire()
            } catch {
                // Not taken by the site: the phone keeps the choice, the web keeps its own.
            }
        }
    }

    /// Unpairs this phone on the API, then forgets its token and its saved answers whatever the API
    /// said: a sign-out on the phone always signs out.
    public func signOut() async {
        if let device = await store.deviceID() {
            try? await account.revokeDevice(id: device)
        }
        await expire()
    }

    /// The API refused the token (a signed-in read answered 401): forget it and the saved answers, and
    /// show sign-in. Nothing to revoke: the API already holds the token as dead.
    public func expire() async {
        await store.clear()
        await cache.clear()
        lastLeague = nil
        leagues = []
        sitePhase = nil
        state = .signedOut
    }

    /// The league last shown, so a phone with no signal (or a site with no selection) shows it again.
    private var lastLeague: String? {
        get { defaults.string(forKey: Self.lastLeagueKey) }
        set { defaults.set(newValue, forKey: Self.lastLeagueKey) }
    }

    private static let lastLeagueKey = "app.trycommish.lastLeague"
}
