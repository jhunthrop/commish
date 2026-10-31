@testable import Board
import CommishAPI
import CommishCore
import CommishDesign
import Foundation
@testable import MockRoom
@testable import Player
@testable import Rankings
import RunFixtures
import SwiftUI

/// The pushed pages and the mock room: each through its view model over the fixture runs, drawn from the
/// screen's own parts as its first screen shows them.
@MainActor
enum PageScenes {
    /// Rows enough to fill the first screen of the tallest phone.
    static let firstRows = 14

    /// Saturday noon, our rest-of-season order with no league, every position.
    static func rankings() async throws -> StoreScreen {
        let viewModel = RankingsViewModel(
            api: StubRankings(), cache: StoreFixtures.cache("rankings"),
            clock: FixedClock(StoreFixtures.instant(StoreFixtures.saturday)), inSeason: true, zone: StoreFixtures.zone
        )
        await viewModel.load()
        guard case let .loaded(content, _, _) = viewModel.state else {
            throw StoreSceneError.notLoaded("rankings")
        }
        return StoreScreen(
            RankingsScreen(
                name: viewModel.name, lead: viewModel.lead, stamp: viewModel.stampWords, chip: viewModel.chip,
                query: viewModel.query, content: content, more: viewModel.more, actions: .none, still: true,
                rows: firstRows
            )
        )
    }

    /// Before the draft, the stand-in's PPR board from its top: the tiers, over replacement and the gap to
    /// ADP, the verb to follow a league pinned.
    static let preDraft = APIDecoding.parseDate("2026-09-01T17:00:00Z")!

    static func board() async throws -> StoreScreen {
        let viewModel = BoardViewModel(
            api: StubRun(.standIn), cache: StoreFixtures.cache("board"), clock: FixedClock(preDraft),
            inSeason: false, following: false, zone: StoreFixtures.zone
        )
        await viewModel.load()
        guard case let .loaded(model, _, _) = viewModel.state else {
            throw StoreSceneError.notLoaded("board")
        }
        let screen = BoardScreen(
            model: model, stamp: viewModel.stampWords, actions: .none, sections: firstScreen(model.sections),
            live: false
        )
        guard let verb = model.words.verb else {
            return StoreScreen(screen)
        }
        return StoreScreen(screen, pin: BoardPinView(verb: verb) {})
    }

    /// The sections the first screen reaches, their rows up to the tallest phone's first screen.
    private static func firstScreen(_ sections: [BoardSection]) -> [BoardSection] {
        var left = firstRows
        return sections.compactMap { section in
            guard left > 0 else {
                return nil
            }
            let kept = Array(section.rows.prefix(left))
            left -= kept.count
            return section.with(rows: kept)
        }
    }

    /// The recorded draft's clock: Sunday 2026-10-25 at 16:00 Central.
    static let mockReadAt = APIDecoding.parseDate("2026-10-25T21:00:00Z")!

    /// A mock draft against bots at round 5, the member on the clock: our call above the pool, the room's
    /// bar at its foot, full screen as the app draws the room.
    static func mockRoom() async throws -> StoreScreen {
        let viewModel = MockRoomViewModel(
            id: MockFixture.id, api: StubMock(opened: .round5), cache: StoreFixtures.cache("mock"),
            clock: FixedClock(mockReadAt), zone: StoreFixtures.zone
        )
        await viewModel.load()
        guard case let .room(model, _) = viewModel.state else {
            throw StoreSceneError.notLoaded("mock room")
        }
        let room = MockRoomScreen(
            model: model, stale: nil, refusal: nil, enabled: viewModel.canWrite, actions: .none,
            parts: [.call, .pool], live: false
        )
        guard let bar = model.bar else {
            return StoreScreen(room)
        }
        return StoreScreen(
            room, pin: MockBarView(bar: bar, enabled: viewModel.canWrite, copied: false, actions: .none, live: false)
        )
    }

    /// The stand-in run's player with a week read in the fixture league (the player tests' page hero).
    static let player = "rome-odunze"

    /// A player's page from its top in the fixture league at Saturday noon: his week's game and figures,
    /// the board's projection and where drafters take him, his verb pinned.
    static func playerPage() async throws -> StoreScreen {
        let viewModel = PlayerPageViewModel(
            slug: player, run: StubRun(.standIn), pages: StubPages(.standIn),
            weeks: StoreWeeks(clock: StoreFixtures.saturday), cache: StoreFixtures.cache("player"),
            clock: FixedClock(StoreFixtures.instant(StoreFixtures.saturday)), league: StoreFixtures.league,
            zone: StoreFixtures.zone
        )
        await viewModel.load()
        guard case let .loaded(model, _) = viewModel.state else {
            throw StoreSceneError.notLoaded("player page")
        }
        let page = PageSectionsView(model: model, stamp: nil)
        guard let verb = model.verb else {
            return StoreScreen(page)
        }
        return StoreScreen(page, pin: PinnedVerb(verb: verb) {})
    }
}

/// The fixture league's weeks at a clock, the public read standing in where the fixture keeps none.
struct StoreWeeks: PlayerWeekAPI {
    let clock: String

    func leagueWeek(league _: String, player: String) async throws -> PlayerWeek {
        try WeekFixture.league(player, at: clock)
    }

    func publicWeek(player: String) async throws -> PlayerWeek {
        try WeekFixture.publicWeek(player, at: clock)
    }
}
