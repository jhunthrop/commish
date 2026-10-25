import CommishCore
import CommishDesign
import SwiftUI

/// The matchup's score bug on the lit board (MatchupBug.svelte at 390): across its top the week, the
/// game's head and its words and the read beside a live score; under it the two teams side by side,
/// each with You or Opponent (neither on another team's game), its name, where its starters stand,
/// its big figure and the small one; across its foot the API's line on where the member stands. The
/// member's figure in the board's number colour.
struct MatchupBugView: View {
    @Environment(\.colorScheme) private var colorScheme
    let bug: MatchupBug

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(spacing: 0) {
            middle(theme)
            HStack(alignment: .top, spacing: 0) {
                side(bug.mine, leading: true, theme: theme)
                if let opponent = bug.opponent {
                    Rectangle().fill(theme.color(Tokens.Color.scoreboardLine)).frame(width: 1)
                    side(opponent, leading: false, theme: theme)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            if let standing = bug.standing {
                Rectangle().fill(theme.color(Tokens.Color.scoreboardLine)).frame(height: 1)
                Text(standing)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                    .monospacedDigit()
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                    .padding(.horizontal, Tokens.Space.s3)
            }
        }
        .foregroundStyle(theme.color(Tokens.Color.scoreboardInk))
        .background(theme.color(Tokens.Color.scoreboard))
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        .overlay(
            RoundedRectangle(cornerRadius: Tokens.Radius.md)
                .strokeBorder(theme.color(Tokens.Color.scoreboardLine), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    /// "Week 6 · Next kickoff · Sun 3:05 pm, ARI at LAR · FFPC 4 min ago", wrapping between its parts.
    private func middle(_ theme: Theme) -> some View {
        FlowRow(spacing: Tokens.Space.s2, alignment: .center) {
            Text(bug.week)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                .textCase(.uppercase)
                .tracking(Tokens.TypeScale.xs * 0.06)
                .foregroundStyle(theme.color(Tokens.Color.scoreboardInk2))
            if let head = bug.head {
                Text(head)
                    .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(Tokens.TypeScale.lg * 0.04)
                if !bug.words.isEmpty {
                    Text(bug.words)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                        .foregroundStyle(theme.color(Tokens.Color.scoreboardInk2))
                }
            }
            if let read = bug.read {
                Text(read)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .medium))
                    .monospacedDigit()
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .padding(.horizontal, Tokens.Space.s3)
        .background(theme.color(Tokens.Color.scoreboard2))
        .overlay(alignment: .bottom) {
            Rectangle().fill(theme.color(Tokens.Color.scoreboardLine)).frame(height: 1)
        }
    }

    /// One team: the second reads from the right edge in, as the web's does.
    private func side(_ team: BugTeam, leading: Bool, theme: Theme) -> some View {
        let alignment: HorizontalAlignment = leading ? .leading : .trailing
        return VStack(alignment: alignment, spacing: Tokens.Space.s1) {
            if !team.label.isEmpty {
                Text(team.label)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .textCase(.uppercase)
                    .tracking(Tokens.TypeScale.xs * 0.06)
                    .foregroundStyle(theme.color(Tokens.Color.scoreboardInk2))
            }
            Text(team.name)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .bold))
                .lineLimit(2)
                .multilineTextAlignment(leading ? .leading : .trailing)
                .fixedSize(horizontal: false, vertical: true)
            if !team.toPlay.isEmpty {
                Text(team.toPlay)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.scoreboardNum))
            }
            Spacer(minLength: 0)
            HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s2) {
                Text(team.big)
                    .font(Faces.font(.num, size: Tokens.TypeScale.head, weight: .bold))
                    .monospacedDigit()
                    .lineLimit(1)
                    .foregroundStyle(theme.color(team.me ? Tokens.Color.scoreboardNum : Tokens.Color.scoreboardInk))
                    .accessibilityLabel("\(team.bigLabel) \(team.big)")
                if !team.small.isEmpty {
                    Text(team.small)
                        .font(Faces.font(.num, size: Tokens.TypeScale.sm, weight: .medium))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .foregroundStyle(theme.color(Tokens.Color.scoreboardInk2))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: leading ? .leading : .trailing)
        .padding(.horizontal, Tokens.Space.s3)
        .padding(.vertical, Tokens.Space.s2)
    }
}
