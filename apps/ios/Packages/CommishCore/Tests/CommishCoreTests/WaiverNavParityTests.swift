@testable import CommishCore
import CommishDesign
import Foundation
import Testing

/// shared/fixtures/parity/waivers.json's `nav` on each screen, as the web's Waivers navigates by its
/// position cards (position-nav.ts, Lane 305): the card it opens on, whether the toggle is drawn, and for
/// each figure the toggle reads the row of cards, the lead and the member's players at every card and the
/// list's sort; then the page's rows at each card until the position's own read lands.
struct WaiverNavParity: Decodable {
    struct Meter: Decodable {
        let share: Double
        let under: Bool
    }

    struct Card: Decodable {
        let key: String
        let word: String
        let place: String?
        let figure: String?
        let foot: String?
        let tag: String?
        let need: Bool
        let pickup: Bool
        let waits: String?
        let meter: Meter?
    }

    struct Lead: Decodable, Equatable {
        let head: String
        let words: String?
    }

    struct Yours: Decodable, Equatable {
        let key: String
        let name: String
        let rest: Double?
        let role: String
        let starts: Bool
    }

    struct Sort: Decodable, Equatable {
        let key: String
        let down: Bool
    }

    struct Mode: Decodable {
        let explain: String
        let sort: Sort
        let cards: [Card]
        let leads: [String: Lead]
        let yours: [String: [Yours]]
    }

    struct Rows: Decodable, Equatable {
        let rows: [String]
        let stash: [String]
    }

    struct Nav: Decodable {
        let opening: String
        let hasWeek: Bool
        let season: Mode
        let week: Mode?
        let atPosition: [String: Rows]
    }

    struct Screen: Decodable {
        let nav: Nav
    }

    struct Wrapped: Decodable {
        let screen: Screen
    }

    let clocks: [String: Screen]
    let espn: [String: Wrapped]
    let narrowed: [String: Screen]
    let stashed: [String: Wrapped]

    func nav(_ name: String) -> Nav? {
        (clocks[name] ?? espn[name]?.screen ?? narrowed[name] ?? stashed[name]?.screen)?.nav
    }
}

struct WaiverNavParityTests {
    static let parity: WaiverNavParity = {
        do {
            return try JSONDecoder().decode(WaiverNavParity.self, from: Fixtures.data("fixtures/parity/waivers.json"))
        } catch {
            preconditionFailure("shared/fixtures/parity/waivers.json does not read: \(error)")
        }
    }()

    static func expectCard(_ drawn: NavCard, _ web: WaiverNavParity.Card) {
        #expect(drawn.key == web.key)
        #expect(drawn.word == web.word, "\(web.key)")
        #expect(drawn.place == web.place, "\(web.key)")
        #expect(drawn.figure == web.figure, "\(web.key)")
        #expect(drawn.foot == web.foot, "\(web.key)")
        #expect(drawn.tag == web.tag, "\(web.key)")
        #expect(drawn.need == web.need, "\(web.key)")
        #expect(drawn.pickup == web.pickup, "\(web.key)")
        #expect(drawn.waits == web.waits, "\(web.key)")
        #expect(drawn.meter?.under == web.meter?.under, "\(web.key)")
        #expect(abs((drawn.meter?.share ?? -1) - (web.meter?.share ?? -1)) < 1e-9, "\(web.key)")
    }

    static func expectMode(_ model: WaiverModel, _ mode: PanelMode, _ web: WaiverNavParity.Mode) {
        #expect(mode.explain == web.explain)
        let sort = WaiverNav.sort(mode)
        #expect(WaiverNavParity.Sort(key: sort.key.rawValue, down: sort.down) == web.sort)
        let cards = model.nav(mode)
        #expect(cards.map(\.key) == web.cards.map(\.key))
        for (drawn, card) in zip(cards, web.cards) {
            expectCard(drawn, card)
        }
        for card in cards {
            let lead = model.lead(card.key, mode: mode)
            #expect(WaiverNavParity.Lead(head: lead.head, words: lead.words) == web.leads[card.key], "\(card.key)")
            let yours = model.yours(card.key, mode: mode).map {
                WaiverNavParity.Yours(
                    key: $0.key,
                    name: $0.cells.row.name,
                    rest: $0.rest,
                    role: $0.role,
                    starts: $0.starts
                )
            }
            #expect(yours == web.yours[card.key], "\(card.key)")
        }
    }

    @Test(arguments: WaiverParityTests.screens)
    func theCardsAreTheWebs(name: String) throws {
        let web = try #require(Self.parity.nav(name))
        let model = try WaiverParityTests.model(name)
        #expect(model.opening == web.opening)
        #expect(model.navHasWeek == web.hasWeek)
        Self.expectMode(model, .season, web.season)
        #expect((web.week != nil) == web.hasWeek)
        if let week = web.week {
            Self.expectMode(model, .week, week)
        }
        for (key, rows) in web.atPosition {
            let here = WaiverNav.atPosition(model.advice, key: key)
            #expect(here.rows.map(WaiverRows.key) == rows.rows, "\(key)")
            #expect((here.stash ?? []).map(WaiverRows.key) == rows.stash, "\(key)")
        }
    }

    /// The fixture holds each state the cards draw, so the test above holds each: opening on the weakest
    /// Need and on All, a Need, the D/ST card ranking this week's Proj on Rest of season and waiting with
    /// neither, a week the toggle reads and none, the member's players, and an answer without the panel
    /// navigating by count cards.
    @Test
    func everyStateIsHeld() {
        let navs = WaiverParityTests.screens.compactMap { Self.parity.nav($0) }
        let cards = navs.flatMap(\.season.cards)
        #expect(navs.contains { $0.opening == "TE" } && navs.contains { $0.opening == WaiverNav.all })
        #expect(cards.contains { $0.need })
        #expect(cards.contains { $0.key == "DEF" && $0.tag == Words.WaiverNav.weekTag })
        #expect(cards.contains { $0.waits == Words.WaiverNav.waits && $0.place == nil && $0.figure == nil })
        #expect(navs.contains { $0.hasWeek } && navs.contains { !$0.hasWeek })
        #expect(navs.contains { $0.season.leads["DEF"]?.words == WaiverNav.swapped("D/ST") })
        #expect(navs.contains { $0.season.leads["TE"]?.words == Words.WaiverPanel.needSays })
        #expect(navs.contains { ($0.season.yours["QB"]?.count ?? 0) > 1 })
        #expect(navs.contains { nav in nav.season.cards.count > 1 && nav.season.cards.allSatisfy { $0.meter == nil } })
        // No card, on either toggle, prints a bare "--" in any field.
        let every = navs.flatMap { $0.season.cards + ($0.week?.cards ?? []) }
        let none: String? = Words.Box.none
        let fields = every.flatMap { card -> [String?] in [card.place, card.figure, card.foot, card.tag, card.waits] }
        #expect(!fields.contains(none))
    }

    /// The words the port builds are the web's (position-nav.ts NAV's functions).
    @Test
    func theBuiltWordsAreTheWebs() {
        #expect(WaiverNav.yours("TE") == "Your TE")
        #expect(WaiverNav.freeAt("TE") == "Free at TE")
        #expect(WaiverNav.swapped("K") == "K has no rest-of-season order, so its card ranks this week's Proj.")
        #expect(WaiverNav.firstRead("TE") == "Showing the first read's players at TE.")
    }
}
