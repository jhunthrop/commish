import CommishAPI
import CommishDesign
import Foundation
import Observation

/// The setup's choices (web/src/lib/room/setup/setup.ts): the scoring presets, the team counts and the
/// lineups, each with its chip's words.
public enum MockSetup {
    public static let scoring: [(preset: Components.Schemas.ScoringPresetKnown, label: String)] = [
        (.ppr, Words.MockSetup.ppr), (.halfPpr, Words.MockSetup.half_ppr), (.standard, Words.MockSetup.standard),
        (.tePremium, Words.MockSetup.te_premium),
    ]
    public static let teams = [8, 10, 12, 14]
    public static let lineups: [(lineup: Components.Schemas.LineupKnown, label: String)] = [
        (.standard, Words.MockSetup.lineupStandard), (.superflex, Words.MockSetup.superflex),
        (.twoFlex, Words.MockSetup.twoFlex),
    ]

    /// setup.ts defaultSettings: PPR, twelve teams, a random slot, the standard roster and lineup, no
    /// keepers, bots by ADP.
    public static func defaults() -> RoomSettings {
        RoomSettings(
            scoring: .init(preset: .init(value1: .init(value1: .ppr)), custom: nil),
            teams: 12,
            slot: nil,
            roster: .init(qb: 1, rb: 2, wr: 2, te: 1, k: 1, dst: 1, bench: 6),
            lineup: .init(value1: .standard),
            keepers: [],
            botStyle: .init(value1: .adp)
        )
    }
}

/// The setup page (web/src/routes/mock/new at 390) for a mock against bots: the clocks, the scoring,
/// the teams, your slot and the lineup, and the one verb that starts it. The API, injected; a start
/// answers the new room's id, which the screen opens.
@MainActor
@Observable
public final class MockSetupViewModel {
    public private(set) var settings: RoomSettings
    public private(set) var busy = false
    /// A start that did not go: the API's sentence, or the app's for no connection.
    public private(set) var problem: String?

    private let api: any MockAPI
    private let onSignedOut: @MainActor () -> Void

    /// `from` is a draft's settings to start again from (the report's Try another slot), its slot let go.
    public init(api: any MockAPI, from: RoomSettings? = nil, onSignedOut: @escaping @MainActor () -> Void = {}) {
        self.api = api
        self.onSignedOut = onSignedOut
        var start = from ?? MockSetup.defaults()
        start.slot = nil
        settings = start
    }

    public var cells: [MockCell] {
        MockWords.setupCells()
    }

    public var preset: Components.Schemas.ScoringPresetKnown? {
        settings.scoring.preset?.value1.value1
    }

    public var lineup: Components.Schemas.LineupKnown? {
        settings.lineup.value1
    }

    /// The slots to choose from: one per team, then Random (nil).
    public var slots: [Int?] {
        (1 ... settings.teams).map { Optional($0) } + [nil]
    }

    public func choose(preset: Components.Schemas.ScoringPresetKnown) {
        settings.scoring = .init(preset: .init(value1: .init(value1: preset)), custom: nil)
    }

    /// setup.ts setTeams: a slot past the new count goes back to Random.
    public func choose(teams: Int) {
        settings.teams = teams
        if let slot = settings.slot, slot > teams {
            settings.slot = nil
        }
    }

    public func choose(slot: Int?) {
        settings.slot = slot
    }

    public func choose(lineup: Components.Schemas.LineupKnown) {
        settings.lineup = .init(value1: lineup)
    }

    /// Start against bots: the new room's id, nil when it did not start (the problem says why).
    public func start() async -> String? {
        guard !busy else {
            return nil
        }
        busy = true
        problem = nil
        defer { busy = false }
        do {
            let room = try await api.createMock(MockCreate(leagueId: nil, settings: .init(value1: settings), seed: nil))
            return room.id
        } catch where APIError.signsOut(error) {
            onSignedOut()
        } catch {
            problem = MockRoomViewModel.sentence(for: error)
        }
        return nil
    }
}
