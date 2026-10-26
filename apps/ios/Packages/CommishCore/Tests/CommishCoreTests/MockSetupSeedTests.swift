import CommishAPI
@testable import CommishCore
import Foundation
import RunFixtures
import Testing

/// The setup starts from the member's context as the web's does: the context's format, and the saved
/// league the link or the selected league names, drafted as saved while the form holds it.
@MainActor
struct MockSetupSeedTests {
    static let savedID = "6f1d1c52-0000-4000-8000-000000000213"

    static func saved(slot: Int? = 3, reception: Double? = nil) -> SavedLeague {
        var settings = MockSetup.defaults()
        settings.teams = 10
        settings.slot = slot
        settings.lineup = .init(value1: .superflex)
        if let reception {
            settings.scoring = .init(preset: nil, custom: .init(value1: rules(reception: reception)))
        }
        let at = MockParityTests.clock.now
        return SavedLeague(
            id: savedID,
            name: "Home league",
            settings: settings,
            rounds: 15,
            createdAt: at,
            updatedAt: at
        )
    }

    static func rules(reception: Double) -> Components.Schemas.ScoringRules {
        Components.Schemas.ScoringRules(
            pointsPerPassingYard: 0.04, pointsPerPassingTouchdown: 4, pointsPerInterception: -2,
            pointsPerRushingYard: 0.1, pointsPerRushingTouchdown: 6, pointsPerReceivingYard: 0.1,
            pointsPerReceivingTouchdown: 6, pointsPerReception: reception, pointsPerFumbleLost: -2,
            teReceptionBonus: 0, pointsPerFieldGoal: 3, pointsPerExtraPoint: 1, pointsPerSack: 1,
            pointsPerDefensiveInterception: 2, pointsPerDefensiveTouchdown: 6, pointsPerTwoPointConversion: 2,
            pointsPerFieldGoalMissed: 0, pointsPerExtraPointMissed: 0, pointsPerReturnTouchdown: 6,
            pointsPerDefensiveFumbleRecovery: 2, pointsPerSafety: 2
        )
    }

    @Test func theSetupStartsInTheContextsFormatAsTheWebs() throws {
        let web = MockParityTests.parity["setup"] as? [String: Any] ?? [:]
        let formats = try #require(web["formats"] as? [[String: Any]])
        #expect(formats.count == 5)
        for entry in formats {
            let raw = try #require(entry["format"] as? String)
            let format = Components.Schemas.BoardFormatKnown(rawValue: raw)
            let viewModel = MockSetupViewModel(api: StubMock(), seed: MockSetupSeed(format: format))
            #expect(MockWords.formatLine(viewModel.settings) == entry["line"] as? String, "\(raw)")
        }
        let nearest = try #require(web["nearest"] as? [[String: Any]])
        for entry in nearest {
            let reception = try #require(entry["reception"] as? Double)
            let bonus = try #require(entry["bonus"] as? Double)
            #expect(MockSetup.nearestPreset(reception: reception, teBonus: bonus)
                .rawValue == entry["preset"] as? String)
        }
    }

    @Test func aHalfPprMemberStartsInHalfPpr() {
        let setup = MockSetupViewModel(api: StubMock(), seed: MockSetupSeed(format: .halfPpr))
        #expect(setup.preset == .halfPpr)
        #expect(setup.lineup == .standard)
    }

    @Test func aRerunKeepsItsOwnSettingsOverTheFormat() {
        var from = MockSetup.defaults()
        from.teams = 8
        let setup = MockSetupViewModel(api: StubMock(), from: from, seed: MockSetupSeed(format: .halfPpr))
        #expect(setup.preset == .ppr)
        #expect(setup.settings.teams == 8)
    }

    @Test func theSavedLeagueOpensAndIsDraftedAsSaved() async throws {
        let api = StubMock()
        await api.setSaved([Self.saved()])
        let setup = MockSetupViewModel(api: api, seed: MockSetupSeed(format: .ppr, league: Self.savedID))
        await setup.load()
        #expect(setup.opened?.id == Self.savedID)
        #expect(setup.settings.teams == 10)
        #expect(setup.lineup == .superflex)
        _ = await setup.start()
        let sent = try #require(await api.created.first)
        #expect(sent.leagueId == Self.savedID)
        #expect(sent.settings == nil)
    }

    @Test func anotherChoiceLetsTheSavedLeagueGoAndDraftsTheForm() async throws {
        let api = StubMock()
        await api.setSaved([Self.saved()])
        let setup = MockSetupViewModel(api: api, seed: MockSetupSeed(league: Self.savedID))
        await setup.load()
        setup.choose(teams: 12)
        #expect(setup.opened == nil)
        _ = await setup.start()
        let sent = try #require(await api.created.first)
        #expect(sent.leagueId == nil)
        #expect(sent.settings?.value1.teams == 12)
    }

    @Test func anotherSlotDraftsTheLeaguesSettingsFromThatSlot() async throws {
        let api = StubMock()
        await api.setSaved([Self.saved()])
        let setup = MockSetupViewModel(api: api, seed: MockSetupSeed(league: Self.savedID))
        await setup.load()
        setup.choose(slot: 7)
        #expect(setup.opened?.id == Self.savedID)
        _ = await setup.start()
        let sent = try #require(await api.created.first)
        #expect(sent.leagueId == nil)
        #expect(sent.settings?.value1.slot == 7)
        #expect(sent.settings?.value1.teams == 10)
    }

    @Test func aLeaguesOwnRulesDraftOnTheNearestPresetWithoutCustomScoring() async throws {
        let api = StubMock()
        await api.setSaved([Self.saved(reception: 0.5)])
        let setup = MockSetupViewModel(api: api, seed: MockSetupSeed(league: Self.savedID))
        await setup.load()
        #expect(setup.preset == .halfPpr)
        _ = await setup.start()
        let sent = try #require(await api.created.first)
        #expect(sent.leagueId == nil)
        #expect(sent.settings?.value1.scoring.preset?.value1.value1 == .halfPpr)
    }

    @Test func aLeagueTheAccountDoesNotHaveLeavesTheForm() async {
        let api = StubMock()
        let setup = MockSetupViewModel(api: api, seed: MockSetupSeed(format: .standard, league: "gone"))
        await setup.load()
        #expect(setup.opened == nil)
        #expect(setup.preset == .standard)
    }
}
