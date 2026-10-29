import CommishAPI
import CommishDesign
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

    /// The phone's five: signed in, by the shown league's phase as the web's bar, or with no league (or
    /// a phase this build does not know) the bar for the site's season (PhoneRail.bar); signed out, the
    /// web's public five with the League tab as the sign-in (B155, as Android); none while restoring.
    public var tabs: [RailTab] {
        switch state {
        case .restoring:
            []
        case .signedOut:
            PhoneRail.withoutLeague
        case let .signedIn(league):
            PhoneRail.bar(league: league, season: sitePhase)
        }
    }

    /// Which account the shell shows, bumped as the phone signs in and as it signs out (never on a read
    /// of the same account), so the shell rebuilds every tab per account and no screen's state (a mock
    /// setup's saved league) passes from one member to the next on a shared phone.
    public private(set) var generation = 0

    /// The one line the sign-in screen says after the account was deleted on this phone ("Your account is
    /// deleted"); nil otherwise, and gone at the next sign-in or launch.
    public private(set) var notice: String?

    /// Whether the phone is signed in (with or without a league followed).
    public var isSignedIn: Bool {
        if case .signedIn = state {
            return true
        }
        return false
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
    /// The phone's last choice until the site takes it (its PUT lands) or a fresh GET /me agrees, so a
    /// read in between never takes it back (B156, Android's Lane 179 M2).
    @ObservationIgnored private var pending: String?
    /// How many choices the member has made, so a read can tell one was made while it was in flight.
    @ObservationIgnored private var choicesMade = 0

    private let account: any AccountAPI
    private let store: any SessionStore
    private let cache: any AnswerCache
    private let clock: any Clock
    private let zone: TimeZone
    private let defaults: UserDefaults
    /// What signing out does first, while the phone still holds its token: push takes its token off.
    private let signingOut: @MainActor () async -> Void

    public init(
        account: any AccountAPI, store: any SessionStore, cache: any AnswerCache, clock: any Clock = SystemClock(),
        zone: TimeZone = .current, defaults: UserDefaults = .standard,
        signingOut: @escaping @MainActor () async -> Void = {}
    ) {
        self.signingOut = signingOut
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
        let asked = choicesMade
        do {
            let read = try await account.account()
            await cache.write(read, route: Self.accountRoute, stamp: clock.now)
            context = read
            choices = [held(read, chosenDuringRead: choicesMade != asked), read.selected, lastLeague]
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
        if !isSignedIn {
            generation += 1
        }
        notice = nil
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
        pending = id
        choicesMade += 1
        selectionWrite = Task { [account] in
            do {
                // Taken by the site: the choice no longer needs holding against its reads.
                if try await account.selectLeague(id: id), pending == id {
                    pending = nil
                }
            } catch where APIError.signsOut(error) {
                await expire()
            } catch {
                // Not taken by the site: the phone keeps the choice, the web keeps its own.
            }
        }
    }

    /// Takes this phone's push token off and unpairs it on the API, then forgets its token and its saved
    /// answers whatever the API said: a sign-out on the phone always signs out.
    public func signOut() async {
        await signingOut()
        if let device = await store.deviceID() {
            try? await account.revokeDevice(id: device)
        }
        await expire()
    }

    /// The account was deleted (POST /me/delete answered 204): the phone forgets its token and the saved
    /// answers as a sign-out does, with nothing to revoke (the API deleted every device) and no sign-in
    /// provider's logout (the API deleted the user), and the sign-in screen says so until the next sign-in.
    /// The line is held in memory only, so it does not outlast this launch.
    public func deleted() async {
        await expire()
        notice = Words.DeleteAccount.doneTitle
    }

    /// The API refused the token (a signed-in read answered 401): forget it and the saved answers, and
    /// show sign-in. Nothing to revoke: the API already holds the token as dead.
    public func expire() async {
        await store.clear()
        await cache.clear()
        lastLeague = nil
        pending = nil
        leagues = []
        sitePhase = nil
        format = nil
        features = []
        if isSignedIn {
            generation += 1
        }
        state = .signedOut
    }

    /// The phone's choice a fresh read must not take back: one the site has not taken yet (its PUT
    /// failed or is on its way) until the site's selection agrees, or one made while this read was in
    /// flight, whose answer predates it. Nil when the site's selection leads.
    private func held(_ read: AccountContext, chosenDuringRead: Bool) -> String? {
        if read.selected != nil, read.selected == pending {
            pending = nil
        }
        return pending ?? (chosenDuringRead ? selected?.id : nil)
    }

    /// The league last shown, so a phone with no signal (or a site with no selection) shows it again.
    private var lastLeague: String? {
        get { defaults.string(forKey: Self.lastLeagueKey) }
        set { defaults.set(newValue, forKey: Self.lastLeagueKey) }
    }

    private static let lastLeagueKey = "app.trycommish.lastLeague"
}
