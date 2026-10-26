import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import RunFixtures
import Testing

/// The Rankings port held to the web's Players page in season at 390 (shared/fixtures/parity/
/// rankings.json): the sentence under the page's name, the hits, the heads, every row of our order in
/// its section with its place, pill, game, week, Projected and strip of labelled cells (each head,
/// figure, key, tint and share), Show more and the phone's basis beside the strip, at every chip, a
/// search alone and inside a position, and on Sunday; then the kickers' and defenses' week, its
/// sections and heads, a search over it, the line when none matches, and its basis with the rules our
/// stats lack. Review Focus 4: every place is the API's rank under every filter.
struct RankingsParityTests {
    static let parity: RankingsParity = {
        do {
            return try JSONDecoder().decode(RankingsParity.self, from: Fixtures.data("fixtures/parity/rankings.json"))
        } catch {
            preconditionFailure("shared/fixtures/parity/rankings.json does not read: \(error)")
        }
    }()

    static let orderCases = ["all", "QB", "RB", "WR", "TE", "search", "WR-search", "all-sunday"]
    static let weekCases = ["DEF", "K", "DEF-search", "K-none", "K-sunday"]

    static func instant(_ iso: String) -> Date {
        APIDecoding.parseDate(iso) ?? Date(timeIntervalSince1970: 0)
    }

    static func file(_ name: String) -> String {
        name.replacingOccurrences(of: #"T(\d\d):(\d\d):(\d\d)\.000Z"#, with: "T$1-$2-$3Z", options: .regularExpression)
    }

    static func order(_ name: String) throws -> (RankingsParity.Order, RankingsModel) {
        let web = try #require(parity.orders[name])
        let advice = try APIDecoding.envelopeData(
            OrderAdvice.self,
            from: Fixtures.data("fixtures/inseason/\(web.file)")
        )
        let model = RankingsModel(
            advice: advice, chip: web.chip.flatMap(RankingsChip.init(rawValue:)), query: web.query, inSeason: true,
            zone: Fixtures.zone, now: instant(web.clock)
        )
        return (web, model)
    }

    static func week(_ name: String) throws -> (RankingsParity.Week, WeekRankingsModel) {
        let web = try #require(parity.weeks[name])
        let advice = try APIDecoding.envelopeData(
            WeekOrderAdvice.self, from: Fixtures.data("fixtures/inseason/\(web.file)")
        )
        let model = WeekRankingsModel(
            advice: advice, position: web.position == "DEF" ? .def : .k, query: web.query, boardScoring: "PPR",
            zone: Fixtures.zone, now: instant(web.clock)
        )
        return (web, model)
    }

    @Test func thePageIsNamedAsTheWebNamesItInSeason() {
        #expect(RankingsWords.name(inSeason: true) == Self.parity.names.inSeason)
        #expect(RankingsWords.name(inSeason: false) == Self.parity.names.before)
        #expect(RankingsWords.lead(inSeason: false, onWeekChip: false, week: nil) == Self.parity.leadBefore)
        #expect([Words.Order.every] + RankingsChip.allCases.map(\.word) == Self.parity.chips)
    }

    @Test(arguments: orderCases)
    func theOrdersHeadHitsBasisAndShowMoreAreTheWebs(name: String) throws {
        let (web, model) = try Self.order(name)
        #expect(model.lead == web.lead)
        #expect(model.hits == web.hits)
        #expect(model.heads == RankingsHeads(rank: web.heads.rank, week: web.heads.week, total: web.heads.total))
        #expect(model.more == web.more)
        #expect(model.basis == web.stripBasis)
    }

    @Test(arguments: orderCases)
    func everyRowIsTheWebsInItsSection(name: String) throws {
        let (web, model) = try Self.order(name)
        #expect(model.sections.map(\.head) == web.sections.map(\.head))
        for (mine, theirs) in zip(model.sections, web.sections) {
            #expect(mine.rows.map(RankingsParity.OrderRow.init) == theirs.rows)
        }
    }

    /// Review Focus 4: the # cell is the API's rank under every filter, a search and a position among
    /// them, never a place numbered again on the phone.
    @Test(arguments: orderCases)
    func everyPlaceIsTheAPIsRankUnderEveryFilter(name: String) throws {
        let (web, model) = try Self.order(name)
        let advice = try APIDecoding.envelopeData(
            OrderAdvice.self,
            from: Fixtures.data("fixtures/inseason/\(web.file)")
        )
        #expect(model.rows.map(\.rank) == advice.rows.map(\.rank))
        for row in model.rows where !row.bye && row.player.status?.onList != true {
            #expect(row.place == String(row.rank))
        }
    }

    @Test(arguments: weekCases)
    func theWeeksRowsSectionsAndBasisAreTheWebs(name: String) throws {
        let (web, model) = try Self.week(name)
        #expect(model.heading == web.heading)
        #expect(model.status == web.status.map { "\($0.lead) \($0.rest)" })
        #expect(model.proj == web.proj)
        #expect(model.none == web.none)
        #expect(model.basis == web.basis)
        #expect(model.rules == web.rules)
        #expect(model.sections.map(\.head) == web.sections.map(\.head))
        for (mine, theirs) in zip(model.sections, web.sections) {
            #expect(mine.rows.map(RankingsParity.WeekRow.init) == theirs.rows)
        }
    }

    @Test func aRowOpensThePlayerSheetByHisIdWhereTheSiteHasHisPage() throws {
        let (_, model) = try Self.order("all")
        let swift = try #require(model.rows.first)
        #expect(swift.player.sheetPlayer == SheetPlayer(
            id: "4259545", slug: "d-andre-swift", name: "D'Andre Swift", position: "RB", rank: "15", club: "CHI"
        ))
        let (_, week) = try Self.week("DEF")
        #expect(week.rows.allSatisfy { $0.player.sheetPlayer == nil }, "a defense has no page")
    }
}

/// shared/fixtures/parity/rankings.json, as the web's readers wrote it.
struct RankingsParity: Decodable, Sendable {
    struct Names: Decodable, Sendable {
        let inSeason: String
        let before: String
    }

    struct Heads: Decodable, Sendable {
        let rank: String
        let week: String
        let total: String
    }

    struct Status: Decodable, Equatable, Sendable {
        let mark: String
        let sits: Bool
    }

    struct Weather: Decodable, Equatable, Sendable {
        let glyph: String
        let words: String
    }

    /// figure-strip.ts StripCell as the parity pins it, with its share of the strip's width as the
    /// web's stripShare gives it, so the app's share is compared, never copied in silence.
    struct Cell: Decodable, Equatable, Sendable {
        let head: String
        let value: String
        let key: Bool
        let ease: String?
        let narrow: Bool
        let share: Double

        init(_ cell: StripCell) {
            head = cell.head
            value = cell.value
            key = cell.key
            ease = cell.ease?.rawValue
            narrow = cell.narrow
            share = cell.share
        }
    }

    /// box.ts RowGame: the opponent and the kickoff or state, "bye", "no-club", or none.
    enum Game: Decodable, Equatable, Sendable {
        case game(String, String)
        case word(String)
        case none

        init(from decoder: any Decoder) throws {
            let container = try decoder.singleValueContainer()
            if container.decodeNil() {
                self = .none
            } else if let word = try? container.decode(String.self) {
                self = .word(word)
            } else {
                let game = try container.decode([String: String].self)
                self = .game(game["where"] ?? "", game["when"] ?? "")
            }
        }

        init(_ game: RowGame) {
            switch game {
            case let .game(place, when): self = .game(place, when)
            case .bye: self = .word("bye")
            case .noClub: self = .word("no-club")
            case .none: self = .none
            }
        }
    }

    struct Player: Decodable, Equatable, Sendable {
        let key: String
        let name: String
        let fit: String
        let slug: String?
        let mark: Bool
        let club: String
        let pill: String?
        let status: Status?
        let game: Game
        let expected: String?
        let weather: Weather?

        init(_ player: RankingsPlayer) {
            key = player.key
            name = player.name
            fit = player.fit
            slug = player.slug
            mark = player.clubMark
            club = player.club
            pill = player.pill
            status = player.status.map { Status(mark: $0.mark, sits: $0.sits) }
            game = Game(player.game)
            expected = player.expected
            weather = player.weather.map { Weather(glyph: $0.glyph, words: $0.words) }
        }

        enum CodingKeys: String, CodingKey {
            case key, name, fit, slug, mark, club, pill, status, game, expected, weather
        }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            key = try container.decode(String.self, forKey: .key)
            name = try container.decode(String.self, forKey: .name)
            fit = try container.decode(String.self, forKey: .fit)
            slug = try container.decodeIfPresent(String.self, forKey: .slug)
            mark = try container.decode(Bool.self, forKey: .mark)
            club = try container.decode(String.self, forKey: .club)
            pill = try container.decodeIfPresent(String.self, forKey: .pill)
            status = try container.decodeIfPresent(Status.self, forKey: .status)
            game = try container.decodeIfPresent(Game.self, forKey: .game) ?? .none
            expected = try container.decodeIfPresent(String.self, forKey: .expected)
            weather = try container.decodeIfPresent(Weather.self, forKey: .weather)
        }
    }

    struct OrderRow: Decodable, Equatable, Sendable {
        let player: Player
        let rank: Int
        let place: String
        let bye: Bool
        let week: String
        let total: String
        let cells: [Cell]

        init(_ row: RankingsRow) {
            player = Player(row.player)
            rank = row.rank
            place = row.place
            bye = row.bye
            week = row.week
            total = row.total
            cells = row.cells.map(Cell.init)
        }

        enum CodingKeys: String, CodingKey {
            case rank, place, bye, week, total, cells
        }

        init(from decoder: any Decoder) throws {
            player = try Player(from: decoder)
            let container = try decoder.container(keyedBy: CodingKeys.self)
            rank = try container.decode(Int.self, forKey: .rank)
            place = try container.decode(String.self, forKey: .place)
            bye = try container.decode(Bool.self, forKey: .bye)
            week = try container.decode(String.self, forKey: .week)
            total = try container.decode(String.self, forKey: .total)
            cells = try container.decode([Cell].self, forKey: .cells)
        }
    }

    struct WeekRow: Decodable, Equatable, Sendable {
        let player: Player
        let proj: String
        let cells: [Cell]

        init(_ row: WeekRankingsRow) {
            player = Player(row.player)
            proj = row.proj
            cells = row.cells.map(Cell.init)
        }

        enum CodingKeys: String, CodingKey {
            case proj, cells
        }

        init(from decoder: any Decoder) throws {
            player = try Player(from: decoder)
            let container = try decoder.container(keyedBy: CodingKeys.self)
            proj = try container.decode(String.self, forKey: .proj)
            cells = try container.decode([Cell].self, forKey: .cells)
        }
    }

    struct Section<Row: Decodable & Sendable>: Decodable, Sendable {
        let head: String?
        let rows: [Row]
    }

    struct Order: Decodable, Sendable {
        let clock: String
        let file: String
        let chip: String?
        let query: String
        let lead: String?
        let hits: String
        let heads: Heads
        let sections: [Section<OrderRow>]
        let more: Bool
        /// The phone's basis beside the strip ("Opp rank is ..."); `basis` is the Android row's.
        let stripBasis: String

        enum CodingKeys: String, CodingKey {
            case clock, file, chip, lead, hits, heads, sections, more, stripBasis
            case query = "q"
        }
    }

    struct WeekStatus: Decodable, Sendable {
        let lead: String
        let rest: String
    }

    struct Week: Decodable, Sendable {
        let clock: String
        let file: String
        let position: String
        let query: String
        let heading: String
        let status: WeekStatus?
        let proj: Bool
        let none: String?
        let sections: [Section<WeekRow>]
        let basis: String
        let rules: String?

        enum CodingKeys: String, CodingKey {
            case clock, file, position, heading, status, proj, none, sections, basis, rules
            case query = "q"
        }
    }

    let names: Names
    let leadBefore: String?
    let chips: [String]
    let orders: [String: Order]
    let weeks: [String: Week]
}
