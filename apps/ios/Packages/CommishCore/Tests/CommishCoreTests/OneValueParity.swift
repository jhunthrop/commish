import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import RunFixtures
import Testing

/// shared/fixtures/parity/one-value.json, as the web's readers wrote it (one-value-parity.ts): three
/// players on every view at the order's clock and the run's, the pair, the refusals and the bases.
struct OneValueParity: Decodable {
    struct Figures: Decodable, Equatable {
        let rank: Int
        let positionRank: Int
        let projected: Double
        let vor: Double
        let round: Int
    }

    struct Drawn: Decodable {
        let row: Int
        let rank: Int
        let positionRank: Int
        let projected: Double
        let vor: Double
        let round: Int
    }

    struct Club: Decodable {
        let ids: [String]
        let row: Int
        let rank: Int
        let positionRank: Int
        let projected: Double
        let vor: Double
    }

    struct Order: Decodable {
        let rank: Int
        let positionRank: Int
        let projected: Double
        let vor: Double
    }

    struct Formats: Decodable {
        struct Row: Decodable {
            let format: String
            let rank: Int?
            let points: Double?
            let vor: Double?
        }

        let rows: [Row]
        let footnote: String?
    }

    struct Player: Decodable {
        let name: String
        let id: String
        let slug: String
        let team: String
        let position: String
        let order: Order
        let run: Figures
        let board: Drawn
        let club: Club
        let compare: Figures
        let formats: [String: Formats]
    }

    struct Lead: Decodable {
        struct Shown: Decodable {
            let id: String
            let rank: Int
            let positionRank: Int
        }

        let abbr: String
        let lead: Shown?
    }

    struct Pair: Decodable {
        struct Side: Decodable {
            let id: String
            let rank: Int
            let positionRank: Int
            let projected: Double
            let vor: Double
        }

        let format: String
        let atClock: Bool
        let sides: [Side]
        let evidence: String?
    }

    struct Basis: Decodable {
        struct Bare: Decodable {
            let unread: [String]
            let read: [String]
        }

        let lead: String
        let stamp: String
        let sample: [String]
        let unread: [String]
        let read: [String]
        let bare: Bare
    }

    struct Refused: Decodable {
        let club: [String]?
        let pair: [String: String]?
        let inScoring: [String: Bool]
    }

    struct Board: Decodable {
        let ids: [String]
    }

    let zone: String
    let teams: Int
    let players: [Player]
    let board: Board
    let clubs: [String: [Lead]]
    let compare: [String: Pair]
    let refused: Refused
    let basis: Basis

    static func load() throws -> OneValueParity {
        try JSONDecoder().decode(OneValueParity.self, from: OneValueFixture.parity())
    }
}

/// The one-value stand-in's screens as the suites read them: the order at the Sunday clock, its read
/// (failing with no signal while `offline`), and each screen's view model loaded over the stand-in.
@MainActor
struct OneValueReads {
    static let parity = try! OneValueParity.load() // swiftlint:disable:this force_try
    static let zone = TimeZone(identifier: parity.zone)!
    static let now = OneValueFixture.now
    static let ppr = "ppr-12"
    let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent("commish-one-value-tests-\(UUID().uuidString)")

    enum Failure: Error {
        case notLoaded(String)
    }

    static func order() throws -> OrderAtClock {
        try OrderAtClock(answer: RankingsFixture.order("", at: OneValueFixture.clock), landed: now)
    }

    static func orders(offline: Bool = false) -> OrderReader {
        OrderReader(
            api: StubRankings(clock: OneValueFixture.clock, offline: offline), clock: FixedClock(now), memo: OrderMemo()
        )
    }

    static func board(position: BoardPosition? = nil, order: OrderAtClock?) throws -> BoardModel {
        try BoardModel(
            read: RunFixture.oneValue.read(format: ppr), position: position, inSeason: true, following: false,
            now: now, zone: zone, order: order
        )
    }

    func cache() -> FileCache {
        FileCache(folder: folder.appendingPathComponent(UUID().uuidString))
    }

    func loaded<Model>(_ viewModel: RunScreenViewModel<Model>) throws -> Model {
        guard case let .loaded(model, _) = viewModel.state else {
            throw Failure.notLoaded("\(viewModel.state)")
        }
        return model
    }

    func club(_ abbr: String, orders: OrderReader) async throws -> ClubPageModel {
        let viewModel = RunScreenViewModel.club(
            abbr, run: StubRun(.oneValue), pages: StubPages(.oneValue), cache: cache(),
            clock: FixedClock(Self.now), zone: Self.zone, orders: orders
        )
        await viewModel.load()
        return try loaded(viewModel)
    }

    func compare(orders: OrderReader?) async -> RunScreenViewModel<CompareModel> {
        let pair = Self.parity.players.prefix(2).map { Optional($0.slug) }
        let viewModel = RunScreenViewModel.compare(
            slugs: pair, run: StubRun(.oneValue), pages: StubPages(.oneValue), cache: cache(),
            clock: FixedClock(Self.now), zone: Self.zone, orders: orders
        )
        await viewModel.load()
        return viewModel
    }

    func table(_ model: CompareModel) throws -> CompareTable {
        guard case let .table(table) = model.outcome else {
            throw Failure.notLoaded("\(model.outcome)")
        }
        return table
    }

    func page(_ player: OneValueParity.Player, offline: Bool) async throws -> PlayerPageModel {
        let viewModel = PlayerPageViewModel(
            slug: player.slug, run: StubRun(.oneValue), pages: StubPages(.oneValue),
            weeks: StubOneValueWeeks(offline: offline), cache: cache(), clock: FixedClock(Self.now), league: nil,
            zone: Self.zone
        )
        await viewModel.load()
        guard case let .loaded(model, _) = viewModel.state else {
            throw Failure.notLoaded("\(viewModel.state)")
        }
        return model
    }
}
