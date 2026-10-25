import CommishAPI
@testable import CommishCore
import Foundation

/// The Account routes as the fixture answers them, each write recorded, and the failures a test asks
/// for.
actor StubAccountScreen: AccountScreenAPI {
    private let account: AccountAnswer
    private let leagues: [AttachedLeague]
    private let paired: [PairedDeviceRow]
    private var readError: (any Error)?
    private var writeError: (any Error)?
    private var leaguesFail = false
    private var freeSeason: Bool?
    private(set) var revoked: [String] = []
    private(set) var detached: [String] = []
    private(set) var restored: [String] = []

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

    func revokeDevice(id: String) async throws {
        if let writeError {
            throw writeError
        }
        revoked.append(id)
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

    func selectLeague(id _: String) async throws {}

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
