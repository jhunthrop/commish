import CommishAPI
import CommishCore
import CommishDesign
import Foundation
@testable import Rankings
import RunFixtures
import SwiftUI
import Testing

/// Review H1: every pill the order prints, a three-digit rank among them ("WR 149"), fits the row's
/// pill slot whole, so no rank is cut and the club column starts at one x down the list. Every read
/// the fixture holds, at both clocks, through the model the screen draws.
@MainActor
struct RankingsPillTests {
    static let zone = TimeZone(identifier: "America/Chicago")!

    /// One of the fixture's reads: the file part, the chip it was read for, the search and the clock.
    struct Read {
        let part: String
        let chip: RankingsChip?
        var query = ""
        var clock = RankingsFixture.week
    }

    static let reads = [
        Read(part: "", chip: nil), Read(part: "-QB", chip: .quarterback), Read(part: "-RB", chip: .runningBack),
        Read(part: "-WR", chip: .receiver), Read(part: "-TE", chip: .tightEnd),
        Read(part: "-q-wa", chip: nil, query: "wa"), Read(part: "-WR-q-wa", chip: .receiver, query: "wa"),
        Read(part: "", chip: nil, clock: RankingsFixture.sunday),
    ]

    static func pills() throws -> [String] {
        try reads.flatMap { read in
            let advice = try RankingsFixture.order(read.part, at: read.clock)
            let now = APIDecoding.parseDate(read.clock.replacingOccurrences(
                of: #"T(\d\d)-(\d\d)-(\d\d)Z"#, with: "T$1:$2:$3Z", options: .regularExpression
            )) ?? Date(timeIntervalSince1970: 0)
            let model = RankingsModel(
                advice: advice, chip: read.chip, query: read.query, inSeason: true, zone: zone, now: now
            )
            return model.rows.compactMap(\.player.pill)
        }
    }

    /// The pill's drawn width at 1x, as the row lays it out.
    static func width(_ pill: String) -> Double {
        let renderer = ImageRenderer(content: PositionPill(pill, minWidth: RankingsColumn.pillLeast).fixedSize())
        renderer.scale = 1
        return Double(renderer.cgImage?.width ?? .max)
    }

    @Test func theFixtureReachesAThreeDigitRank() throws {
        #expect(try Self.pills().contains { $0.range(of: #"\d{3}$"#, options: .regularExpression) != nil })
    }

    @Test func everyPillFitsItsSlotWhole() throws {
        let pills = try Set(Self.pills())
        #expect(!pills.isEmpty)
        let cut = pills.filter { Self.width($0) > RankingsColumn.pill }.sorted()
        #expect(cut.isEmpty, "wider than the \(RankingsColumn.pill) pt slot: \(cut.map { "\($0) \(Self.width($0))" })")
    }
}
