import CommishCore
import CommishDesign
import SwiftUI

/// The wall (Wall.svelte at 390): each seat's name across the top, then each round's picks, your seat
/// in the accent and the pick on the clock outlined; it scrolls sideways.
struct MockWallView: View {
    @Environment(\.colorScheme) private var colorScheme
    let wall: MockWall
    var live = true

    static let cell: Double = 72

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            SectionHead(Words.Mock.wall).padding(.horizontal, Tokens.Space.s3)
            if live {
                ScrollView(.horizontal, showsIndicators: false) { grid.padding(.horizontal, Tokens.Space.s3) }
            } else {
                grid.padding(.horizontal, Tokens.Space.s3).frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
                    .clipped()
            }
        }
    }

    private var grid: some View {
        let theme = Theme(colorScheme)
        return Grid(horizontalSpacing: 2, verticalSpacing: 2) {
            GridRow {
                Text(verbatim: "").frame(width: 20)
                ForEach(Array(wall.names.enumerated()), id: \.offset) { index, name in
                    Text(name)
                        .font(Faces.font(
                            .ui,
                            size: Tokens.TypeScale.xs,
                            weight: index + 1 == wall.you ? .bold : .semibold
                        ))
                        .lineLimit(1)
                        .foregroundStyle(theme
                            .color(index + 1 == wall.you ? Tokens.Color.accentText : Tokens.Color.ink3))
                        .frame(width: Self.cell)
                }
            }
            ForEach(Array(wall.rows.enumerated()), id: \.offset) { round, row in
                GridRow {
                    Text(String(round + 1))
                        .font(Faces.font(.num, size: Tokens.TypeScale.sm, weight: .bold))
                        .foregroundStyle(theme.color(Tokens.Color.ink3))
                        .frame(width: 20)
                    ForEach(Array(row.enumerated()), id: \.offset) { seat, player in
                        cell(player, seat: seat + 1, round: round, theme: theme)
                    }
                }
            }
        }
    }

    private func cell(_ player: RoomPlayer?, seat: Int, round: Int, theme: Theme) -> some View {
        let pick = round % 2 == 0 ? round * wall.teams + seat : round * wall.teams + (wall.teams - seat + 1)
        let mine = seat == wall.you
        return VStack(spacing: 1) {
            if let player {
                Text(DraftFormat.lastName(player.name))
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                PositionPill(player.position)
            } else {
                Text(DraftFormat.pickLabel(pick, teams: wall.teams))
                    .font(Faces.font(.num, size: Tokens.TypeScale.xs, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
            }
        }
        .foregroundStyle(theme.color(Tokens.Color.ink))
        .frame(width: Self.cell, height: 40)
        .background(RoundedRectangle(cornerRadius: Tokens.Radius.sm)
            .fill(theme.color(mine ? Tokens.Color.accentWash : Tokens.Color.surface)))
        .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.sm)
            .strokeBorder(theme.color(Tokens.Color.ink), lineWidth: pick == wall.now ? 2 : 0))
    }
}

/// Your team (TeamPanel.svelte): the count, then each slot with who fills it and the pick that took
/// him, or open.
struct MockTeamView: View {
    @Environment(\.colorScheme) private var colorScheme
    let title: String
    let team: TeamModel

    var body: some View {
        let theme = Theme(colorScheme)
        RoomPanel {
            VStack(alignment: .leading, spacing: 0) {
                SectionHead(title, aside: team.count).padding(.bottom, Tokens.Space.s2)
                ForEach(team.slots) { line in
                    HStack(spacing: 6) {
                        Text(line.slot)
                            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                            .foregroundStyle(theme.color(Tokens.Color.ink3))
                            .frame(width: RoomColumn.slot, alignment: .leading)
                        if let player = line.player {
                            Who(player: player)
                            Figure(
                                text: line.pick ?? "",
                                width: RoomColumn.pick,
                                ink: Tokens.Color.ink2,
                                size: Tokens.TypeScale.sm
                            )
                        } else {
                            Text(Words.Room.open)
                                .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                                .foregroundStyle(theme.color(Tokens.Color.ink3))
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .frame(minHeight: line.player == nil ? 30 : 44)
                    .overlay(alignment: .top) { Hairline() }
                }
            }
        }
    }
}

/// A shared draft's head (SharedHead.svelte): whose it is, where it stands, the one verb and its note.
struct MockSharedHeadView: View {
    @Environment(\.colorScheme) private var colorScheme
    let head: MockSharedHead
    let starting: Bool
    let run: () -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            Text(head.title)
                .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                .textCase(.uppercase)
                .foregroundStyle(theme.color(Tokens.Color.ink))
                .accessibilityAddTraits(.isHeader)
            Note(text: head.line)
            Verb(head.verb, enabled: !starting, action: run)
            BasisText(head.note)
        }
        .padding(.horizontal, Tokens.Space.s3)
    }
}
