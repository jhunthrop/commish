import CommishAPI
import CommishDesign
import Foundation
import Observation

/// Which part of the screen an action's failure is said beside.
public enum AccountSection: Sendable, Equatable {
    case leagues
    case devices
}

/// An action that did not go through: the API's own sentence, else the web's.
public struct AccountProblem: Equatable, Sendable {
    public let section: AccountSection
    public let text: String
}

/// The Account screen (web/src/lib/account/AccountPage.svelte): the account, the leagues followed with
/// detach and its undo (league/AccountLeagues.svelte), the paired devices with this phone marked and
/// unpair (hosts/AccountDevices.svelte), the plan in the free season, the push switches kept on this
/// phone until the account carries them, and sign out. The API, the cache, the clock, the switches'
/// store and the session's verbs are injected.
@MainActor
@Observable
public final class AccountViewModel {
    public enum State: Equatable, Sendable {
        case loading
        case loaded(AccountModel, stamp: Date, stale: Bool)
        case failed(String)
    }

    public private(set) var state: State = .loading
    public private(set) var push: PushSettings
    /// The row an action is under way on (a league's or a device's id).
    public private(set) var busy: String?
    public private(set) var problem: AccountProblem?
    /// The last detach's undo window, kept so a test can await it; the app never waits on it.
    public var undoWindow: Task<Void, Never>? {
        lastDetached.flatMap { undoWindows[$0] }
    }

    /// How long a detached league stays on the list with its undo (AccountLeagues.svelte UNDO_MS).
    public static let undoSeconds: Double = 10
    /// The cache key of the screen's answer.
    public static let route = "/account"

    private var answer: AccountScreenAnswer?
    private var stamp = Date.distantPast
    private var stale = false
    private var detached: Set<String> = []
    private var thisDevice: String?
    /// Each detached league's undo window by its id, cancelled by its restore.
    @ObservationIgnored private var undoWindows: [String: Task<Void, Never>] = [:]
    @ObservationIgnored private var lastDetached: String?

    private let api: any AccountScreenAPI
    private let cache: any AnswerCache
    private let clock: any Clock
    private let zone: TimeZone
    private let store: any PushStore
    private let deviceID: @Sendable () async -> String?
    private let signOutSession: @MainActor () async -> Void
    private let onSignedOut: @MainActor () -> Void
    private let accountDeleted: @MainActor () async -> Void
    private let leaguesChanged: @MainActor () -> Void
    private let wait: @Sendable (Double) async -> Void

    /// `signOut` is the session's (it revokes this phone and forgets it); `onSignedOut` runs when the API
    /// refuses the token or this phone was unpaired here; `deleted` is the session's once the account is
    /// deleted (it forgets this phone as a sign-out does, with nothing left to revoke); `leaguesChanged`
    /// after a detach or a restore, so the league switch reads the account again; `wait` sleeps for
    /// seconds, the undo's window.
    public init(
        api: any AccountScreenAPI, cache: any AnswerCache, clock: any Clock, zone: TimeZone, push: any PushStore,
        deviceID: @escaping @Sendable () async -> String?,
        signOut: @escaping @MainActor () async -> Void,
        onSignedOut: @escaping @MainActor () -> Void,
        deleted: @escaping @MainActor () async -> Void,
        leaguesChanged: @escaping @MainActor () -> Void = {},
        wait: @escaping @Sendable (Double) async -> Void = { try? await Task.sleep(for: .seconds($0)) }
    ) {
        self.api = api
        self.cache = cache
        self.clock = clock
        self.zone = zone
        store = push
        self.push = push.load()
        self.deviceID = deviceID
        signOutSession = signOut
        self.onSignedOut = onSignedOut
        accountDeleted = deleted
        self.leaguesChanged = leaguesChanged
        self.wait = wait
    }

    /// The confirmation sheet for the account shown: its email to type, the delete through this screen's
    /// API, and the session's hooks. Nil until an account has been read.
    public func deletion() -> DeleteAccountViewModel? {
        guard let email = answer?.me.email else {
            return nil
        }
        return DeleteAccountViewModel(
            email: email, api: api, deleted: accountDeleted, onSignedOut: onSignedOut
        )
    }

    /// "Last read Sat 12:00 pm" while the account shown is a saved one.
    public var stampWords: String? {
        guard case let .loaded(_, stamp, true) = state else {
            return nil
        }
        return AppWords.lastRead(stamp, zone: zone)
    }

    /// The saved account at once on the first open, then the API's. A failed read keeps what is shown,
    /// dated; with nothing shown, a sentence. A refused token signs out.
    public func load() async {
        thisDevice = await deviceID()
        if answer == nil, let saved = await cache.read(AccountScreenAnswer.self, route: Self.route) {
            show(saved.value, stamp: saved.stamp, stale: true)
        }
        do {
            let read = try await readAll()
            let now = clock.now
            await cache.write(read, route: Self.route, stamp: now)
            show(read, stamp: now, stale: false)
        } catch where APIError.signsOut(error) {
            state = .failed(AppWords.Failure.signedOut)
            onSignedOut()
        } catch {
            if answer != nil {
                show(answer, stamp: stamp, stale: true)
            } else {
                state = .failed(LeagueHomeViewModel.sentence(for: error))
            }
        }
    }

    /// The account must read; the leagues may fail (the web's sentence says so), the devices then list
    /// none, as the web's list does, and a failed plans read leaves the free season to the clock rule.
    private func readAll() async throws -> AccountScreenAnswer {
        async let leagues = try? api.attached()
        async let devices = try? api.devices()
        async let flag = try? api.freeSeasonFlag()
        let me = try await api.me()
        return await AccountScreenAnswer(
            me: me, leagues: leagues, devices: devices ?? [], freeSeason: flag.flatMap(\.self)
        )
    }

    /// Stops following a league: its row stays with its undo for the web's ten seconds, then leaves.
    /// The league switch hears of it only then (or when the member leaves the Account first): a re-pick
    /// of the shown league can change the bar, and the bar's change would take this screen and its Undo
    /// with it (review M2).
    public func detach(_ id: String) async {
        await act(id, .leagues) { [api] in try await api.detach(id: id) }
        guard problem == nil else {
            return
        }
        detached.insert(id)
        redraw()
        lastDetached = id
        undoWindows[id] = Task { [wait] in
            await wait(Self.undoSeconds)
            guard !Task.isCancelled else {
                return
            }
            self.drop(id)
            self.leaguesChanged()
        }
    }

    /// Takes a detach back within its window: the league is followed again with the seat it had, and
    /// the switch, never told of the detach, has nothing to hear.
    public func restore(_ id: String) async {
        await act(id, .leagues) { [api] in try await api.restore(id: id) }
        guard problem == nil else {
            return
        }
        undoWindows.removeValue(forKey: id)?.cancel()
        detached.remove(id)
        redraw()
    }

    /// The member left the Account: each detach still in its undo window is final now, its row leaves
    /// and the switch hears of it once.
    public func leave() {
        let pending = detached
        guard !pending.isEmpty else {
            return
        }
        for id in pending {
            undoWindows[id]?.cancel()
            drop(id)
        }
        leaguesChanged()
    }

    /// Unpairs a device and takes it off the list. This phone's row says Sign out and signs out through
    /// the session, which revokes it (review L1).
    public func unpair(_ id: String) async {
        if id == thisDevice {
            await signOut()
            return
        }
        await act(id, .devices) { [api] in try await api.revokeDevice(id: id) }
        guard problem == nil else {
            return
        }
        answer = answer?.without(device: id)
        redraw()
        if let answer {
            await cache.write(answer, route: Self.route, stamp: stamp)
        }
    }

    /// Signs this phone out: the session revokes it and returns to sign-in.
    public func signOut() async {
        busy = Words.Account.signOut
        await signOutSession()
        busy = nil
    }

    public func set(_ kind: PushKind, isOn: Bool) {
        save(push.with(kind, isOn: isOn))
    }

    public func setQuiet(from: Int, to: Int) {
        save(push.with(quietFrom: from, quietTo: to))
    }

    private func save(_ settings: PushSettings) {
        push = settings
        store.save(settings)
    }

    private func act(_ id: String, _ section: AccountSection, _ step: @Sendable () async throws -> Void) async {
        busy = id
        problem = nil
        defer { busy = nil }
        do {
            try await step()
        } catch where APIError.signsOut(error) {
            problem = AccountProblem(section: section, text: AppWords.Failure.signedOut)
            onSignedOut()
        } catch let APIError.envelope(_, message) where !message.isEmpty {
            problem = AccountProblem(section: section, text: message)
        } catch {
            problem = AccountProblem(section: section, text: Words.Account.failed)
        }
    }

    private func drop(_ id: String) {
        guard detached.contains(id) else {
            return
        }
        detached.remove(id)
        undoWindows.removeValue(forKey: id)
        answer = answer?.without(league: id)
        redraw()
        if let answer {
            let saved = (answer, stamp)
            Task { await cache.write(saved.0, route: Self.route, stamp: saved.1) }
        }
    }

    private func show(_ read: AccountScreenAnswer?, stamp: Date, stale: Bool) {
        answer = read
        self.stamp = stamp
        self.stale = stale
        redraw()
    }

    private func redraw() {
        guard let answer else {
            return
        }
        let model = AccountModel(
            answer: answer, detached: detached, thisDevice: thisDevice, now: clock.now, zone: zone
        )
        state = .loaded(model, stamp: stamp, stale: stale)
    }
}
