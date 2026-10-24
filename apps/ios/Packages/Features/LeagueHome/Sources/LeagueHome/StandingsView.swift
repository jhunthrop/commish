import CommishCore
import CommishDesign
import SwiftUI

/// The standings as a box score (web Standings.svelte at a phone's width): rank, the team with its face
/// and its streak under the name, W-L-T, PF and the week's Proj; the member's row washed; the playoff
/// rule under the last seed by record, or the platform's seeding said under the table.
struct StandingsView: View {
    let section: StandingsSection

    private var columns: [BoxColumn] {
        let widths: [BoxWidth] = [.fixed(20), .flex, .fixed(48), .fixed(52), .fixed(44)]
        return zip(section.columns, widths).enumerated().map { index, pair in
            BoxColumn(id: "\(index)", title: pair.0, width: pair.1, numeric: index != 1)
        }
    }

    private var rows: [BoxRow] {
        section.rows.map { line in
            let cells = [
                BoxCell(String(line.rank), tone: .muted),
                BoxCell(line.team, tone: .strong, sub: line.streak, face: line.initials),
                BoxCell(line.record),
                BoxCell(line.pointsFor),
                BoxCell(line.proj),
            ]
            return BoxRow(
                id: String(line.rosterID),
                cells: Array(cells.prefix(section.columns.count)),
                mine: line.me,
                ruleBelow: line.rank == section.playoffCut
            )
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            SectionHead(section.title)
            BoxTable(columns: columns, rows: rows)
            if let words = section.playoffWords ?? section.seeding {
                BasisText(words)
            }
        }
        .padding(.horizontal, Tokens.Space.s4)
    }
}
