import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import Testing

/// The Trades' port held to the web's builder-first Trades at 390 (shared/fixtures/parity/trades.json,
/// Lanes 260, 268, 277): the ideas row (each idea's mark, team, gains and deal, each team with none and
/// its note, in the row's order), the verb, the platform's note and the builder's basis at all six
/// fixture clocks; each check the fixtures post as the verdict draws it; the line under a pressed verb.
struct TradesParityTests {
    static let parity: TradesParity = {
        do {
            return try JSONDecoder().decode(TradesParity.self, from: Fixtures.data("fixtures/parity/trades.json"))
        } catch {
            preconditionFailure("shared/fixtures/parity/trades.json does not read: \(error)")
        }
    }()

    static let host = Components.Schemas.LeagueHost(value1: .ffpc)

    static func model(_ clock: String) throws -> TradesModel {
        try TradesModel(advice: Fixtures.trades(clock), host: host, now: Fixtures.instant(clock), zone: Fixtures.zone)
    }

    static func web(_ clock: String) throws -> TradesParity.Clock {
        try #require(parity.clocks[clock])
    }

    @Test(arguments: StartParityTests.clocks)
    func theIdeasRowIsTheWebs(clock: String) throws {
        let web = try Self.web(clock)
        let model = try Self.model(clock)
        #expect(model.ideas.head == web.ideas.head)
        #expect(model.ideas.places.map(TradesParity.Place.init) == web.ideas.places, "\(clock)")
        // Best first, the screen opening on its team with nothing ticked.
        let lead = try #require(web.ideas.places.first)
        #expect(lead.mark == Words.Strip.best)
        #expect(model.opening == TradePicks(team: lead.rosterId, give: [], get: []))
    }

    @Test(arguments: StartParityTests.clocks)
    func theBestThreeShowThenTheRestBehindNMore(clock: String) throws {
        let ideas = try Self.model(clock).ideas
        let web = try Self.web(clock).ideas.places
        #expect(ideas.visible(all: false).map(\.id) == web.prefix(TradeIdeas.shown).map(\.key))
        #expect(ideas.more(all: false) == "\(web.count - TradeIdeas.shown) more")
        #expect(ideas.visible(all: true).count == web.count)
        #expect(ideas.more(all: true) == nil)
    }

    @Test(arguments: StartParityTests.clocks)
    func theVerbAndTheBasisAreTheWebs(clock: String) throws {
        let web = try Self.web(clock)
        let model = try Self.model(clock)
        #expect(model.verb == web.verb)
        #expect(model.reason == web.reason)
        #expect(web.basis.builder == "\(model.basis) \(Words.InSeason.orderRecord)")
    }

    @Test(arguments: [Fixtures.week, Fixtures.sunday])
    func everyCheckIsTheWebsVerdict(clock: String) throws {
        let checks = try #require(Self.parity.checks[clock])
        let teams = try TradeFinder.worthProposing(Fixtures.trades(clock).teams).map(\.team.name)
        #expect(checks.count == 2)
        for (index, web) in checks.enumerated() {
            let check = try TradeChecks.held(Fixtures.tradeCheck(clock, index + 1), now: Fixtures.instant(clock))
            let ours = TradesParity.Check(check, me: Self.parity.me, team: teams[index])
            #expect(ours == web, "\(clock) \(index + 1)")
        }
    }

    @Test func theFixtureDropsEveryIdeaWithATeam() throws {
        let none = try Self.model(Fixtures.week).ideas.places.filter {
            if case .none = $0 {
                return true
            }
            return false
        }
        #expect(!none.isEmpty)
    }

    @Test func theLineUnderAPressedVerbIsTheWebs() {
        #expect(TradesWords.copied(true, platform: "FFPC").words == Self.parity.copied.done)
        #expect(TradesWords.copied(false, platform: "FFPC").words == Self.parity.copied.failed)
    }
}

/// shared/fixtures/parity/trades.json, as the web's readers wrote it.
struct TradesParity: Decodable {
    struct Basis: Decodable {
        let builder: String
    }

    struct Clock: Decodable {
        let verb: String
        let reason: String?
        let basis: Basis
        let ideas: Ideas
    }

    /// The builder-first screen's ideas row (Lane 277): each place an idea or a team with none.
    struct Ideas: Decodable {
        let head: String
        let places: [Place]
    }

    struct Place: Decodable, Equatable {
        let kind: String
        let key: String
        let rosterId: Int
        let team: String
        let mark: String?
        let gains: String?
        let deal: String?
        let note: String?

        init(_ place: IdeaPlace) {
            key = place.id
            switch place {
            case let .idea(preset):
                kind = "idea"
                rosterId = preset.rosterId
                team = preset.team
                mark = preset.mark
                gains = preset.gains
                deal = preset.deal
                note = nil
            case let .none(line):
                kind = "none"
                rosterId = line.id
                team = line.team
                mark = nil
                gains = nil
                deal = nil
                note = line.note
            }
        }
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

        /// The check as the verdict and its answer line draw it, held at its clock.
        init(_ check: TradeCheck, me: String, team: String) {
            let bug = TradeBuilder.bug(check, me: me, team: team)
            yours = Side(bug.yours)
            theirs = Side(bug.theirs)
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
