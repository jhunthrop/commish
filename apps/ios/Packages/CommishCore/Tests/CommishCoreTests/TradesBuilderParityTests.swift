import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import Testing

/// The Trades' builder and built sentences held to the web (shared/fixtures/parity/trades.json, Lane
/// 189 fix round 1, Lane 277): every checkWords branch over the fixture's check edited as
/// builder.test.ts edits one with its refusal and cells, the builder's prompts, and the builder at the
/// Best idea's ticks with its check (both rosters with their ticks, the answer line, the pin), a
/// refusal in the pin, a stale answer, and no team chosen.
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
            #expect(TradesParity.Rest(TradeRest.of(edited, mine: true)) == edit.cells.yours, "\(edit.name)")
            #expect(TradesParity.Rest(TradeRest.of(edited, mine: false)) == edit.cells.theirs, "\(edit.name)")
        }
        // Lane 277: each side that would not take it leads its line.
        #expect(Self.parity.words.checks.contains { $0.refusal == Words.Trades.theyGiveUp })
        #expect(Self.parity.words.checks.contains { $0.refusal == Words.Trades.youGiveUp })
        #expect(Self.parity.words.checks.contains { $0.refusal == Words.Trades.bothGiveUp })
    }

    @Test func thePromptsAreTheWebs() {
        for prompt in Self.parity.words.prompts {
            let picks = TradePicks(
                team: 1, give: (0 ..< prompt.give).map { "g\($0)" }, get: (0 ..< prompt.get).map { "t\($0)" }
            )
            #expect(TradeBuilder.prompt(picks) == prompt.prompt)
        }
    }

    static func builder(_ picks: TradePicks, answer: TradeCheck?, answered: TradePicks?) throws -> TradeBuilderModel {
        let advice = try Fixtures.trades(Fixtures.week)
        let now = Fixtures.instant(Fixtures.week)
        return try TradeBuilder.model(.init(
            advice: TradeFinder.held(advice, now: now), ideas: TradesParityTests.model(Fixtures.week).ideas,
            allIdeas: false, picks: picks, answer: answer, answered: answered, problem: nil,
            me: TradeMe(name: TradesParityTests.parity.me, aside: ""), pageKnown: true, zone: Fixtures.zone,
            now: now
        ))
    }

    /// The Best idea loads the web's builder picks, and the builder at them with its check is the web's:
    /// the team choices, the answer line, both rosters with their ticks, the cells, the pin.
    @Test func theBestIdeaLoadsTheWebsBuilder() throws {
        let web = Self.parity.builder
        let picks = TradePicks(team: web.picks.team, give: web.picks.give, get: web.picks.get)
        let ideas = try TradesParityTests.model(Fixtures.week).ideas
        guard case let .idea(best) = try #require(ideas.places.first) else {
            throw BuilderParity.Missing.pin
        }
        #expect(best.picks.same(picks))
        let model = try Self.builder(picks, answer: Self.check(), answered: picks)
        #expect(model.pressed == best.id)
        #expect(model.teams.map(\.id) == web.teams.map(\.rosterId))
        #expect(model.teams.map(\.choice) == web.teams.map(\.choice))
        #expect(model.sentence == web.sentence)
        #expect(model.close == web.close)
        #expect(model.own == web.own)
        #expect(TradesParity.Rest(model.bug.yours.rest) == web.rest.yours)
        #expect(TradesParity.Rest(model.bug.theirs.rest) == web.rest.theirs)
        #expect(BuilderParity.Box(model.yours) == web.yours)
        #expect(BuilderParity.Box(model.theirs) == web.theirs)
        #expect(model.theirs.aside == web.theirs.aside)
        #expect(model.rosters == RosterSwitch(yours: "You, 1", theirs: "\(web.theirs.team), 2"))
        guard case let .gains(mine, rest) = model.pin else {
            throw BuilderParity.Missing.pin
        }
        #expect(web.pin == "\(mine) \(rest)")
        #expect(model.live)
        #expect(model.verbEnabled)
    }

    /// Lane 277: where a side would not take it, the pin says why in place of the gains, as the web's
    /// pin; an answer for other ticks is drawn but no verb acts on it (builder.ts proposable).
    @Test func aRefusalTakesThePinAndAStaleAnswerHoldsTheVerbs() throws {
        let web = Self.parity.builder
        let picks = TradePicks(team: web.picks.team, give: web.picks.give, get: web.picks.get)
        let base = try Self.check()
        for edit in Self.parity.words.checks {
            let edited = edit.applied(to: base)
            let model = try Self.builder(picks, answer: edited, answered: picks)
            if TradeChecks.fillsBoth(edited), let refusal = edit.refusal {
                #expect(model.pin == .words(refusal), "\(edit.name)")
            } else if !TradeChecks.fillsBoth(edited) {
                #expect(model.pin == .words(edit.sentence), "\(edit.name)")
                #expect(!model.live, "\(edit.name)")
            }
        }
        let other = picks.tapped(.get, web.picks.get[0])
        let stale = try Self.builder(other, answer: base, answered: picks)
        #expect(!stale.live)
        #expect(stale.pressed == nil)
    }

    /// No team chosen: the web's line, their box the choice alone, the switch's "Pick a team".
    @Test func beforeATeamIsChosenTheBuilderSaysPickATeam() throws {
        let model = try Self.builder(TradePicks(team: nil, give: [], get: []), answer: nil, answered: nil)
        #expect(model.sentence == Words.Analyzer.noTeam)
        #expect(model.teamLabel == Words.Analyzer.pickTeam)
        #expect(model.rosters == RosterSwitch(yours: "You", theirs: Words.Analyzer.pickTeam))
        #expect(model.theirs.rows.isEmpty)
        #expect(model.theirs.holds.isEmpty)
        #expect(!model.verbEnabled)
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
        let cells: Cells

        struct Cells: Decodable {
            let yours: TradesParity.Rest
            let theirs: TradesParity.Rest
        }

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

    struct Prompt: Decodable {
        let give: Int
        let get: Int
        let prompt: String
    }

    struct Words: Decodable {
        let checks: [Edit]
        let prompts: [Prompt]
    }

    struct Row: Decodable, Equatable {
        let cells: LineupParity.Row
        let season: String
        let pick: String

        init(_ row: BuilderRow) {
            cells = LineupParity.Row(row.cells)
            season = row.cells.season
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
            pick = try values.decode(String.self, forKey: .pick)
        }

        enum Keys: String, CodingKey {
            case season, pick
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
        let rest: Rests
    }

    struct Rests: Decodable {
        let yours: TradesParity.Rest
        let theirs: TradesParity.Rest
    }

    let words: Words
    let builder: Builder
}

extension BuilderParity.Box {
    static func == (lhs: BuilderParity.Box, rhs: BuilderParity.TheirBox) -> Bool {
        lhs.team == rhs.team && lhs.holds == rhs.holds && lhs.rows == rhs.rows
    }
}
