import Board
import CommishCore
import CommishDesign
import SwiftUI

/// The grid's phone sizes (ScheduleGrid.svelte at 390): the club's column with its rank leading and
/// its strength pinned beside it, then the weeks, which scroll sideways in their own frame.
enum GridSize {
    static let club: Double = 132
    static let strength: Double = 48
    static let week: Double = 64
    static let row: Double = 52
    static let head: Double = 34
}

/// The pinned columns of a club's row: its rank, its lead player's face, its name opening its page with
/// the player's name under it, then its strength.
struct GridClubCell: View {
    @Environment(\.colorScheme) private var colorScheme
    let row: ScheduleGridRow
    let strength: Bool
    let open: (String) -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(spacing: Tokens.Space.s1) {
            Button { open(row.abbr) } label: {
                HStack(spacing: Tokens.Space.s1) {
                    if let rank = row.rank {
                        Text(String(rank))
                            .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
                            .monospacedDigit()
                            .foregroundStyle(theme.color(Tokens.Color.ink))
                            .frame(width: 22, alignment: .trailing)
                    }
                    Headshot(row.face, initials: row.abbr, side: 24)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(row.name)
                            .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                            .lineLimit(2)
                            .minimumScaleFactor(0.8)
                            .foregroundStyle(theme.color(Tokens.Color.ink))
                        if let face = row.faceName {
                            Text(face)
                                .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                                .lineLimit(1)
                                .foregroundStyle(theme.color(Tokens.Color.ink3))
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isLink)
            .frame(width: GridSize.club)
            if strength {
                RowFigure(text: row.strength ?? Words.Box.none, ink: Tokens.Color.ink, size: Tokens.TypeScale.md)
                    .frame(width: GridSize.strength, alignment: .trailing)
            }
        }
        .padding(.horizontal, Tokens.Space.s2)
        .frame(height: GridSize.row)
        .background(theme.color(Tokens.Color.bg))
        .overlay(alignment: .bottom) { Hairline() }
    }
}

/// A week's cell: the opponent at or against and his value, shaded among the strongest, set back once
/// played, opening the opponent's page; the bye's word.
struct GridWeekCell: View {
    @Environment(\.colorScheme) private var colorScheme
    let cell: ScheduleCell
    let open: (String) -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        let ink = theme.color(cell.played ? Tokens.Color.playedInk : Tokens.Color.ink)
        Group {
            if let opponent = cell.opponent, let club = cell.club {
                Button { open(club) } label: {
                    VStack(spacing: 0) {
                        Text(opponent)
                            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                            .foregroundStyle(ink)
                        Text(cell.value)
                            .font(Faces.font(.num, size: Tokens.TypeScale.md, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(cell.played ? ink : theme
                                .color(cell.hard ? Tokens.Color.ink2 : Tokens.Color.ink))
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            } else {
                Text(Words.SchedulePage.bye)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .foregroundStyle(theme.color(cell.played ? Tokens.Color.playedInk : Tokens.Color.ink3))
            }
        }
        .frame(width: GridSize.week, height: GridSize.row)
        .background(cell.hard ? theme.color(Tokens.Color.surface2) : theme.color(Tokens.Color.bg))
        .overlay(alignment: .bottom) { Hairline() }
    }
}

/// The grid: the club and strength columns pinned, the weeks scrolling sideways beside them.
struct ScheduleGridView: View {
    @Environment(\.colorScheme) private var colorScheme
    let grid: ScheduleGridModel
    let rows: [ScheduleGridRow]
    let open: (String) -> Void
    /// The screen's: the weeks scroll; a snapshot's draws the first weeks still.
    var live = true

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(alignment: .top, spacing: 0) {
            VStack(spacing: 0) {
                HStack(spacing: Tokens.Space.s1) {
                    ColumnHead(words: Words.SchedulePage.club, alignment: .leading).frame(width: GridSize.club)
                    if let label = grid.strengthLabel {
                        ColumnHead(words: label).frame(width: GridSize.strength)
                    }
                }
                .padding(.horizontal, Tokens.Space.s2)
                .frame(height: GridSize.head)
                .overlay(alignment: .bottom) { Hairline() }
                ForEach(rows) { row in
                    GridClubCell(row: row, strength: grid.strengthLabel != nil, open: open)
                }
            }
            .overlay(alignment: .trailing) { theme.color(Tokens.Color.line).frame(width: 1) }
            if live {
                ScrollView(.horizontal, showsIndicators: true) { weeks(theme) }
            } else {
                // Still: the first weeks the frame holds, the rest cut at its edge.
                Color.clear
                    .frame(height: GridSize.head + GridSize.row * Double(rows.count))
                    .overlay(alignment: .topLeading) { weeks(theme) }
                    .clipped()
            }
        }
        .background(theme.color(Tokens.Color.bg))
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md).strokeBorder(theme.color(Tokens.Color.line)))
    }

    /// "Wk 7": a week's head.
    static func head(_ week: Int) -> String {
        "\(Words.SchedulePage.week) \(week)"
    }

    private func weeks(_ theme: Theme) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(grid.weeks, id: \.self) { week in
                    Text(Self.head(week))
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                        .textCase(.uppercase)
                        .foregroundStyle(theme.color(week <= grid.played ? Tokens.Color.playedInk : Tokens.Color.ink3))
                        .frame(width: GridSize.week, height: GridSize.head)
                }
            }
            .overlay(alignment: .bottom) { Hairline() }
            ForEach(rows) { row in
                HStack(spacing: 0) {
                    ForEach(row.cells) { cell in
                        GridWeekCell(cell: cell, open: open)
                    }
                }
            }
        }
        .fixedSize()
    }
}

/// The legend under the grid: a shaded cell's words and a played one's.
struct ScheduleLegend: View {
    @Environment(\.colorScheme) private var colorScheme
    let model: ScheduleModel

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(spacing: Tokens.Space.s4) {
            swatch(theme.color(Tokens.Color.surface2), words: model.legendHard, theme: theme)
            Text(model.legendPlayed)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                .foregroundStyle(theme.color(Tokens.Color.playedInk))
        }
        .padding(.horizontal, Tokens.Space.s3)
    }

    private func swatch(_ fill: Color, words: String, theme: Theme) -> some View {
        HStack(spacing: Tokens.Space.s1) {
            RoundedRectangle(cornerRadius: Tokens.Radius.sm)
                .fill(fill)
                .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.sm).strokeBorder(theme.color(Tokens.Color.line)))
                .frame(width: 18, height: 14)
            Text(words)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                .foregroundStyle(theme.color(Tokens.Color.ink2))
        }
    }
}

/// The strength of schedule at 390: the heading and its lead, the grid with its caption and legend.
public struct ScheduleScreen: View {
    let model: ScheduleModel
    let stamp: String?
    let actions: ReferenceActions
    var rows: [ScheduleGridRow]?
    var live = true

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            ReferenceHead(heading: model.heading, stamp: model.stamp, lead: model.grid.lead, stale: stamp)
            BasisText(model.caption).padding(.horizontal, Tokens.Space.s3)
            ScheduleGridView(grid: model.grid, rows: rows ?? model.grid.rows, open: actions.club, live: live)
                .padding(.horizontal, Tokens.Space.s3)
            ScheduleLegend(model: model)
        }
        .padding(.vertical, Tokens.Space.s4)
    }
}

/// The schedule with its view model: a club cell opening its page, the mock's verb pinned.
public struct ScheduleView: View {
    @Environment(\.openURL) private var openURL
    @Environment(PlayerSheetHost.self) private var sheet
    private let viewModel: RunScreenViewModel<ScheduleModel>

    public init(viewModel: RunScreenViewModel<ScheduleModel>) {
        self.viewModel = viewModel
    }

    public var body: some View {
        RunScreenContainer(viewModel: viewModel) { model, stamp in
            ScheduleScreen(model: model, stamp: stamp, actions: .live(sheet: sheet, openURL: openURL))
        } pin: { model in
            PagePin(verb: model.verb)
        }
    }
}
