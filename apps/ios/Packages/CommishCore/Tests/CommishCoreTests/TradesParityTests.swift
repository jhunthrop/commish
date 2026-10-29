import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import Testing

/// The Trades' port held to the web's Trades at 390 (shared/fixtures/parity/trades.json): the
/// decision, the strip, the chips, the finder in both orders with each trade's opened players and its
/// offer (the share text), the bases closed and opened at all six fixture clocks; each check the
/// fixtures post as the scoreboard draws it; the line under a pressed verb.
struct TradesParityTests {
    static let parity: TradesParity = {
        do {
            return try JSONDecoder().decode(TradesParity.self, from: Fixtures.data("fixtures/parity/trades.json"))
        } catch {
            preconditionFailure("shared/fixtures/parity/trades.json does not read: \(error)")
        }
    }()

    static let host = Components.Schemas.LeagueHost(value1: .ffpc)

    static func model(_ clock: String, every: Bool = false, sort: TradeSort = .mine) throws -> TradesModel {
        try TradesModel(
            advice: Fixtures.trades(clock), host: host, me: parity.me, every: every, sort: sort,
            now: Fixtures.instant(clock), zone: Fixtures.zone
        )
    }

    static func web(_ clock: String) throws -> TradesParity.Clock {
        try #require(parity.clocks[clock])
    }

    @Test(arguments: StartParityTests.clocks)
    func theDecisionStripAndChipsAreTheWebs(clock: String) throws {
        let web = try Self.web(clock)
        let model = try Self.model(clock)
        #expect(model.decision == web.decision)
        #expect(model.strip.map(TradesParity.Strip.init) == web.strip)
        #expect(model.best == web.chips.best)
        #expect(model.every == web.chips.every)
        #expect(model.gainBasis == web.gainBasis)
        #expect(model.verb == web.verb)
        #expect(model.reason == web.reason)
    }

    @Test(arguments: StartParityTests.clocks)
    func everyRowInEveryOrderIsTheWebs(clock: String) throws {
        let web = try Self.web(clock)
        for every in [false, true] {
            for sort in TradeSort.allCases {
                let rows = try Self.model(clock, every: every, sort: sort).rows.map(TradesParity.Row.init)
                let theirs = (every ? web.finder.every : web.finder.best)[sort.rawValue] ?? []
                #expect(rows.map(\.key) == theirs.map(\.key), "\(clock) \(every) \(sort)")
                for (ours, webs) in zip(rows, theirs) {
                    #expect(ours == webs, "\(clock) \(ours.key)")
                }
            }
        }
    }

    @Test(arguments: StartParityTests.clocks)
    func everyOfferIsTheWebsShareText(clock: String) throws {
        let web = try Self.web(clock)
        let offers = try Self.model(clock, every: true).rows.map(\.offer)
        #expect(offers == (web.finder.every["mine"] ?? []).map(\.offer))
        #expect(!offers.isEmpty)
    }

    @Test(arguments: StartParityTests.clocks)
    func theBasisIsTheWebsPhoneParagraphClosedOpenedAndBuilding(clock: String) throws {
        let web = try Self.web(clock)
        let model = try Self.model(clock)
        #expect(web.basis.closed == "\(model.basis(.none)) \(Words.InSeason.orderRecord)")
        #expect(web.basis.opened == "\(model.basis(.trade)) \(Words.InSeason.orderRecord)")
        #expect(web.basis.builder == "\(model.basis(.builder)) \(Words.InSeason.orderRecord)")
    }

    @Test(arguments: [Fixtures.week, Fixtures.sunday])
    func everyCheckIsTheWebsScoreboard(clock: String) throws {
        let checks = try #require(Self.parity.checks[clock])
        let strip = try #require(Self.model(clock).strip)
        #expect(checks.count == 2)
        for (index, web) in checks.enumerated() {
            let check = try TradeChecks.held(Fixtures.tradeCheck(clock, index + 1), now: Fixtures.instant(clock))
            let ours = TradesParity.Check(check, me: Self.parity.me, team: strip.cards[index].team)
            #expect(ours == web, "\(clock) \(index + 1)")
        }
    }

    /// B271: each team the finder lists no trade with keeps its place, said, as the web's ideas row draws
    /// it (its places of kind none, in order).
    @Test(arguments: StartParityTests.clocks)
    func everyTeamWithNoIdeaIsTheWebs(clock: String) throws {
        let web = try Self.web(clock)
        let model = try Self.model(clock)
        let none = web.ideas.places.filter { $0.kind == "none" }
        #expect(model.noIdeas.map(\.id) == none.map(\.rosterId), "\(clock)")
        #expect(model.noIdeas.map(\.team) == none.map(\.team), "\(clock)")
        #expect(model.noIdeas.allSatisfy { $0.note == Words.Trades.noIdea })
        #expect(none.allSatisfy { $0.note == Words.Trades.noIdea })
    }

    @Test func theFixtureDropsEveryIdeaWithATeam() throws {
        #expect(try !Self.model(Fixtures.week).noIdeas.isEmpty)
    }

    @Test func theLineUnderAPressedVerbIsTheWebs() {
        #expect(TradesWords.copied(true, platform: "FFPC").words == Self.parity.copied.done)
        #expect(TradesWords.copied(false, platform: "FFPC").words == Self.parity.copied.failed)
    }

    @Test(arguments: StartParityTests.clocks)
    func everyOpenedLineCarriesTheAPIsGameState(clock: String) throws {
        let advice = try Fixtures.trades(clock)
        let lines = advice.teams
            .flatMap { $0.trades.flatMap { $0.give + $0.get + ($0.drop.map { [$0.value1] } ?? []) } }
        let stated: Bool = lines.allSatisfy { $0.gameState?.value1.state.value1 != nil }
        #expect(stated, "\(clock)")
    }
}

/// shared/fixtures/parity/trades.json, as the web's readers wrote it.
struct TradesParity: Decodable {
    struct Card: Decodable, Equatable {
        let key: String
        let mark: String?
        let team: String
        let give: String
        let get: String
        let mine: String
        let theirs: String
        let need: String?
        let week: String?
        let drop: String?
        let dropReason: String?
    }

    struct Strip: Decodable, Equatable {
        let week: String
        let title: String
        let reason: String?
        let cards: [Card]

        init(_ strip: TradesStrip) {
            week = strip.week
            title = strip.title
            reason = strip.reason
            cards = strip.cards.map {
                Card(
                    key: $0.id, mark: $0.mark, team: $0.team, give: $0.give, get: $0.get, mine: $0.mine,
                    theirs: $0.theirs, need: $0.need, week: $0.week, drop: $0.drop, dropReason: $0.dropReason
                )
            }
        }
    }

    struct Gain: Decodable, Equatable {
        let gain: String
        let tone: String
    }

    struct OpenedRow: Decodable, Equatable {
        let cells: LineupParity.Row
        let season: String

        init(_ cells: RowCells) {
            self.cells = LineupParity.Row(cells)
            season = cells.season
        }

        init(from decoder: any Decoder) throws {
            cells = try LineupParity.Row(from: decoder)
            season = try decoder.container(keyedBy: Keys.self).decode(String.self, forKey: .season)
        }

        enum Keys: String, CodingKey {
            case season
        }
    }

    struct Group: Decodable, Equatable {
        let head: String
        let rows: [OpenedRow]
    }

    struct Opened: Decodable, Equatable {
        let week: String?
        let dropReason: String?
        let groups: [Group]
    }

    struct Row: Decodable, Equatable {
        let key: String
        let team: String
        let give: String
        let get: String
        let with: String
        let need: String?
        let mine: Gain
        let theirs: Gain
        let offer: String
        let opened: Opened

        init(_ line: TradeLine) {
            key = line.id
            team = line.team
            give = line.give
            get = line.get
            with = line.with
            need = line.need
            mine = Gain(gain: line.mine.words, tone: line.mine.tone.rawValue)
            theirs = Gain(gain: line.theirs.words, tone: line.theirs.tone.rawValue)
            offer = line.offer
            opened = Opened(
                week: line.opened.week, dropReason: line.opened.dropReason,
                groups: line.opened.groups.map { Group(head: $0.head, rows: $0.rows.map(OpenedRow.init)) }
            )
        }
    }

    struct Finder: Decodable {
        let best: [String: [Row]]
        let every: [String: [Row]]
    }

    struct Chips: Decodable {
        let best: String
        let every: String
    }

    struct Basis: Decodable {
        let closed: String
        let opened: String
        let builder: String
    }

    struct Clock: Decodable {
        let decision: String
        let strip: Strip?
        let chips: Chips
        let gainBasis: String?
        let verb: String
        let reason: String?
        let finder: Finder
        let basis: Basis
        let ideas: Ideas
    }

    /// The builder-first screen's ideas row (Lane 277): each place an idea or a team with none.
    struct Ideas: Decodable {
        let head: String
        let places: [Place]
    }

    struct Place: Decodable {
        let kind: String
        let rosterId: Int
        let team: String
        let note: String?
    }

    struct Figures: Decodable, Equatable {
        let projBefore: String
        let projAfter: String
        let projChange: String
        let projTone: String
        let seasonBefore: String
        let seasonAfter: String
        let seasonChange: String
        let seasonTone: String
    }

    struct Side: Decodable, Equatable {
        let label: String
        let name: String
        let figures: Figures
        let room: String
        /// Its rest-of-season cell (Lane 277).
        let rest: Rest

        init(_ side: TradeBugSide) {
            rest = Rest(side.rest)
            label = side.label
            name = side.name
            let figures = side.figures
            self.figures = Figures(
                projBefore: figures.projBefore, projAfter: figures.projAfter, projChange: figures.projChange,
                projTone: figures.projTone.rawValue, seasonBefore: figures.seasonBefore,
                seasonAfter: figures.seasonAfter, seasonChange: figures.seasonChange,
                seasonTone: figures.seasonTone.rawValue
            )
            room = side.room
        }
    }

    /// trades.ts RestFigure as the parity file writes it.
    struct Rest: Decodable, Equatable {
        let text: String
        let tone: String
        let refuses: Bool

        init(_ rest: TradeRest) {
            text = rest.text
            tone = rest.tone.rawValue
            refuses = rest.refuses
        }
    }

    struct Check: Decodable, Equatable {
        let yours: Side
        let theirs: Side
        let sentence: String
        let basis: String

        /// The check as the scoreboard and its answer line draw it, held at its clock.
        init(_ check: TradeCheck, me: String, team: String) {
            let trade = check.trade.value1
            let room = TradeChecks.room(check)
            yours = Side(TradeBugSide(
                me: true, name: me, totals: check.totals.yours, gain: trade.myGain, projChange: trade.myProjChange,
                room: room.yours, rest: TradeRest.of(check, mine: true)
            ))
            theirs = Side(TradeBugSide(
                me: false, name: team, totals: check.totals.theirs, gain: trade.theirGain,
                projChange: trade.theirProjChange, room: room.theirs, rest: TradeRest.of(check, mine: false)
            ))
            sentence = TradeChecks.words(check)
            basis = check.basis
        }
    }

    struct Copied: Decodable {
        let done: String
        let failed: String
    }

    let me: String
    let clocks: [String: Clock]
    let checks: [String: [Check]]
    let copied: Copied
}
