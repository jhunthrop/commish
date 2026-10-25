import CommishAPI
import Foundation
import Observation

/// Whether the phone is signed in, the leagues it follows and which one it shows: the one last chosen
/// in the league switch, else the newest followed. With none followed, the site's season, which sets
/// the bar as the web's (spec §3).
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
    /// Every followed league, newest first, as the API last listed them.
    public private(set) var leagues: [FollowedLeague] = []
    /// The site's season, read only while no league is followed; nil unread.
    public private(set) var sitePhase: SitePhase?

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

    /// The cache key of the followed leagues.
    static let leaguesRoute = "/leagues/attached"

    /// Reads the saved token and, with one, the followed leagues. A refused token signs the phone out;
    /// no signal keeps it signed in on the leagues last read.
    public func restore() async {
        guard await store.token() != nil else {
            state = .signedOut
            return
        }
        do {
            leagues = try await account.followedLeagues()
            await cache.write(leagues, route: Self.leaguesRoute, stamp: clock.now)
        } catch where APIError.signsOut(error) {
            await expire()
            return
        } catch {
            leagues = await cache.read([FollowedLeague].self, route: Self.leaguesRoute)?.value ?? []
        }
        let league = leagues.first { $0.id == lastLeague } ?? leagues.first
        if league == nil {
            // The site's season sets the bar; unread, the season's bar.
            sitePhase = try? await account.siteSeason()
        }
        state = .signedIn(league: league)
        lastLeague = league?.id
    }

    /// The member chose a league in the switch: the app shows it, and opens on it next time.
    public func choose(_ id: String) {
        guard case .signedIn = state, let league = leagues.first(where: { $0.id == id }) else {
            return
        }
        state = .signedIn(league: league)
        lastLeague = id
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

    /// The league last shown, so the next open (and a phone with no signal) shows it again.
    private var lastLeague: String? {
        get { defaults.string(forKey: Self.lastLeagueKey) }
        set { defaults.set(newValue, forKey: Self.lastLeagueKey) }
    }

    private static let lastLeagueKey = "app.trycommish.lastLeague"
}
