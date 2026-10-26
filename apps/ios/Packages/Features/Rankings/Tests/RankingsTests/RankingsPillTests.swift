import BoxScore
import CommishAPI
import CommishCore
import CommishDesign
import CommishSnapshotSupport
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
        try rows().compactMap(\.player.pill)
    }

    /// Every row of every read, through the model the screen draws.
    static func rows() throws -> [RankingsRow] {
        try reads.flatMap { read in
            let advice = try RankingsFixture.order(read.part, at: read.clock)
            let now = APIDecoding.parseDate(read.clock.replacingOccurrences(
                of: #"T(\d\d)-(\d\d)-(\d\d)Z"#, with: "T$1:$2:$3Z", options: .regularExpression
            )) ?? Date(timeIntervalSince1970: 0)
            let model = RankingsModel(
                advice: advice, chip: read.chip, query: read.query, inSeason: true, zone: zone, now: now
            )
            return model.rows
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

    /// The web's name room at 375 pt: the name column measured in Lane 209's after shot at 390
    /// (`players-390-dark.png`: the name at x 88, the pill at x 234, 146 pt) less the 15 pt the row
    /// gives up at 375 (re-review M-A).
    static let webNameRoomAt375: Double = 131

    /// The name's room on the SE's first line: the phone less the screen's gutters and the row's
    /// padding, less the line's fixed columns (the #, the face, the pill's slot, the club, Projected).
    static var nameRoomOnSE: Double {
        let row = SnapshotDevice.iPhoneSE.width - 2 * Tokens.Space.s3 - 2 * Tokens.Space.s2
        let fixed = RankingsColumn.rank + Tokens.Space.s2 + RankingsColumn.face + Tokens.Space.s2
            + RankingsColumn.pill + Tokens.Space.s1 + RankingsColumn.club + RankingsColumn.total
        return row - fixed
    }

    static func nameWidth(_ name: String) -> Double {
        FigureWidth.of(name, face: .ui, size: Tokens.TypeScale.md, weight: .semibold)
    }

    @Test func everyProjectedFitsItsColumnWithTheGapBeforeIt() throws {
        let room = RankingsColumn.total - FigureStrip.gap
        let wide = try Self.rows().map(\.total).filter {
            FigureWidth.of($0, face: .num, size: Tokens.TypeScale.md, weight: .bold) > room
        }
        #expect(wide.isEmpty, "wider than \(room) pt: \(wide)")
    }

    /// Re-review M-A: every fixture name the web keeps whole at 375 is whole on the SE.
    @Test func everyNameTheWebKeepsWholeIsWholeOnTheSE() throws {
        let names = try Set(Self.rows().map(\.player.name))
        let webWhole = names.filter { Self.nameWidth($0) <= Self.webNameRoomAt375 }
        #expect(webWhole.contains("Davante Adams"))
        let cut = webWhole.filter { Self.nameWidth($0) > Self.nameRoomOnSE }.sorted()
        #expect(cut.isEmpty, "the SE's \(Self.nameRoomOnSE) pt shortens \(cut)")
    }
}
