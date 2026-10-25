import BoxScore
import CommishCore
import CommishDesign
import SwiftUI

/// One team's box (BoxTable.svelte at 390): its name with its face over the columns (Slot, Player, Our
/// rank, Proj, Pts), its starters, the sentence in place of starters the platform does not send, the
/// Team row lit like the bug, then its bench in the same columns. The member's edge in the accent.
struct TeamBoxView: View {
    let box: TeamBox
    let actions: RowActions

    var body: some View {
        TableFrame {
            TeamHeadRow(box: box)
            HeadRow(style: .matchup)
            if let empty = box.empty {
                NoteRow(text: empty)
            }
            ForEach(box.starters) { cells in
                BoxRowView(cells: cells, bench: false, actions: actions, style: .matchup)
            }
            TeamRowView(team: box.teamRow, style: .matchup)
            if !box.bench.isEmpty {
                SectionRow(title: Words.Box.bench)
                ForEach(box.bench) { cells in
                    BoxRowView(cells: cells, bench: true, actions: actions, style: .matchup)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(box.team)
    }
}

/// The box's head: the team's face, its name, "You" on the member's own, over a rule in the accent.
struct TeamHeadRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let box: TeamBox

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(spacing: Tokens.Space.s3) {
            Avatar(box.initials, side: 32, mine: box.mine)
            Text(box.team)
                .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .bold))
                .fixedSize(horizontal: false, vertical: true)
            if box.mine {
                Text(Words.Box.you)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(Tokens.TypeScale.xs * 0.06)
                    .foregroundStyle(theme.color(Tokens.Color.accentText))
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(theme.color(Tokens.Color.ink))
        .padding(Tokens.Space.s3)
        .background(theme.color(Tokens.Color.bg))
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(theme.color(box.mine ? Tokens.Color.accent : Tokens.Color.lineStrong))
                .frame(height: 2)
        }
        .accessibilityAddTraits(.isHeader)
    }
}
