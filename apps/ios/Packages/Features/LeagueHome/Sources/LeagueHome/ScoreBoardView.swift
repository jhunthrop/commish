import CommishCore
import CommishDesign
import SwiftUI

/// The week's scoreboard: every game as a score bug on the lit board, swiped in a hand, the member's
/// first with its orange rim (web ScoreBoard.svelte and BugCard.svelte).
struct ScoreBoardView: View {
    let title: String
    let aside: String
    let stamp: String?
    let bugs: [ScoreBug]
    /// The hand swipes; a still render draws it at rest.
    var scrolls = true

    /// A bug's width: one and a half fit a phone, so the hand shows there are more.
    static let bugWidth: Double = 300

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            SectionHead(title, aside: aside, stamp: stamp)
                .padding(.horizontal, Tokens.Space.s4)
            if scrolls {
                ScrollView(.horizontal, showsIndicators: false) { hand }
            } else {
                // The hand at rest, as a phone first shows it: what a still render (the snapshot) draws,
                // since ImageRenderer draws no scroll view's content.
                // The first bug, hidden, gives the row its height; the hand lies over it, cut at the edge.
                BugCard(bug: bugs[0]).frame(width: Self.bugWidth).hidden()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(alignment: .topLeading) { hand.fixedSize() }
                    .clipped()
            }
        }
    }

    private var hand: some View {
        HStack(spacing: Tokens.Space.s2) {
            ForEach(bugs) { bug in
                BugCard(bug: bug).frame(width: Self.bugWidth)
            }
        }
        .padding(.horizontal, Tokens.Space.s4)
    }
}

/// One score bug: the state at its head, then each side with its face, record, where its starters
/// stand, and its two figures. Once a game has started the side ahead is bright and the side behind
/// muted.
struct BugCard: View {
    @Environment(\.colorScheme) private var colorScheme
    let bug: ScoreBug

    static let figureWidth: Double = 56
    /// The member's bug washes its top in the board's number colour, as the web's gradient does.
    static let rimWash: Double = 14

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 4) {
            head(theme)
            ForEach(bug.sides, id: \.rosterID) { side in
                sideRow(side, theme: theme)
            }
        }
        .padding(.horizontal, Tokens.Space.s3)
        .padding(.vertical, Tokens.Space.s2)
        .background(background(theme))
        .overlay(alignment: .top) {
            if bug.mine {
                Rectangle().fill(theme.color(Tokens.Color.scoreboardNum)).frame(height: 3)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        .overlay(
            RoundedRectangle(cornerRadius: Tokens.Radius.md)
                .strokeBorder(theme.color(Tokens.Color.scoreboardLine), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    private func head(_ theme: Theme) -> some View {
        HStack(spacing: Tokens.Space.s2) {
            Text(bug.head)
                .foregroundStyle(theme
                    .color(bug.state == .kickedOff ? Tokens.Color.scoreboardNum : Tokens.Color.scoreboardInk))
                .fontWeight(.bold)
            Text(bug.words)
                .foregroundStyle(theme
                    .color(bug.state == .kickedOff ? Tokens.Color.scoreboardInk : Tokens.Color.scoreboardInk2))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            figureHead(bug.small, theme: theme)
            figureHead(bug.big, theme: theme)
        }
        .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
        .textCase(.uppercase)
        .frame(minHeight: 24)
    }

    private func figureHead(_ text: String, theme: Theme) -> some View {
        Text(text)
            .foregroundStyle(theme.color(Tokens.Color.scoreboardInk2))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .frame(width: Self.figureWidth, alignment: .trailing)
    }

    private func sideRow(_ side: BugSide, theme: Theme) -> some View {
        let ink = theme.color(side.stands == .behind ? Tokens.Color.scoreboardInk2 : Tokens.Color.scoreboardInk)
        return HStack(spacing: Tokens.Space.s2) {
            Avatar(side.initials, side: 26, mine: side.me, board: true)
            VStack(alignment: .leading, spacing: 0) {
                Text(side.name)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: side.me ? .bold : .semibold))
                    .foregroundStyle(ink)
                    .lineLimit(1)
                if !side.toPlay.isEmpty {
                    Text(side.toPlay)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                        .foregroundStyle(theme.color(Tokens.Color.scoreboardNum))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(side.record)
                .font(Faces.font(.num, size: Tokens.TypeScale.sm, weight: .medium))
                .foregroundStyle(theme.color(Tokens.Color.scoreboardInk2))
            Text(side.small)
                .font(Faces.font(.num, size: Tokens.TypeScale.md, weight: .medium))
                .foregroundStyle(theme.color(Tokens.Color.scoreboardInk2))
                .frame(width: Self.figureWidth, alignment: .trailing)
            Text(side.big)
                .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                .foregroundStyle(ink)
                .frame(width: Self.figureWidth, alignment: .trailing)
        }
    }

    @ViewBuilder
    private func background(_ theme: Theme) -> some View {
        if bug.mine {
            LinearGradient(
                colors: [
                    theme.mix(Tokens.Color.scoreboardNum, Self.rimWash, into: Tokens.Color.scoreboard),
                    theme.color(Tokens.Color.scoreboard),
                ],
                startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.7)
            )
        } else {
            theme.color(Tokens.Color.scoreboard)
        }
    }
}
