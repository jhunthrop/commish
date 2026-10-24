import CommishDesign
import CommishSnapshotSupport
import Foundation
import SwiftUI
import Testing

/// The primitives side by side in both themes: the mark, the pills, a box table with the member's
/// row and a playoff rule. A change to a token or a primitive shows here before it shows on a screen.
@MainActor
struct SpecimenSnapshotTests {
    static let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("__Snapshots__")

    @Test(arguments: [Scheme.light, Scheme.dark])
    func specimen(scheme: Scheme) throws {
        let image = try #require(Snapshot.render(Specimen(), device: .iPhoneSE, scheme: scheme))
        let result = Snapshot.verify(image, named: "specimen-\(scheme)", in: Self.folder)
        #expect(result.matches, "\(result.message)")
    }
}

private struct Specimen: View {
    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            HStack(spacing: Tokens.Space.s4) {
                Mark(side: 64)
                Mark(side: 24)
                Pill("Final")
                Pill("Kicked off", tone: .accent)
                Pill("W5", tone: .gain)
                Pill("L2", tone: .loss)
            }
            BoxTable(
                columns: [
                    BoxColumn(id: "rank", title: "#", width: .fixed(20), numeric: true),
                    BoxColumn(id: "team", title: "Team", width: .flex, numeric: false),
                    BoxColumn(id: "record", title: "W-L-T", width: .fixed(52), numeric: true),
                    BoxColumn(id: "pf", title: "PF", width: .fixed(56), numeric: true),
                ],
                rows: [
                    BoxRow(
                        id: "1",
                        cells: [.init("1"), .init("Muttdogs", tone: .strong), .init("5-0-0"), .init("818.2")]
                    ),
                    BoxRow(
                        id: "2",
                        cells: [.init("2"), .init("Your team", tone: .strong), .init("4-1-0"), .init("790.4")],
                        mine: true,
                        ruleBelow: true
                    ),
                    BoxRow(
                        id: "3",
                        cells: [.init("3"), .init("Third", tone: .strong), .init("1-4-0"), .init("611.0", tone: .muted)]
                    ),
                ]
            )
        }
        .padding(Tokens.Space.s4)
    }
}
