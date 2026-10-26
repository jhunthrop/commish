import CommishCore
import CommishDesign
import SwiftUI

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
