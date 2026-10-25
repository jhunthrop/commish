import BoxScore
import CommishCore
import CommishDesign
import SwiftUI

/// What the screen's chips do.
public struct RecordActions {
    let figure: (RecordFigure) -> Void
    let position: (String) -> Void
    let draftFigure: (RecordFigure) -> Void

    static var none: RecordActions {
        RecordActions(figure: { _ in }, position: { _ in }, draftFigure: { _ in })
    }
}

/// What the chips have chosen.
public struct RecordChoice: Equatable {
    let figure: RecordFigure
    let position: String
    let draftFigure: RecordFigure
}

/// The parts of the page a screen draws: the whole page, or one of its runs (a snapshot's).
enum RecordPart: CaseIterable {
    case head
    case weeks
    case draft
}

/// Our record as the view model says it, in the web's order at 390: the name and the lead, the weekly
/// record (its head, the summary, the chips, the weeks with their status words and figures, the season
/// to date, the basis), then the draft record. Pure of state, so a snapshot draws it from the fixture.
public struct RecordScreen: View {
    let model: RecordModel
    let stamp: String?
    let choice: RecordChoice
    let actions: RecordActions
    var parts: [RecordPart] = RecordPart.allCases
    var still = false

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            if parts.contains(.head) {
                RecordPageHead(title: model.title, lead: model.lead, stamp: stamp)
                WeeklyHeadView(section: model.weekly)
            }
            if parts.contains(.weeks) {
                WeeksView(section: model.weekly, choice: choice, actions: actions, still: still)
            }
            if parts.contains(.draft) {
                DraftView(draft: model.draft, figure: choice.draftFigure, choose: actions.draftFigure, still: still)
            }
        }
        .padding(.horizontal, Tokens.Space.s3)
        .padding(.vertical, Tokens.Space.s4)
    }
}

/// The page's name in the number face, the lead, and over a saved read when it was read.
struct RecordPageHead: View {
    @Environment(\.colorScheme) private var colorScheme
    let title: String
    let lead: String
    let stamp: String?

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(Faces.font(.num, size: Tokens.TypeScale.display, weight: .bold))
                .textCase(.uppercase)
                .foregroundStyle(theme.color(Tokens.Color.ink))
                .accessibilityAddTraits(.isHeader)
            Text(lead)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .medium))
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(theme.color(Tokens.Color.ink2))
            if let stamp {
                Text(stamp)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.accentText))
                    .padding(.top, Tokens.Space.s1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The weekly record's head and its summary.
struct WeeklyHeadView: View {
    let section: RecordSectionModel

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            if let head = section.head {
                RecordHeadView(title: head.title, what: head.what)
            }
            RecordBugView(bug: section.bug)
        }
    }
}

/// The chips, the weeks as a box score for the figure chosen (the phone draws one at a time), the
/// season to date, and the basis once.
struct WeeksView: View {
    @Environment(\.colorScheme) private var colorScheme
    let section: RecordSectionModel
    let choice: RecordChoice
    let actions: RecordActions
    var still = false

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            if !section.positions.isEmpty {
                ChipRow(
                    labels: section.positions.map(Self.word), pressed: Self.word(choice.position),
                    choose: { label in actions.position(label == Self.word("DST") ? "DST" : label) }, still: still
                )
            }
            ChipRow(
                labels: section.figures, pressed: section.figures[figureIndex],
                choose: { label in
                    if let index = section.figures.firstIndex(of: label) {
                        actions.figure(RecordFigure.allCases[index])
                    }
                },
                still: still
            )
            TableFrame {
                RecordHeadRow(lead: Words.RecordBox.week, heads: section.sourceHeads)
                if let before = section.before {
                    statusRow(lead: before.lead, text: before.text, order: nil, theme: theme)
                }
                ForEach(section.rows) { row in
                    if row.graded, let cells = row.cells?[choice.position]?[choice.figure] {
                        figureRow(
                            lead: row.lead, order: [row.order, row.text].compactMap(\.self).joined(separator: ". "),
                            cells: cells, theme: theme
                        )
                    } else {
                        statusRow(lead: row.lead, text: row.text, order: row.order, theme: theme)
                    }
                    if let note = row.note {
                        NoteRow(text: note)
                    }
                }
                if let toDate = section.toDate, let cells = toDate.cells[choice.position]?[choice.figure] {
                    figureRow(lead: toDate.lead, order: nil, cells: cells, theme: theme)
                        .background(theme.color(Tokens.Color.bg))
                }
            }
            BasisText(section.basis)
        }
    }

    private var figureIndex: Int {
        RecordFigure.allCases.firstIndex(of: choice.figure) ?? 0
    }

    /// record.ts's chip word for a position: a defense is "D/ST".
    static func word(_ position: String) -> String {
        position == "DST" ? RankingsChip.defense.word : position
    }

    private func lead(_ lead: String, order: String?, theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(lead)
                .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .semibold))
                .foregroundStyle(theme.color(Tokens.Color.ink))
            if let order {
                Text(order)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .fixedSize(horizontal: false, vertical: true)
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
            }
        }
    }

    private func figureRow(lead text: String, order: String?, cells: RecordFigureCells, theme: Theme) -> some View {
        HStack(spacing: 0) {
            lead(text, order: order, theme: theme).frame(maxWidth: .infinity, alignment: .leading)
            ForEach(Array(cells.cells.enumerated()), id: \.offset) { index, cell in
                RecordFigureView(cell: cell, lit: index == 0 && !cells.trails)
            }
        }
        .padding(.horizontal, Tokens.Space.s3)
        .padding(.vertical, Tokens.Space.s2)
        .overlay(alignment: .bottom) { Hairline() }
    }

    private func statusRow(lead text: String, text status: String, order: String?, theme: Theme) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s3) {
            lead(text, order: order, theme: theme).frame(width: 96, alignment: .leading)
            Text(status)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(theme.color(Tokens.Color.ink2))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, Tokens.Space.s3)
        .padding(.vertical, Tokens.Space.s2)
        .overlay(alignment: .bottom) { Hairline() }
    }
}

/// The draft record (DraftSection.svelte at 390): its head, the line saying the next run writes it, or
/// its bug with each figure's pair, the figure chips, the positions as a box score with All last, and
/// its basis.
struct DraftView: View {
    @Environment(\.colorScheme) private var colorScheme
    let draft: DraftSectionModel
    let figure: RecordFigure
    let choose: (RecordFigure) -> Void
    var still = false

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            RecordHeadView(title: draft.title, what: draft.what)
            if let waiting = draft.waiting {
                BasisText(waiting)
            } else {
                bug(theme)
                ChipRow(
                    labels: draft.figures, pressed: draft.figures[RecordFigure.allCases.firstIndex(of: figure) ?? 0],
                    choose: { label in
                        if let index = draft.figures.firstIndex(of: label) {
                            choose(RecordFigure.allCases[index])
                        }
                    },
                    still: still
                )
                TableFrame {
                    RecordHeadRow(lead: Words.Records.position, heads: [Words.RecordBox.ours, Words.RecordBox.adp])
                    ForEach(draft.rows) { row in
                        draftRow(row, theme: theme)
                    }
                    if let all = draft.all {
                        draftRow(all, theme: theme, lead: Words.Records.all)
                            .background(theme.color(Tokens.Color.bg))
                    }
                }
                BasisText(draft.basis)
            }
        }
    }

    @ViewBuilder
    private func bug(_ theme: Theme) -> some View {
        if let span = draft.span {
            VStack(alignment: .leading, spacing: Tokens.Space.s3) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(span)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                        .foregroundStyle(theme.color(Tokens.Color.ink2))
                    Text(draft.players ?? "")
                        .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
                }
                ForEach(draft.tiles) { tile in
                    PairTileView(label: tile.label, key: tile.key, pair: tile.pair)
                }
                if let honest = draft.honest {
                    Text(honest)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                        .fixedSize(horizontal: false, vertical: true)
                        .foregroundStyle(theme.color(Tokens.Color.ink2))
                }
            }
            .padding(Tokens.Space.s3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.color(Tokens.Color.surface))
            .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md).strokeBorder(theme.color(Tokens.Color.line)))
        }
    }

    private func draftRow(_ row: DraftRow, theme _: Theme, lead: String? = nil) -> some View {
        let cell = row.cells[figure]
        return HStack(spacing: 0) {
            Text(lead ?? row.position)
                .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .semibold))
                .frame(maxWidth: .infinity, alignment: .leading)
            RecordFigureView(
                cell: RecordCell(head: Words.RecordBox.ours, value: cell?.ours ?? "", same: nil),
                lit: cell?.accented == true
            )
            RecordFigureView(cell: RecordCell(head: Words.RecordBox.adp, value: cell?.adp ?? "", same: nil), lit: false)
        }
        .padding(.horizontal, Tokens.Space.s3)
        .padding(.vertical, Tokens.Space.s2)
        .overlay(alignment: .bottom) { Hairline() }
    }
}

/// Our record with its view model: the saved read at once, then the run's; a pull reads again.
public struct RecordView: View {
    @Environment(\.colorScheme) private var colorScheme
    private let viewModel: RecordViewModel

    public init(viewModel: RecordViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        Group {
            switch viewModel.state {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case let .loaded(model, _, _):
                ScrollView {
                    RecordScreen(
                        model: model, stamp: viewModel.stampWords,
                        choice: RecordChoice(
                            figure: viewModel.figure, position: viewModel.position,
                            draftFigure: viewModel.draftFigure
                        ),
                        actions: RecordActions(
                            figure: { viewModel.choose(figure: $0) }, position: { viewModel.choose(position: $0) },
                            draftFigure: { viewModel.choose(draftFigure: $0) }
                        )
                    )
                }
                .refreshable { await viewModel.load() }
            case let .failed(sentence):
                VStack(spacing: Tokens.Space.s4) {
                    BasisText(sentence)
                    QuietButton(AppWords.Failure.tryAgain) {
                        Task { await viewModel.load() }
                    }
                }
                .padding(Tokens.Space.s5)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(theme.color(Tokens.Color.bg))
        .task { await viewModel.load() }
    }
}
