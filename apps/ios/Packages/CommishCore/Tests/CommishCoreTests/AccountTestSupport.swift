import CommishAPI
@testable import CommishCore
import Foundation

/// The Account routes as the fixture answers them, each write recorded, and the failures a test asks
/// for.
actor StubAccountScreen: AccountScreenAPI {
    private var account: AccountAnswer
    private let leagues: [AttachedLeague]
    private let paired: [PairedDeviceRow]
    private var readError: (any Error)?
    private var writeError: (any Error)?
    private var leaguesFail = false
    private var freeSeason: Bool?
    private(set) var revoked: [String] = []
    private(set) var detached: [String] = []
    private(set) var restored: [String] = []
    /// Each email a delete was sent with.
    private(set) var deletions: [String] = []
    private var deleteError: (any Error)?
    private var deleteGate: Gate?

    init(account: AccountAnswer, leagues: [AttachedLeague], paired: [PairedDeviceRow]) {
        self.account = account
        self.leagues = leagues
        self.paired = paired
    }

    static func fixture() throws -> StubAccountScreen {
        let answers = try AccountParityTests.answers()
        return StubAccountScreen(account: answers.me, leagues: answers.attached, paired: answers.devices)
    }

    func refuseEveryRead() {
        readError = APIError.status(401)
    }

    func failEveryRead(with error: any Error) {
        readError = error
    }

    func failWrites(with error: any Error) {
        writeError = error
    }

    func failLeagues() {
        leaguesFail = true
    }

    func answerFreeSeason(_ flag: Bool?) {
        freeSeason = flag
    }

    func freeSeasonFlag() async throws -> Bool? {
        freeSeason
    }

    func me() async throws -> AccountAnswer {
        if let readError {
            throw readError
        }
        return account
    }

    func attached() async throws -> [AttachedLeague] {
        if let readError {
            throw readError
        }
        if leaguesFail {
            throw APIError.status(500)
        }
        return leagues
    }

    func devices() async throws -> [PairedDeviceRow] {
        if let readError {
            throw readError
        }
        return paired
    }

    func detach(id: String) async throws {
        if let writeError {
            throw writeError
        }
        detached.append(id)
    }

    func restore(id: String) async throws {
        if let writeError {
            throw writeError
        }
        restored.append(id)
    }

    func refuseDelete(with error: any Error) {
        deleteError = error
    }

    /// Holds each delete until the test opens it, the call under way.
    func holdDeletes(on gate: Gate) {
        deleteGate = gate
    }

    func deleteAccount(email: String) async throws {
        deletions.append(email)
        await deleteGate?.wait()
        if let deleteError {
            throw deleteError
        }
    }

    func revokeDevice(id: String) async throws {
        if let writeError {
            throw writeError
        }
        revoked.append(id)
    }

    /// Each push settings change written, in order.
    private(set) var notificationChanges: [NotificationSettingsChange] = []

    /// The account with the change applied over its settings (the standard ones when it has none), as
    /// PATCH /me answers.
    func updateNotifications(_ change: NotificationSettingsChange) async throws -> AccountAnswer {
        if let writeError {
            throw writeError
        }
        notificationChanges.append(change)
        let held = account.notifications?.value1
        let kinds = change.kinds
        var written = account
        written.notifications = .init(value1: NotificationSettingsAnswer(
            timeZone: change.timeZone ?? held?.timeZone ?? "America/New_York",
            quietStart: change.quietStart ?? held?.quietStart ?? "23:00",
            quietEnd: change.quietEnd ?? held?.quietEnd ?? "08:00",
            kinds: .init(
                starterStatus: kinds?.starterStatus ?? held?.kinds.starterStatus ?? true,
                weekReads: kinds?.weekReads ?? held?.kinds.weekReads ?? true,
                waiverClaims: kinds?.waiverClaims ?? held?.kinds.waiverClaims ?? true
            )
        ))
        account = written
        return written
    }
}

/// GET /me whose leagues a test changes, as the API answers after a detach.
actor MutableAccount: AccountAPI {
    private var leagues: [FollowedLeague]

    init(leagues: [FollowedLeague]) {
        self.leagues = leagues
    }

    func set(leagues: [FollowedLeague]) {
        self.leagues = leagues
    }

    func account() async throws -> AccountContext {
        AccountContext(leagues: leagues, selected: nil, season: .inSeason)
    }

    func selectLeague(id _: String) async throws -> Bool {
        true
    }

    func revokeDevice(id _: String) async throws {}
}

/// A wait the test opens.
actor Gate {
    private var opened = false
    private var waiting: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        if opened {
            return
        }
        await withCheckedContinuation { waiting.append($0) }
    }

    func open() {
        opened = true
        waiting.forEach { $0.resume() }
        waiting = []
    }
}

/// GET /me and PUT /me/league with the waits a test opens: the PUT held until `put` opens (taken, the
/// site's selection becomes the choice, unless the test says the site does not take it), and a GET
/// /me held on a gate the test hands it, answering the selection as it stood when the read arrived.
actor PendingAccount: AccountAPI {
    private let leagues: [FollowedLeague]
    private var selected: String?
    private let takes: Bool
    private var readGate: Gate?
    let put = Gate()
    /// Opens once a held read has arrived.
    let reading = Gate()

    init(leagues: [String], selected: String?, takes: Bool = true) {
        self.leagues = leagues.map { AppSessionTests.followed($0) }
        self.selected = selected
        self.takes = takes
    }

    func select(_ id: String) {
        selected = id
    }

    func hold(_ gate: Gate) {
        readGate = gate
    }

    func account() async throws -> AccountContext {
        let answer = AccountContext(leagues: leagues, selected: selected, season: .inSeason)
        if let gate = readGate {
            readGate = nil
            await reading.open()
            await gate.wait()
        }
        return answer
    }

    func selectLeague(id: String) async throws -> Bool {
        await put.wait()
        if takes {
            selected = id
        }
        return takes
    }

    func revokeDevice(id _: String) async throws {}
}
