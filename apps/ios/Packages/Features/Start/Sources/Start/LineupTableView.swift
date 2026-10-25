import CommishCore
import CommishDesign
import SwiftUI

/// The phone's columns (LineupTable.svelte at 390): the slot, the player taking the rest, Our rank,
/// Proj, Pts and the cell that opens a swap's evidence line.
enum Column {
    static let slot: Double = 44
    static let rank: Double = 36
    static let proj: Double = 50
    static let pts: Double = 42
    static let why: Double = 30
    static let face: Double = 28
}

/// What a row does when tapped: his name opens the player sheet, the chevron his evidence line.
struct RowActions {
    let open: (SheetPlayer) -> Void
    let toggleWhy: (String) -> Void
    let opened: Set<String>
}

/// The Lineup's one table (web LineupTable.svelte): the heads, the lineup the advice sets with its
/// evidence lines, the spots no one can play, the Team row lit like the score bug.
struct LineupTableView: View {
    @Environment(\.colorScheme) private var colorScheme
    let model: StartModel
    let actions: RowActions

    var body: some View {
        let theme = Theme(colorScheme)
        TableFrame {
            HeadRow()
            ForEach(model.starters) { cells in
                LineupRowView(cells: cells, bench: false, actions: actions)
            }
            ForEach(model.empty, id: \.self) { slot in
                EmptyRow(slot: slot)
            }
            TeamRowView(team: model.team)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(model.week)
        .background(theme.color(Tokens.Color.bg))
    }
}

/// The bench and the injured reserve (the table's second and third bodies on the web).
struct BenchView: View {
    let model: StartModel
    let actions: RowActions

    var body: some View {
        TableFrame {
            SectionRow(title: Words.Box.bench)
            if model.bench.isEmpty {
                NoteRow(text: Words.InSeason.noBench)
            }
            ForEach(model.bench) { cells in
                LineupRowView(cells: cells, bench: true, actions: actions)
            }
            if !model.reserve.isEmpty {
                SectionRow(title: Words.Box.reserve)
                ForEach(model.reserve) { cells in
                    LineupRowView(cells: cells, bench: true, actions: actions)
                }
            }
        }
    }
}

/// The table's surface, hairline and corners.
struct TableFrame<Content: View>: View {
    @Environment(\.colorScheme) private var colorScheme
    @ViewBuilder let content: Content

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(spacing: 0) {
            content
        }
        .background(theme.color(Tokens.Color.surface))
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md).strokeBorder(theme.color(Tokens.Color.line)))
    }
}

/// The column heads: Slot, Player, Our rank on two lines over the rank alone, Proj, Pts.
struct HeadRow: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(spacing: 0) {
            head(Words.Box.slot).frame(width: Column.slot, alignment: .leading)
            head(Words.Box.player).frame(maxWidth: .infinity, alignment: .leading)
            head(Words.Box.ourRank).frame(width: Column.rank, alignment: .leading)
            head(Words.Box.proj).frame(width: Column.proj, alignment: .trailing)
            head(Words.Box.pts).frame(width: Column.pts, alignment: .trailing)
            Color.clear.frame(width: Column.why, height: 1)
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
struct SectionRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let title: String

    var body: some View {
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

/// A line of words across the table: the bench with nobody on it.
struct NoteRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let text: String

    var body: some View {
        Text(text)
            .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
            .foregroundStyle(Theme(colorScheme).color(Tokens.Color.ink2))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Tokens.Space.s3)
            .overlay(alignment: .bottom) { Hairline() }
    }
}

/// A spot empty on the platform that no one who can play fills: its slot, the sentence, no figures.
struct EmptyRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let slot: String

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(spacing: 0) {
            Text(slot)
                .font(Faces.font(.num, size: Tokens.TypeScale.md, weight: .bold))
                .foregroundStyle(theme.color(Tokens.Color.ink2))
                .frame(width: Column.slot, alignment: .leading)
            Text(Words.Lineup.noOneHere)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                .frame(maxWidth: .infinity, alignment: .leading)
            Figure(text: Words.Box.none, width: Column.proj, muted: true)
            Figure(text: Words.Box.none, width: Column.pts, muted: true)
            Color.clear.frame(width: Column.why, height: 1)
        }
        .foregroundStyle(theme.color(Tokens.Color.ink3))
        .padding(.horizontal, Tokens.Space.s2)
        .frame(minHeight: 48)
        .background(theme.mix(Tokens.Color.lossBg, 35, into: Tokens.Color.surface))
        .overlay(alignment: .bottom) { Hairline() }
    }
}

/// The Team row, lit like the score bug (TeamFigures.svelte): before kickoff the Proj big and the
/// Pts small; from kickoff the Pts big and the projected final small under its caption.
struct TeamRowView: View {
    @Environment(\.colorScheme) private var colorScheme
    let team: TeamRow

    var body: some View {
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
            Color.clear.frame(width: Column.why, height: 1)
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
struct Figure: View {
    @Environment(\.colorScheme) private var colorScheme
    let text: String
    let width: Double
    var muted = false

    var body: some View {
        Text(text)
            .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .medium))
            .monospacedDigit()
            .lineLimit(1)
            .foregroundStyle(Theme(colorScheme).color(muted ? Tokens.Color.ink3 : Tokens.Color.ink))
            .frame(width: width, alignment: .trailing)
    }
}

struct Hairline: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Rectangle().fill(Theme(colorScheme).color(Tokens.Color.line)).frame(height: 1)
    }
}
