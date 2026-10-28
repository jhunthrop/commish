import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import Testing

/// The Trades' picker, builder and built sentences held to the web (shared/fixtures/parity/trades.json,
/// Lane 189 fix round 1): every checkWords branch over the fixture's check edited as builder.test.ts
/// edits one, the decisions with no trade and with a gain under what a page shows, the strip's titles,
/// the builder's prompts, the Trades holding picker and its narrowed rows, and the builder opened from
/// the best trade with its check (both rosters with their ticks, the answer line, the pin).
struct TradesBuilderParityTests {
    static let parity: BuilderParity = {
        do {
            return try JSONDecoder().decode(BuilderParity.self, from: Fixtures.data("fixtures/parity/trades.json"))
        } catch {
            preconditionFailure("shared/fixtures/parity/trades.json does not read: \(error)")
        }
    }()

    static func check() throws -> TradeCheck {
        try Fixtures.tradeCheck(Fixtures.week, 1)
    }

    @Test func everyCheckSentenceIsTheWebs() throws {
        let base = try Self.check()
        #expect(Self.parity.words.checks.count == 22)
        for edit in Self.parity.words.checks {
            let edited = edit.applied(to: base)
            #expect(TradeChecks.words(edited) == edit.sentence, "\(edit.name)")
            #expect(TradeChecks.refusal(edited) == edit.refusal, "\(edit.name)")
        }
        // Lane 277: each side that would not take it leads its line.
        #expect(Self.parity.words.checks.contains { $0.refusal == Words.Trades.theyGiveUp })
        #expect(Self.parity.words.checks.contains { $0.refusal == Words.Trades.youGiveUp })
        #expect(Self.parity.words.checks.contains { $0.refusal == Words.Trades.bothGiveUp })
    }

    @Test func theDecisionsTitlesAndPromptsAreTheWebs() throws {
        let words = Self.parity.words
        #expect(TradesWords.decision(nil) == words.noTrade)
        var row = try Self.check().trade.value1
        row.myGain = 0.04
        row.theirGain = 0.6
        row.drop = nil
        #expect(TradesWords.decision((row, "Max_Jensen10")) == words.under)
        for title in words.titles {
            #expect(TradesWords.worthTitle(title.count) == title.title)
        }
        #expect(TradesWords.noTradeWith("Josh Downs") == words.noTradeWith)
        for prompt in words.prompts {
            let picks = TradePicks(
                team: 1, give: (0 ..< prompt.give).map { "g\($0)" }, get: (0 ..< prompt.get).map { "t\($0)" }
            )
            #expect(TradeBuilder.prompt(picks) == prompt.prompt)
        }
    }

    @Test func thePickerAndTheTradesHoldingAPlayerAreTheWebs() throws {
        let web = Self.parity.holding
        let advice = try Fixtures.trades(Fixtures.week)
        let model = { (every: Bool) in
            try TradesModel(
                advice: advice, narrowed: Fixtures.tradesHolding(), holding: web.player,
                host: TradesParityTests.host, me: TradesParityTests.parity.me, every: every, sort: .mine,
                now: Fixtures.instant(Fixtures.week), zone: Fixtures.zone
            )
        }
        let best = try model(false)
        // The web's key for a player our board does not place names the platform's id field; the app's
        // prefix is its own (TradeFinder.unplaced).
        let key = { (key: String) in key.replacingOccurrences(of: "host:", with: TradeFinder.unplaced) }
        #expect(best.picker.yours.map(\.id) == web.yours.map { key($0.key) })
        #expect(best.picker.yours.map(\.name) == web.yours.map(\.name))
        #expect(best.picker.theirs.map(\.id) == web.theirs.map(\.key))
        #expect(best.decision == web.decision)
        #expect(best.rows.map(TradesParity.Row.init) == web.rows)
        #expect(try model(true).rows.map(TradesParity.Row.init) == web.every)
        let unheld = try #require(web.unheld)
        let none = TradesModel(
            advice: advice, holding: unheld.key, host: TradesParityTests.host, me: TradesParityTests.parity.me,
            every: false, sort: .mine, now: Fixtures.instant(Fixtures.week), zone: Fixtures.zone
        )
        #expect(none.decision == unheld.decision)
        #expect(none.noneHolding)
        #expect(none.strip == nil)
        #expect(none.rows.isEmpty)
    }

    @Test func theBuilderFromTheBestTradeIsTheWebs() throws {
        let web = Self.parity.builder
        let advice = try Fixtures.trades(Fixtures.week)
        let picks = TradePicks(team: web.picks.team, give: web.picks.give, get: web.picks.get)
        let model = try TradeBuilder.model(.init(
            advice: TradeFinder.held(advice, now: Fixtures.instant(Fixtures.week)), picks: picks,
            answer: Self.check(), problem: nil, me: TradeMe(name: TradesParityTests.parity.me, aside: ""),
            pageKnown: true, zone: Fixtures.zone, now: Fixtures.instant(Fixtures.week)
        ))
        #expect(model.teams.map(\.id) == web.teams.map(\.rosterId))
        #expect(model.teams.map(\.choice) == web.teams.map(\.choice))
        #expect(model.sentence == web.sentence)
        #expect(model.close == web.close)
        #expect(model.own == web.own)
        #expect(BuilderParity.Box(model.yours) == web.yours)
        let theirs = try #require(model.theirs)
        #expect(BuilderParity.Box(theirs) == web.theirs)
        #expect(theirs.aside == web.theirs.aside)
        guard case let .gains(mine, rest) = model.pin else {
            throw BuilderParity.Missing.pin
        }
        #expect(web.pin == "\(mine) \(rest)")
        #expect(model.verbEnabled)
    }
}

/// The fix round's part of shared/fixtures/parity/trades.json.
struct BuilderParity: Decodable {
    enum Missing: Error {
        case pin
    }

    struct Fills: Decodable {
        let yours: Bool
        let theirs: Bool
        let yoursOpen: String?
        let theirsOpen: String?
        let yoursRoom: Bool
        let theirsRoom: Bool

        enum CodingKeys: String, CodingKey {
            case yours, theirs
            case yoursOpen = "yours_open"
            case theirsOpen = "theirs_open"
            case yoursRoom = "yours_room"
            case theirsRoom = "theirs_room"
        }
    }

    struct Edit: Decodable {
        let name: String
        let myGain: Double
        let theirGain: Double
        let fills: Fills
        let keepDrop: Bool
        let dropReason: String?
        let perGame: Bool
        let sentence: String
        /// The edited check's acceptable and rest of season (Lane 277); nil for an older answer.
        let acceptable: Acceptable?
        let rest: Rest?
        let refusal: String?

        struct Acceptable: Decodable {
            let yours: Bool
            let theirs: Bool
        }

        struct Rest: Decodable {
            let yours: Double
            let theirs: Double
        }

        /// The fixture's check with this edit, as trades-parity.ts editedCheck makes it.
        func applied(to check: TradeCheck) -> TradeCheck {
            var edited = check
            edited.fills = .init(
                yours: fills.yours, theirs: fills.theirs, yoursOpen: fills.yoursOpen, theirsOpen: fills.theirsOpen,
                yoursRoom: fills.yoursRoom, theirsRoom: fills.theirsRoom
            )
            var trade = check.trade.value1
            trade.myGain = myGain
            trade.theirGain = theirGain
            trade.drop = keepDrop ? trade.drop : nil
            trade.dropReason = dropReason
            if !perGame {
                trade.give = trade.give.map(Self.unfigured)
                trade.get = trade.get.map(Self.unfigured)
            }
            trade.myRestOfSeason = rest?.yours
            trade.theirRestOfSeason = rest?.theirs
            edited.trade = .init(value1: trade)
            edited.acceptable = acceptable.map { .init(value1: .init(yours: $0.yours, theirs: $0.theirs)) }
            return edited
        }

        static func unfigured(_ line: PlayerLine) -> PlayerLine {
            var line = line
            line.restOfSeasonPerGame = nil
            return line
        }
    }

    struct Title: Decodable {
        let count: Int
        let title: String
    }

    struct Prompt: Decodable {
        let give: Int
        let get: Int
        let prompt: String
    }

    struct Words: Decodable {
        let checks: [Edit]
        let noTrade: String
        let under: String
        let titles: [Title]
        let noTradeWith: String
        let prompts: [Prompt]
    }

    struct Option: Decodable {
        let key: String
        let name: String
    }

    struct Unheld: Decodable {
        let key: String
        let decision: String
    }

    struct Holding: Decodable {
        let yours: [Option]
        let theirs: [Option]
        let player: String
        let decision: String
        let rows: [TradesParity.Row]
        let every: [TradesParity.Row]
        let unheld: Unheld?
    }

    struct Row: Decodable, Equatable {
        let cells: LineupParity.Row
        let season: String
        let line: String
        let pick: String

        init(_ row: BuilderRow) {
            cells = LineupParity.Row(row.cells)
            season = row.cells.season
            line = row.line
            switch row.tick {
            case .picked: pick = "on"
            case let .open(disabled): pick = disabled ? "off-full" : "off"
            case .none: pick = "no"
            case .drop: pick = "drop"
            }
        }

        init(from decoder: any Decoder) throws {
            cells = try LineupParity.Row(from: decoder)
            let values = try decoder.container(keyedBy: Keys.self)
            season = try values.decode(String.self, forKey: .season)
            line = try values.decode(String.self, forKey: .line)
            pick = try values.decode(String.self, forKey: .pick)
        }

        enum Keys: String, CodingKey {
            case season, line, pick
        }
    }

    struct Box: Decodable, Equatable {
        let team: String
        let holds: String
        let rows: [Row]

        init(_ box: BuilderBox) {
            team = box.team
            holds = box.holds
            rows = box.rows.map(Row.init)
        }
    }

    struct TheirBox: Decodable {
        let team: String
        let aside: String
        let holds: String
        let rows: [Row]
    }

    struct Picks: Decodable {
        let team: Int
        let give: [String]
        let get: [String]
    }

    struct Team: Decodable {
        let rosterId: Int
        let choice: String
    }

    struct Builder: Decodable {
        let picks: Picks
        let teams: [Team]
        let sentence: String
        let close: String?
        let own: String
        let yours: Box
        let theirs: TheirBox
        let pin: String
    }

    let words: Words
    let holding: Holding
    let builder: Builder
}

extension BuilderParity.Box {
    static func == (lhs: BuilderParity.Box, rhs: BuilderParity.TheirBox) -> Bool {
        lhs.team == rhs.team && lhs.holds == rhs.holds && lhs.rows == rhs.rows
    }
}
