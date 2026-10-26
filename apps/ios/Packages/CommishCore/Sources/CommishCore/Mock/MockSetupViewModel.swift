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

    /// setup.ts inFormat: the settings in the context's board format (its scoring, or a superflex
    /// lineup); any other format leaves them as they are.
    public static func inFormat(
        _ settings: RoomSettings,
        _ format: Components.Schemas.BoardFormatKnown?
    ) -> RoomSettings {
        var shaped = settings
        switch format {
        case .ppr: shaped.scoring = .init(preset: .init(value1: .init(value1: .ppr)), custom: nil)
        case .halfPpr: shaped.scoring = .init(preset: .init(value1: .init(value1: .halfPpr)), custom: nil)
        case .standard: shaped.scoring = .init(preset: .init(value1: .init(value1: .standard)), custom: nil)
        case .superflex: shaped.lineup = .init(value1: .superflex)
        default: break
        }
        return shaped
    }

    /// scoring.ts PPR_FROM and HALF_FROM: the reception points a league's own rules score PPR or half
    /// PPR from (api/internal/leaguesync/rules.go NearestPreset).
    static let pprFrom = 0.75
    static let halfFrom = 0.25

    /// scoring.ts nearestPreset: the preset a league's own rules score most like, by reception points,
    /// TE premium when a tight end's catch counts more.
    public static func nearestPreset(reception: Double, teBonus bonus: Double) -> Components.Schemas
        .ScoringPresetKnown {
        if reception >= pprFrom {
            return bonus > 0 ? .tePremium : .ppr
        }
        return reception >= halfFrom ? .halfPpr : .standard
    }

    /// scoring.ts rerunOf: a saved league as this account's mock drafts it, its own rules with
    /// custom_scoring, the nearest preset without; `exact` when the mock drafts the league's own rules.
    public static func rerun(_ settings: RoomSettings, exactRules: Bool) -> (settings: RoomSettings, exact: Bool) {
        guard !exactRules, let rules = settings.scoring.custom?.value1 else {
            return (settings, true)
        }
        let preset = nearestPreset(reception: rules.pointsPerReception, teBonus: rules.teReceptionBonus)
        var nearest = settings
        nearest.scoring = .init(preset: .init(value1: .init(value1: preset)), custom: nil)
        return (nearest, false)
    }
}

/// Where a setup starts from (the web's site context): the context's board format, the saved league the
/// link or the selected league names, and whether the account drafts a league's own rules.
public struct MockSetupSeed: Sendable, Equatable {
    public let format: Components.Schemas.BoardFormatKnown?
    public let league: String?
    public let exactRules: Bool

    public init(format: Components.Schemas.BoardFormatKnown? = nil, league: String? = nil, exactRules: Bool = false) {
        self.format = format
        self.league = league
        self.exactRules = exactRules
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

    /// The saved league the setup opened on, while the form holds its settings (a slot aside): the verb
    /// drafts that league. Any other change lets it go.
    public private(set) var opened: SavedLeague?

    private let api: any MockAPI
    private let seed: MockSetupSeed
    private let rerunning: Bool
    private let onSignedOut: @MainActor () -> Void
    private var openedExact = true

    /// `from` is a draft's settings to start again from (the report's Try another slot), its slot let go;
    /// without it the setup starts in the seed's format, and `load` opens the seed's saved league.
    public init(
        api: any MockAPI, from: RoomSettings? = nil, seed: MockSetupSeed = MockSetupSeed(),
        onSignedOut: @escaping @MainActor () -> Void = {}
    ) {
        self.api = api
        self.seed = seed
        self.onSignedOut = onSignedOut
        rerunning = from != nil
        var start = from ?? MockSetup.inFormat(MockSetup.defaults(), seed.format)
        start.slot = nil
        settings = start
    }

    /// The saved league the seed names, when the account has it: the form filled with its settings as
    /// this account's mock drafts them (the web's openLeague). A read that fails leaves the form as it is.
    public func load() async {
        guard !rerunning, let id = seed.league else {
            return
        }
        do {
            guard let league = try await api.leagues().first(where: { $0.id == id }) else {
                return
            }
            let rerun = MockSetup.rerun(league.settings, exactRules: seed.exactRules)
            settings = rerun.settings
            openedExact = rerun.exact
            opened = league
        } catch where APIError.signsOut(error) {
            onSignedOut()
        } catch {
            return
        }
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

    /// The scoring chips, by the preset's raw value.
    public var scoringChips: [BoardChip<String>] {
        MockSetup.scoring.map { BoardChip(label: $0.label, value: $0.preset.rawValue, pressed: $0.preset == preset) }
    }

    public var teamChips: [BoardChip<String>] {
        MockSetup.teams.map { BoardChip(label: String($0), value: String($0), pressed: $0 == settings.teams) }
    }

    /// The lineup chips, by the lineup's raw value.
    public var lineupChips: [BoardChip<String>] {
        MockSetup.lineups.map { BoardChip(label: $0.label, value: $0.lineup.rawValue, pressed: $0.lineup == lineup) }
    }

    /// A chip chosen by its value.
    public func choose(scoring raw: String) {
        Components.Schemas.ScoringPresetKnown(rawValue: raw).map { choose(preset: $0) }
    }

    public func choose(teamsChip raw: String) {
        Int(raw).map { choose(teams: $0) }
    }

    public func choose(lineup raw: String) {
        Components.Schemas.LineupKnown(rawValue: raw).map { choose(lineup: $0) }
    }

    /// The slots to choose from: one per team, then Random (nil).
    public var slots: [Int?] {
        (1 ... settings.teams).map { Optional($0) } + [nil]
    }

    public func choose(preset: Components.Schemas.ScoringPresetKnown) {
        opened = nil
        settings.scoring = .init(preset: .init(value1: .init(value1: preset)), custom: nil)
    }

    /// setup.ts setTeams: a slot past the new count goes back to Random.
    public func choose(teams: Int) {
        opened = nil
        settings.teams = teams
        if let slot = settings.slot, slot > teams {
            settings.slot = nil
        }
    }

    public func choose(slot: Int?) {
        settings.slot = slot
    }

    public func choose(lineup: Components.Schemas.LineupKnown) {
        opened = nil
        settings.lineup = .init(value1: lineup)
    }

    /// actions.ts startMock over the web's mockLeague: the saved league itself when the form drafts it
    /// as saved (its own rules, its own slot); its settings otherwise, since the API takes a league or
    /// settings, not both.
    func body() -> MockCreate {
        if let opened, openedExact, settings.slot == opened.settings.slot {
            return MockCreate(leagueId: opened.id, settings: nil, seed: nil)
        }
        return MockCreate(leagueId: nil, settings: .init(value1: settings), seed: nil)
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
            let room = try await api.createMock(body())
            return room.id
        } catch where APIError.signsOut(error) {
            onSignedOut()
        } catch {
            problem = MockRoomViewModel.sentence(for: error)
        }
        return nil
    }
}
