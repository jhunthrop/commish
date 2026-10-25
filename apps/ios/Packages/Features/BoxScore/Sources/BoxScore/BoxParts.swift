import CommishCore
import CommishDesign
import SwiftUI

/// The phone's columns (BoxTable.svelte and LineupTable.svelte at 390): the slot, the player taking
/// the rest, Our rank, Proj, Pts and, on the Lineup, the cell that opens a swap's evidence line.
public enum Column {
    public static let slot: Double = 44
    public static let rank: Double = 36
    public static let proj: Double = 50
    public static let pts: Double = 42
    public static let why: Double = 30
    public static let face: Double = 28
    /// The Trades' last cell, his rest-of-season points a game under "A game".
    public static let season: Double = 50
}

/// Which of the box's own parts a screen draws: the Lineup's evidence line under each player and the
/// cell that opens a swap's evidence; the Matchup's rows have neither (BoxLine's evidence prop); the
/// Trades' opened rows (BoxLine with season and shortOnPhone, no facts on the phone's game line) draw
/// the evidence line, his short name, no rank, and his points a game where the others draw Pts.
public struct BoxStyle: Equatable, Sendable {
    public let evidence: Bool
    public let why: Bool
    public let rank: Bool
    /// The expected score and weather under his game while it is to come.
    public let facts: Bool
    /// The last cell is his rest-of-season points a game, in place of Pts.
    public let season: Bool
    /// His short form, "A. Rodgers", whatever the room.
    public let shortName: Bool

    public init(
        evidence: Bool, why: Bool, rank: Bool = true, facts: Bool = true, season: Bool = false,
        shortName: Bool = false
    ) {
        self.evidence = evidence
        self.why = why
        self.rank = rank
        self.facts = facts
        self.season = season
        self.shortName = shortName
    }

    public static let lineup = BoxStyle(evidence: true, why: true)
    public static let matchup = BoxStyle(evidence: false, why: false)
    public static let trade = BoxStyle(
        evidence: true, why: false, rank: false, facts: false, season: true, shortName: true
    )
}

/// What a row does when tapped: his name opens the player sheet, the chevron his evidence line.
public struct RowActions {
    let open: (SheetPlayer) -> Void
    let toggleWhy: (String) -> Void
    let opened: Set<String>

    public init(
        open: @escaping (SheetPlayer) -> Void, toggleWhy: @escaping (String) -> Void = { _ in },
        opened: Set<String> = []
    ) {
        self.open = open
        self.toggleWhy = toggleWhy
        self.opened = opened
    }
}

/// The table's surface, hairline and corners.
public struct TableFrame<Content: View>: View {
    @Environment(\.colorScheme) private var colorScheme
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        VStack(spacing: 0) {
            content
        }
        .background(theme.color(Tokens.Color.surface))
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md).strokeBorder(theme.color(Tokens.Color.line)))
    }
}

/// The column heads: Slot, Player, Our rank on two lines over the rank alone, Proj, Pts; on the
/// Trades', the side, Player, Proj and A game.
public struct HeadRow: View {
    @Environment(\.colorScheme) private var colorScheme
    private let style: BoxStyle

    public init(style: BoxStyle = .lineup) {
        self.style = style
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        HStack(spacing: 0) {
            // The Trades' side cell has no head (TradeFinder's hidden "Give").
            head(style.season ? "" : Words.Box.slot).frame(width: Column.slot, alignment: .leading)
            head(Words.Box.player).frame(maxWidth: .infinity, alignment: .leading)
            if style.rank {
                head(Words.Box.ourRank).frame(width: Column.rank, alignment: .leading)
            }
            head(Words.Box.proj).frame(width: Column.proj, alignment: .trailing)
            if style.season {
                head(Words.Trades.perGame).frame(width: Column.season, alignment: .trailing)
            } else {
                head(Words.Box.pts).frame(width: Column.pts, alignment: .trailing)
            }
            if style.why {
                Color.clear.frame(width: Column.why, height: 1)
            }
        }
        .padding(.horizontal, Tokens.Space.s2)
        .frame(minHeight: 34)
        .background(theme.color(Tokens.Color.bg))
        .overlay(alignment: .bottom) { Hairline() }
        .accessibilityHidden(true)
    }

    private func head(_ words: String) -> some View {
        Text(words)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
            .textCase(.uppercase)
            .tracking(Tokens.TypeScale.xs * 0.06)
            .lineSpacing(-2)
            .fixedSize(horizontal: false, vertical: true)
            .foregroundStyle(Theme(colorScheme).color(Tokens.Color.ink3))
    }
}

/// A section's head inside the table: Bench, Injured reserve.
public struct SectionRow: View {
    @Environment(\.colorScheme) private var colorScheme
    private let title: String

    public init(title: String) {
        self.title = title
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        Text(title)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
            .textCase(.uppercase)
            .tracking(Tokens.TypeScale.xs * 0.06)
            .foregroundStyle(theme.color(Tokens.Color.ink3))
            .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
            .padding(.horizontal, Tokens.Space.s3)
            .background(theme.color(Tokens.Color.bg))
            .overlay(alignment: .bottom) { Hairline() }
            .accessibilityAddTraits(.isHeader)
    }
}

/// A line of words across the table: the bench with nobody on it, the starters a platform does not
/// send.
public struct NoteRow: View {
    @Environment(\.colorScheme) private var colorScheme
    private let text: String

    public init(text: String) {
        self.text = text
    }

    public var body: some View {
        Text(text)
            .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
            .foregroundStyle(Theme(colorScheme).color(Tokens.Color.ink2))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Tokens.Space.s3)
            .overlay(alignment: .bottom) { Hairline() }
    }
}

/// The Team row, lit like the score bug (TeamFigures.svelte): before kickoff the Proj big and the
/// Pts small; from kickoff the Pts big and the projected final small under its caption.
public struct TeamRowView: View {
    @Environment(\.colorScheme) private var colorScheme
    private let team: TeamRow
    private let style: BoxStyle

    public init(team: TeamRow, style: BoxStyle = .lineup) {
        self.team = team
        self.style = style
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        HStack(alignment: .center, spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text(Words.Box.totals)
                    .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(Tokens.TypeScale.lg * 0.06)
                if let note = team.note {
                    Text(note)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                        .foregroundStyle(theme.color(Tokens.Color.scoreboardInk2))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 0) {
                if let caption = team.caption {
                    Text(caption)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                        .textCase(.uppercase)
                        .lineLimit(1)
                        .fixedSize()
                        .foregroundStyle(theme.color(Tokens.Color.scoreboardInk2))
                }
                figure(team.proj, big: !team.live, theme: theme)
            }
            .frame(width: Column.proj, alignment: .trailing)
            figure(team.pts, big: team.live, theme: theme)
                .frame(width: Column.pts, alignment: .trailing)
            if style.why {
                Color.clear.frame(width: Column.why, height: 1)
            }
        }
        .foregroundStyle(theme.color(Tokens.Color.scoreboardInk))
        .padding(.horizontal, Tokens.Space.s2)
        .frame(minHeight: 56)
        .background(theme.color(Tokens.Color.scoreboard))
    }

    private func figure(_ text: String, big: Bool, theme: Theme) -> some View {
        Text(text)
            .font(Faces.font(.num, size: big ? Tokens.TypeScale.xl : Tokens.TypeScale.lg, weight: .bold))
            .monospacedDigit()
            .lineLimit(1)
            .fixedSize()
            .foregroundStyle(theme.color(big ? Tokens.Color.scoreboardNum : Tokens.Color.scoreboardInk2))
    }
}

/// A figure cell: one decimal in the number face, trailing, "--" quiet.
public struct Figure: View {
    @Environment(\.colorScheme) private var colorScheme
    private let text: String
    private let width: Double
    private let muted: Bool

    public init(text: String, width: Double, muted: Bool = false) {
        self.text = text
        self.width = width
        self.muted = muted
    }

    public var body: some View {
        Text(text)
            .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .medium))
            .monospacedDigit()
            .lineLimit(1)
            .foregroundStyle(Theme(colorScheme).color(muted ? Tokens.Color.ink3 : Tokens.Color.ink))
            .frame(width: width, alignment: .trailing)
    }
}
