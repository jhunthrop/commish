import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// The Board's words and figures held to the web's (shared/fixtures/parity/board.json): boardWords for
/// every rail, view, league state and cover; a row's Projected, Over repl. and Gap as the phone prints
/// them; and the capture's few words in the basis.
struct BoardParityTests {
    struct Parity: Decodable {
        struct Words: Decodable, Equatable {
            let bar: String
            let title: String
            let heading: String
            let verb: String?
        }

        struct WordsCase: Decodable {
            let rail: String
            let position: String?
            let following: Bool
            let rosFromWeek: Int?
            let words: Words
        }

        struct Figure: Decodable {
            let value: Double
            let projected: String
            let overReplacement: String
            let gap: String
        }

        struct Capture: Decodable {
            let readAt: String
            let checkedAt: String?
            let now: String
            let text: String
        }

        let season: Int
        let label: String
        let words: [WordsCase]
        let figures: [Figure]
        let noGap: String
        let zone: String
        let captures: [Capture]
    }

    static let parity: Parity = {
        do {
            return try JSONDecoder().decode(Parity.self, from: Fixtures.data("fixtures/parity/board.json"))
        } catch {
            preconditionFailure("shared/fixtures/parity/board.json does not read: \(error)")
        }
    }()

    @Test func everyRailsWordsForTheBoardAreTheWebs() {
        let parity = Self.parity
        #expect(parity.words.count > 40)
        for item in parity.words {
            let inSeason = item.rail == "in_season" || item.rail.hasPrefix("playoffs")
            let cover = BoardCover(
                season: parity.season, label: parity.label, position: item.position,
                restOfSeason: item.rosFromWeek != nil
            )
            let words = BoardWords.of(inSeason: inSeason, cover: cover, following: item.following)
            let said = Parity.Words(
                bar: words.bar,
                title: words.title,
                heading: words.heading,
                verb: words.verb?.rawValue
            )
            #expect(
                said == item.words,
                "\(item.rail) \(item.position ?? "All") \(item.following) \(String(describing: item.rosFromWeek))"
            )
        }
    }

    @Test func aRowsFiguresPrintAsTheWebsDo() {
        for figure in Self.parity.figures {
            #expect(BoardFigures.projected(figure.value) == figure.projected, "\(figure.value)")
            #expect(BoardFigures.signed(figure.value) == figure.overReplacement, "\(figure.value)")
            #expect(BoardFigures.gap(figure.value) == figure.gap, "\(figure.value)")
        }
        #expect(BoardFigures.gap(nil) == Self.parity.noGap)
    }

    @Test func theCapturesFewWordsAreTheWebs() throws {
        let zone = try #require(TimeZone(identifier: Self.parity.zone))
        for capture in Self.parity.captures {
            let said = try BoardWords.capture(
                asOf: #require(APIDecoding.parseDate(capture.readAt)),
                checkedAt: capture.checkedAt.flatMap(APIDecoding.parseDate),
                now: #require(APIDecoding.parseDate(capture.now)),
                zone: zone
            )
            #expect(said == capture.text)
        }
    }

    @Test func aPlayersPageIsNamedByTheSitesSlugRule() {
        #expect(PlayerPages.slug("Ja'Marr Chase") == "ja-marr-chase")
        #expect(PlayerPages.slug("Amon-Ra St. Brown") == "amon-ra-st-brown")
        #expect(PlayerPages.slug("Luther Burden III") == "luther-burden-iii")
        #expect(PlayerPages.slug("Zoë Núñez") == "zoe-nunez")
        #expect(PlayerPages.unshared(["Mike Williams", "Mike Williams", "Ja'Marr Chase"]) == ["ja-marr-chase"])
    }
}
