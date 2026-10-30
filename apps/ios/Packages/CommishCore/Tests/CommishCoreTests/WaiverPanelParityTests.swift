@testable import CommishCore
import CommishDesign
import Foundation
import Testing

/// shared/fixtures/parity/waivers.json's `panel` on each screen, as the web's PositionPanel draws it
/// (positions.ts, Lane 291): for each figure the toggle reads, the line under the cards, each card's words,
/// its ranked list, each free agent's Beats words and what his Add does; null on an answer without the panel.
struct WaiverPanelParity: Decodable {
    struct Mine: Decodable, Equatable {
        let name: String
        let team: String
        let mark: String
        let figure: String
    }

    struct Free: Decodable, Equatable {
        let key: String
        let name: String
        let team: String
        let mark: String
        let figure: String
        let beats: String?
        let verb: String
        let move: String?
    }

    struct Card: Decodable, Equatable {
        let key: String
        let rank: String
        let figure: String
        let median: String?
        let need: String?
        let mine: [Mine]
        let free: [Free]
    }

    struct Mode: Decodable {
        let explain: String
        let cards: [Card]
    }

    struct Panel: Decodable {
        let figures: String
        let season: Mode
        let week: Mode?
    }

    struct Screen: Decodable {
        let panel: Panel?
    }

    struct Wrapped: Decodable {
        let screen: Screen
    }

    let clocks: [String: Screen]
    let espn: [String: Wrapped]
    let narrowed: [String: Screen]
    let stashed: [String: Wrapped]

    func screen(_ name: String) -> Screen? {
        clocks[name] ?? espn[name]?.screen ?? narrowed[name] ?? stashed[name]?.screen
    }
}

struct WaiverPanelParityTests {
    static let parity: WaiverPanelParity = {
        do {
            return try JSONDecoder().decode(
                WaiverPanelParity.self, from: Fixtures.data("fixtures/parity/waivers.json")
            )
        } catch {
            preconditionFailure("shared/fixtures/parity/waivers.json does not read: \(error)")
        }
    }()

    static func drawn(_ model: WaiverModel, _ mode: PanelMode) -> [WaiverPanelParity.Card] {
        model.panel(mode).map { card in
            WaiverPanelParity.Card(
                key: card.key, rank: card.rank, figure: card.figure, median: card.median,
                need: card.need ? Words.WaiverPanel.need : nil,
                mine: card.mine.map { .init(name: $0.name, team: $0.team, mark: $0.mark, figure: $0.figure) },
                free: card.free.map { entry in
                    .init(
                        key: entry.key, name: entry.name, team: entry.team, mark: entry.mark, figure: entry.figure,
                        beats: entry.beats, verb: Words.InSeason.add,
                        move: entry.pool.map { model.panelVerb($0.source) }
                    )
                }
            )
        }
    }

    @Test(arguments: WaiverParityTests.screens)
    func thePanelIsTheWebs(name: String) throws {
        let screen = try #require(Self.parity.screen(name))
        let model = try WaiverParityTests.model(name)
        guard let web = screen.panel else {
            #expect(model.panel(.season).isEmpty)
            #expect(!model.panelHasWeek)
            return
        }
        let season = Self.drawn(model, .season)
        #expect(season == web.season.cards)
        #expect(WaiverPanel.explain(.season, cards: model.panel(.season)) == web.season.explain)
        #expect(model.panelHasWeek == (web.week != nil))
        if let week = web.week {
            #expect(Self.drawn(model, .week) == week.cards)
            #expect(WaiverPanel.explain(.week, cards: model.panel(.week)) == week.explain)
        }
    }

    @Test
    func everyStateIsHeld() {
        let screens = WaiverParityTests.screens.compactMap { Self.parity.screen($0)?.panel }
        let cards = screens.flatMap { [$0.season] + ($0.week.map { [$0] } ?? []) }.flatMap(\.cards)
        // A card with no figure, a list with no free agent, a Need, a week the toggle reads, and an answer
        // without the panel are each in the fixture, so the test above holds each state.
        #expect(cards.contains { $0.median == nil && $0.rank.hasSuffix(Words.Box.none) })
        #expect(cards.contains { $0.free.isEmpty })
        #expect(cards.contains { $0.need != nil })
        #expect(screens.contains { $0.week != nil } && screens.contains { $0.week == nil })
        #expect(WaiverParityTests.screens.contains { Self.parity.screen($0)?.panel == nil })
    }
}
