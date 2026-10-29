import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import Testing

/// The Trades with the finder's newer fields held to the web (shared/fixtures/parity/trades.json's
/// `needs`, Lane 290): the host's offers at the head of the ideas row (each card's label, team, deal,
/// expiry, the ticks it loads or where to answer it), the row's places in the web's order with each
/// idea's fills line, each empty team's line by its reason, the line for every reason and an absent one,
/// the fills words for every slot; an offer lapsing on the injected clock leaves the row.
struct TradesNeedsParityTests {
    static let needs: NeedsParity = {
        do {
            return try JSONDecoder().decode(NeedsFile.self, from: Fixtures.data("fixtures/parity/trades.json")).needs
        } catch {
            preconditionFailure("shared/fixtures/parity/trades.json does not read: \(error)")
        }
    }()

    /// The fixture's answer with the newer fields (export-fixtures.ts needs) at the week's clock.
    static let clock = "needs-\(Fixtures.week)"

    static func advice() throws -> TradeAdvice {
        try Fixtures.trades(clock)
    }

    static func model(at now: Date = Fixtures.instant(Fixtures.week)) throws -> TradesModel {
        try TradesModel(advice: advice(), host: TradesParityTests.host, now: now, zone: Fixtures.zone)
    }

    static func offers(_ ideas: TradeIdeas) -> [OfferPreset] {
        ideas.places.compactMap {
            if case let .offer(offer) = $0 {
                return offer
            }
            return nil
        }
    }

    @Test func theOffersAreTheWebs() throws {
        let ours = try Self.offers(Self.model().ideas).map(NeedsParity.Offer.init)
        #expect(ours == Self.needs.offers)
        #expect(Self.needs.offers.count == 3)
        // One loads; one the builder cannot hold (two defenses) and one naming a taxi player say where.
        #expect(Self.needs.offers.filter { $0.picks == nil }.count == 2)
    }

    @Test func theRowIsTheWebsWithItsFillsLines() throws {
        let places = try Self.model().ideas.places
        let ideas = places.filter {
            if case .offer = $0 {
                return false
            }
            return true
        }
        #expect(ideas.map(TradesParity.Place.init) == Self.needs.ideas.places)
        #expect(Self.needs.ideas.places.contains { $0.fills != nil })
        // The newest offer heads the row, then Best, then the other offers, then the other ideas.
        let offers = Self.needs.offers.map(\.key)
        let keys = Self.needs.ideas.places.map(\.key)
        #expect(places.map(\.id) == [offers[0], keys[0]] + offers.dropFirst() + keys.dropFirst())
        #expect(Self.needs.ideas.places.first?.mark == Words.Strip.best)
    }

    @Test func eachEmptyTeamSaysWhy() throws {
        let advice = try Self.advice()
        for web in Self.needs.empty {
            let team = try #require(advice.teams.first { $0.rosterId == web.rosterId })
            #expect(team.emptyReason?.value1?.rawValue == web.reason)
            #expect(NoIdeaLine.note(team.emptyReason) == web.note)
        }
        #expect(Set(Self.needs.empty.map(\.note)).count == 4)
        for (reason, note) in Self.needs.reasons {
            let payload = Components.Schemas.TradeTeam.EmptyReasonPayload.Value1Payload(rawValue: reason)
                .map { Components.Schemas.TradeTeam.EmptyReasonPayload(value1: $0) }
            #expect(NoIdeaLine.note(payload) == note, "\(reason)")
        }
        #expect(NoIdeaLine.note(nil) == Self.needs.reasons["absent"])
    }

    @Test func theFillsWordsAreTheWebs() {
        for (slot, words) in Self.needs.fills {
            let payload = Components.Schemas.TradeRow.FillsPayload.Value1Payload(rawValue: slot)
                .map { Components.Schemas.TradeRow.FillsPayload(value1: $0) }
            #expect(TradesWords.fills(payload) == words, "\(slot)")
        }
        #expect(TradesWords.fills(nil) == nil)
    }

    /// The newer fields never move the recorded fixtures' row: their places carry no fills line.
    @Test(arguments: StartParityTests.clocks)
    func anOlderAnswerDrawsNoFillsLine(clock: String) throws {
        let places = try TradesParityTests.model(clock).ideas.places.map(TradesParity.Place.init)
        #expect(places.allSatisfy { $0.fills == nil })
    }

    /// An offer whose expiry has passed leaves the row on the injected clock, at a read and at a draw.
    @Test func aLapsedOfferLeavesTheRow() throws {
        let first = try #require(Self.needs.offers.first)
        let ends = try #require(Self.offers(Self.model().ideas).first?.endsAt)
        let later = try Self.model(at: ends)
        #expect(!Self.offers(later.ideas).map(\.id).contains(first.key))
        let drawn = try Self.model().ideas.at(ends)
        #expect(!Self.offers(drawn).map(\.id).contains(first.key))
        #expect(Self.offers(drawn).count == Self.needs.offers.count - 1)
    }

    /// The loadable offer, its ticks held, is the pressed place; an offer the builder cannot hold loads
    /// nothing and is never pressed.
    @Test func anOfferLoadsItsTicksAndIsPressed() throws {
        let model = try Self.model()
        let web = try #require(Self.needs.offers.first { $0.picks != nil })
        let picks = try #require(web.picks)
        let ticks = TradePicks(team: picks.team, give: picks.give, get: picks.get)
        let now = Fixtures.instant(Fixtures.week)
        let builder = try TradeBuilder.model(.init(
            advice: TradeFinder.held(Self.advice(), now: now), ideas: model.ideas, allIdeas: false, picks: ticks,
            answer: nil, answered: nil, problem: nil, me: TradeMe(name: "", aside: ""), pageKnown: true,
            zone: Fixtures.zone, now: now
        ))
        #expect(builder.pressed == web.key)
        #expect(builder.theirs.rows.filter { $0.tick == .picked }.count == picks.get.count)
        let unheld = try #require(Self.needs.offers.first { $0.picks == nil })
        #expect(model.ideas.places.first { $0.id == unheld.key }?.picks == nil)
    }
}

private struct NeedsFile: Decodable {
    let needs: NeedsParity
}

/// trades.json's `needs` (trades-parity.ts needsAt).
struct NeedsParity: Decodable {
    struct Picks: Decodable, Equatable {
        let team: Int
        let give: [String]
        let get: [String]
    }

    struct Offer: Decodable, Equatable {
        let key: String
        let label: String
        let rosterId: Int
        let team: String
        let deal: String
        let expires: String?
        let picks: Picks?
        let note: String?

        init(_ offer: OfferPreset) {
            key = offer.id
            label = offer.label
            rosterId = offer.rosterId
            team = offer.team
            deal = offer.deal
            expires = offer.expires
            picks = offer.picks.map { Picks(team: $0.team ?? 0, give: $0.give, get: $0.get) }
            note = offer.note
        }
    }

    struct Empty: Decodable {
        let rosterId: Int
        let reason: String?
        let note: String
    }

    let offers: [Offer]
    let ideas: TradesParity.Ideas
    let empty: [Empty]
    let reasons: [String: String]
    let fills: [String: String]
}
