import CommishCore
import CommishDesign
import SwiftUI

/// The league's moves as a feed (web MovesFeed.svelte at a phone's width): each move stacks its kind,
/// its team and its time, then its players in and out, a claim's bid; the member's own washed.
struct MovesFeedView: View {
    @Environment(\.colorScheme) private var colorScheme
    let section: MovesSection

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            SectionHead(section.title, aside: section.aside)
            if let note = section.note {
                BasisText(note)
            }
            VStack(spacing: 0) {
                ForEach(section.rows) { row in
                    Rectangle().fill(theme.color(Tokens.Color.line)).frame(height: 1)
                    MoveRow(row: row)
                        .padding(.vertical, Tokens.Space.s2)
                        .padding(.horizontal, Tokens.Space.s2)
                        .background(row.mine ? theme.color(Tokens.Color.accentWash) : .clear)
                }
            }
        }
        .padding(.horizontal, Tokens.Space.s4)
    }
}

private struct MoveRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let row: MoveLine

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: Tokens.Space.s2) {
                Pill(row.kind, tone: row.mine ? .accent : .quiet)
                Text(row.teams.joined(separator: ", "))
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(row.when)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .medium))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
            }
            ForEach(Array(row.adds.enumerated()), id: \.offset) { _, player in
                PlayerMove(player: player, gain: true)
            }
            ForEach(Array(row.drops.enumerated()), id: \.offset) { _, player in
                PlayerMove(player: player, gain: false)
            }
            if !row.detail.isEmpty {
                Text(row.detail)
                    .font(Faces.font(.num, size: Tokens.TypeScale.md, weight: .medium))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
            }
        }
    }
}

/// A player in or out: the mark of the move, his name, position and club, and where a trade sent him.
private struct PlayerMove: View {
    @Environment(\.colorScheme) private var colorScheme
    let player: MovePlayerLine
    let gain: Bool

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(spacing: Tokens.Space.s2) {
            Image(systemName: gain ? "plus" : "minus")
                .font(.system(size: 10, weight: .heavy))
                .foregroundStyle(theme.color(gain ? Tokens.Color.gainInk : Tokens.Color.lossInk))
                .frame(width: 16, height: 16)
                .background(Circle().fill(theme.color(gain ? Tokens.Color.gainBg : Tokens.Color.lossBg)))
                .accessibilityHidden(true)
            Text(player.name)
                .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .semibold))
                .foregroundStyle(theme.color(Tokens.Color.ink))
            Text(player.detail)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .medium))
                .foregroundStyle(theme.color(Tokens.Color.ink3))
            if let to = player.to {
                Text(to)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .medium))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
            }
        }
    }
}
