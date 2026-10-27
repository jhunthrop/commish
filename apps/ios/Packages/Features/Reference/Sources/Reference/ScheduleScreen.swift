import Board
import CommishCore
import CommishDesign
import CoreText
import Foundation
import SwiftUI

/// The grid's phone sizes (ScheduleGrid.svelte at 390): the club's column with its rank leading and
/// its strength pinned beside it, then the weeks, which scroll sideways in their own frame.
enum GridSize {
    static let club: Double = 132
    static let strength: Double = 48
    static let week: Double = 64
    static let row: Double = 52
    /// A row whose current week's cell says its game's state on a third line (Lane 223, B187).
    static let stateRow: Double = 62
    static let head: Double = 34
    /// The state line's size and weight, which the current week's column is measured in.
    static let stateSize = Tokens.TypeScale.xs
    static let stateWeight = FaceWeight.medium

    /// The row's height: taller where the grid says the current week's states.
    static func row(_ grid: ScheduleGridModel) -> Double {
        grid.current == nil ? row : stateRow
    }

    /// A week's column: the current one as wide as the longest state its cells say (a kickoff,
    /// "Sun 12:00 pm CT", whole with its zone), with a margin each side, never narrower than a week's.
    static func width(_ week: Int, in grid: ScheduleGridModel, rows: [ScheduleGridRow]) -> Double {
        guard week == grid.current else {
            return Self.week
        }
        let words = rows.flatMap(\.cells).filter { $0.week == week }.compactMap(\.state)
        let widest = words.map(measured).max() ?? 0
        return max(Self.week, (widest + 2 * Tokens.Space.s2).rounded(.up))
    }

    /// The words' width in the state line's face, as CoreText lays them out.
    static func measured(_ words: String) -> Double {
        guard let font = Faces.ctFont(.ui, size: stateSize, weight: stateWeight) else {
            // The system face where ours did not register: a generous character width.
            return Double(words.count) * stateSize * 0.6
        }
        let text = NSAttributedString(string: words, attributes: [kCTFontAttributeName as NSAttributedString.Key: font])
        let line = CTLineCreateWithAttributedString(text)
        return CTLineGetTypographicBounds(line, nil, nil, nil)
    }

    /// Where the weeks open: the current week at the leading edge, the weeks before it scrolled past.
    static func opening(_ grid: ScheduleGridModel) -> Double {
        grid.current.map { Double(max(0, $0 - 1)) * week } ?? 0
    }
}

/// The pinned columns of a club's row: its rank, its lead player's face, its name opening its page with
/// the player's name under it, then its strength.
struct GridClubCell: View {
    @Environment(\.colorScheme) private var colorScheme
    let row: ScheduleGridRow
    let strength: Bool
    let height: Double
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
        .frame(height: height)
        .background(theme.color(Tokens.Color.bg))
        .overlay(alignment: .bottom) { Hairline() }
    }
}

/// A week's cell: the opponent at or against and his value, shaded among the strongest, set back once
/// played, opening the opponent's page, and in the current week the run's state of the game under
/// them; the bye's word.
struct GridWeekCell: View {
    @Environment(\.colorScheme) private var colorScheme
    let cell: ScheduleCell
    let width: Double
    let height: Double
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
                        if let state = cell.state {
                            Text(state)
                                .font(Faces.font(.ui, size: GridSize.stateSize, weight: GridSize.stateWeight))
                                .monospacedDigit()
                                .lineLimit(1)
                                .fixedSize()
                                .foregroundStyle(theme.color(cell.played ? Tokens.Color.playedInk : Tokens.Color.ink2))
                        }
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
        .frame(width: width, height: height)
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
                    GridClubCell(row: row, strength: grid.strengthLabel != nil, height: GridSize.row(grid), open: open)
                }
            }
            .overlay(alignment: .trailing) { theme.color(Tokens.Color.line).frame(width: 1) }
            if live {
                ScrollViewReader { proxy in
                    ScrollView(.horizontal, showsIndicators: true) { weeks(theme) }
                        .onAppear { scrollToCurrent(proxy) }
                        .onChange(of: grid.current) { scrollToCurrent(proxy) }
                }
            } else {
                // Still: the weeks the frame holds from the one it opens on, the rest cut at its edge.
                Color.clear
                    .frame(height: GridSize.head + GridSize.row(grid) * Double(rows.count))
                    .overlay(alignment: .topLeading) { weeks(theme).offset(x: -GridSize.opening(grid)) }
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

    /// The grid opens on the current week, and on a newer run's week once it is read in place.
    private func scrollToCurrent(_ proxy: ScrollViewProxy) {
        if let current = grid.current {
            proxy.scrollTo(current, anchor: .leading)
        }
    }

    private func weeks(_ theme: Theme) -> some View {
        let height = GridSize.row(grid)
        let widths = Dictionary(uniqueKeysWithValues: grid.weeks.map { ($0, GridSize.width($0, in: grid, rows: rows)) })
        return VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(grid.weeks, id: \.self) { week in
                    Text(Self.head(week))
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                        .textCase(.uppercase)
                        .foregroundStyle(theme.color(week <= grid.played ? Tokens.Color.playedInk : Tokens.Color.ink3))
                        .frame(width: widths[week] ?? GridSize.week, height: GridSize.head)
                        .id(week)
                }
            }
            .overlay(alignment: .bottom) { Hairline() }
            ForEach(rows) { row in
                HStack(spacing: 0) {
                    ForEach(row.cells) { cell in
                        GridWeekCell(cell: cell, width: widths[cell.week] ?? GridSize.week, height: height, open: open)
                    }
                }
            }
        }
        .fixedSize()
    }
}

/// The line under the current week's games naming the run's read, so a state is never claimed live.
struct AsOfLine: View {
    @Environment(\.colorScheme) private var colorScheme
    let words: String

    var body: some View {
        Text(words)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
            .foregroundStyle(Theme(colorScheme).color(Tokens.Color.ink3))
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
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
            if let asOf = model.grid.asOf {
                AsOfLine(words: asOf).padding(.horizontal, Tokens.Space.s3)
            }
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
