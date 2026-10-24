import CommishCore
import CommishDesign
import SwiftUI

/// The member's lineup as set on the platform (web LineupSummary.svelte): the starters, the team's
/// points, the bench as a count, and the quiet verb that opens the Lineup.
struct LineupSummaryView: View {
    @Environment(\.colorScheme) private var colorScheme
    let section: LineupSection
    let openLineup: () -> Void

    private var columns: [BoxColumn] {
        [
            BoxColumn(id: "player", title: section.columns[0], width: .flex, numeric: false),
            BoxColumn(id: "pts", title: section.columns[1], width: .fixed(56), numeric: true),
        ]
    }

    private var rows: [BoxRow] {
        section.rows.map { line in
            BoxRow(id: line.id, cells: [
                BoxCell(line.name, tone: .strong, sub: line.detail, face: line.initials),
                BoxCell(line.points),
            ])
        } + [
            BoxRow(
                id: "team",
                cells: [BoxCell(PortedWords.Box.totals, tone: .strong), BoxCell(section.total, tone: .strong)]
            ),
        ]
    }

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            HStack(alignment: .firstTextBaseline) {
                SectionHead(section.title, aside: section.setOn)
                QuietButton(section.verb, action: openLineup)
            }
            BoxTable(columns: columns, rows: rows)
            Text(section.bench)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .medium))
                .foregroundStyle(theme.color(Tokens.Color.ink2))
        }
        .padding(.horizontal, Tokens.Space.s4)
    }
}
