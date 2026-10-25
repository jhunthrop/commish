import Board
import BoxScore
import CommishCore
import CommishDesign
import SwiftUI

/// What Compare's controls do: a side picked by its slug or cleared, a format chosen, a name opening
/// the sheet.
struct CompareActions {
    let pick: (Int, String?) -> Void
    let format: (String) -> Void
    let open: (SheetPlayer) -> Void

    static var none: CompareActions {
        CompareActions(pick: { _, _ in }, format: { _ in }, open: { _ in })
    }
}

/// A side's picker (the web's .picked and PlayerPicker): the player set on it with the way to pick
/// someone else; or the absent words over a search of the run's players, its first eight hits listed.
struct ComparePicker: View {
    @Environment(\.colorScheme) private var colorScheme
    let slot: CompareSlot
    let label: String
    let search: (String) -> [CompareCandidate]
    let pick: (String?) -> Void
    /// The screen's: a field to type in; a snapshot's draws the empty field still.
    var live = true
    @State private var query = ""

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            switch slot {
            case let .picked(name, initials, headshot):
                HStack(spacing: Tokens.Space.s3) {
                    Headshot(headshot, initials: initials, side: 32)
                    Text(name)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .semibold))
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                        .frame(maxWidth: .infinity, alignment: .leading)
                    QuietButton(Words.ComparePage.pickAnother) { pick(nil) }
                }
                .padding(.horizontal, Tokens.Space.s3)
                .frame(minHeight: 48)
                .background(theme.color(Tokens.Color.surface))
                .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
                .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md)
                    .strokeBorder(theme.color(Tokens.Color.lineStrong)))
            case .missing, .open:
                if slot == .missing {
                    Text(Words.ComparePage.missingTitle)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .bold))
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                    BasisText(Words.ComparePage.missingLine)
                }
                field(theme)
                ForEach(search(query)) { candidate in
                    Button { pick(candidate.slug) } label: { hit(candidate, theme: theme) }
                        .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder
    private var input: some View {
        if live {
            TextField(label, text: $query)
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
        } else {
            Text(label)
                .foregroundStyle(Theme(colorScheme).color(Tokens.Color.ink3))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func field(_ theme: Theme) -> some View {
        input
            .font(Faces.font(.ui, size: Tokens.TypeScale.md))
            .padding(.horizontal, Tokens.Space.s3)
            .frame(minHeight: 48)
            .background(theme.color(Tokens.Color.surface))
            .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md)
                .strokeBorder(theme.color(Tokens.Color.lineStrong)))
            .accessibilityLabel(label)
    }

    private func hit(_ candidate: CompareCandidate, theme: Theme) -> some View {
        HStack {
            Text(candidate.name)
                .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .semibold))
                .foregroundStyle(theme.color(Tokens.Color.ink))
            Spacer()
            SmallCaps(text: candidate.line)
        }
        .padding(.horizontal, Tokens.Space.s3)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }
}

/// Compare's phone columns: the row's label, then each side.
enum CompareColumn {
    static let label: Double = 96
}

/// A side's head over the table: his face, his name opening his sheet, his pill and club.
struct CompareHeadCell: View {
    @Environment(\.colorScheme) private var colorScheme
    let head: CompareHead
    let lead: Bool
    let open: (SheetPlayer) -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            Headshot(head.headshot, initials: head.initials, side: 44)
            Button { open(head.sheetPlayer) } label: {
                Text(head.name)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .bold))
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .foregroundStyle(theme.color(Tokens.Color.ink))
            }
            .buttonStyle(.plain)
            HStack(spacing: Tokens.Space.s1) {
                PositionPill(head.pill)
                SmallCaps(text: head.club)
            }
        }
        .padding(Tokens.Space.s2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.color(lead ? Tokens.Color.accentWash : Tokens.Color.surface))
    }
}

/// A range bar on the pair's shared scale: floor to ceiling, the median marked.
struct RangeBar: View {
    @Environment(\.colorScheme) private var colorScheme
    let range: CompareRange
    let scale: ClosedRange<Double>

    var body: some View {
        let theme = Theme(colorScheme)
        GeometryReader { proxy in
            let span = max(scale.upperBound - scale.lowerBound, 1)
            let place = { (value: Double) in (value - scale.lowerBound) / span * proxy.size.width }
            ZStack(alignment: .leading) {
                Capsule().fill(theme.color(Tokens.Color.surface2)).frame(height: 6)
                Capsule().fill(theme.color(Tokens.Color.ink3))
                    .frame(width: max(place(range.ceiling) - place(range.floor), 2), height: 6)
                    .offset(x: place(range.floor))
                Circle().fill(theme.color(Tokens.Color.ink))
                    .frame(width: 10, height: 10)
                    .offset(x: place(range.median) - 5)
            }
            .frame(maxHeight: .infinity)
        }
        .frame(height: 20)
        .accessibilityLabel(Text(verbatim: [range.floor, range.median, range.ceiling].map { Formatting.fixed($0) }
                .joined(separator: ", ")))
    }
}

/// One row of the table: its label, then each side's figure, the better one bold on the gain's wash,
/// the Gap in its tone, the range as bars.
struct CompareRowView: View {
    @Environment(\.colorScheme) private var colorScheme
    let row: CompareRow
    let table: CompareTable

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(spacing: 0) {
            Text(row.label)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                .textCase(.uppercase)
                .tracking(Tokens.TypeScale.xs * 0.06)
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(theme.color(Tokens.Color.ink3))
                .frame(width: CompareColumn.label, alignment: .leading)
            ForEach(Array(row.cells.enumerated()), id: \.offset) { index, cell in
                cellView(cell, index: index, theme: theme)
                    .padding(.horizontal, Tokens.Space.s2)
                    .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                    .background(cell.wins == true ? theme.color(Tokens.Color.gainBg) : Color.clear)
            }
        }
        .padding(.leading, Tokens.Space.s2)
        .overlay(alignment: .bottom) { Hairline() }
    }

    @ViewBuilder
    private func cellView(_ cell: CompareCell, index: Int, theme: Theme) -> some View {
        if row.range, let range = table.heads[index].range, let scale = table.scale {
            RangeBar(range: range, scale: scale)
        } else {
            Text(cell.text)
                .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: cell.wins == true ? .bold : .semibold))
                .monospacedDigit()
                .foregroundStyle(theme.color(ink(cell)))
        }
    }

    private func ink(_ cell: CompareCell) -> ThemedColor {
        if cell.text == Words.Box.none {
            return Tokens.Color.ink3
        }
        if cell.tone != nil {
            return GapInk.of(cell.tone)
        }
        return cell.wins == false ? Tokens.Color.ink3 : Tokens.Color.ink
    }
}

/// The call and its table: the call band, the heads, the rows, the evidence and the basis.
struct CompareTableView: View {
    @Environment(\.colorScheme) private var colorScheme
    let table: CompareTable
    let open: (SheetPlayer) -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            Text(table.call)
                .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                .textCase(.uppercase)
                .foregroundStyle(theme.color(Tokens.Color.ink))
                .padding(.horizontal, Tokens.Space.s3)
            TableFrame {
                HStack(spacing: 0) {
                    Color.clear.frame(width: CompareColumn.label, height: 1)
                    ForEach(Array(table.heads.enumerated()), id: \.element.id) { index, head in
                        CompareHeadCell(head: head, lead: index == 0, open: open)
                    }
                }
                .padding(.leading, Tokens.Space.s2)
                .overlay(alignment: .bottom) { Hairline() }
                ForEach(table.rows) { row in
                    CompareRowView(row: row, table: table)
                }
            }
            .padding(.horizontal, Tokens.Space.s3)
            Text(table.evidence)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .medium))
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(theme.color(Tokens.Color.ink2))
                .padding(.horizontal, Tokens.Space.s3)
            BoardBasisView(lines: table.basis)
        }
    }
}

/// Compare as its model says it at 390: the heading and its first step, the format chips, the two
/// pickers, then the same-player words or the call with its table, the evidence and the basis.
public struct CompareScreen: View {
    @Environment(\.colorScheme) private var colorScheme
    let model: CompareModel
    let stamp: String?
    let actions: CompareActions
    var live = true

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            ReferenceHead(heading: model.title, stamp: nil, lead: model.lead, stale: stamp)
            if model.formats.count > 1 {
                ChipRow(chips: model.formats, choose: actions.format, live: live)
            }
            VStack(spacing: Tokens.Space.s3) {
                ForEach(Array(model.slots.enumerated()), id: \.offset) { index, slot in
                    ComparePicker(
                        slot: slot, label: model.slotLabels[index], search: model.search,
                        pick: { slug in actions.pick(index, slug) }, live: live
                    )
                }
            }
            .padding(.horizontal, Tokens.Space.s3)
            outcome
        }
        .padding(.vertical, Tokens.Space.s4)
    }

    @ViewBuilder
    private var outcome: some View {
        switch model.outcome {
        case .none:
            EmptyView()
        case let .same(title, line):
            VStack(alignment: .leading, spacing: Tokens.Space.s1) {
                Text(title)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.lg, weight: .bold))
                    .foregroundStyle(Theme(colorScheme).color(Tokens.Color.ink))
                BasisText(line)
            }
            .padding(.horizontal, Tokens.Space.s3)
        case let .table(table):
            CompareTableView(table: table, open: actions.open)
        }
    }
}

/// Compare with its view model: a side picked or cleared and a format chosen through it, a name opening
/// his sheet.
public struct CompareView: View {
    @Environment(PlayerSheetHost.self) private var sheet
    private let viewModel: RunScreenViewModel<CompareModel>

    public init(viewModel: RunScreenViewModel<CompareModel>) {
        self.viewModel = viewModel
    }

    public var body: some View {
        RunScreenContainer(viewModel: viewModel) { model, stamp in
            CompareScreen(model: model, stamp: stamp, actions: CompareActions(
                pick: { slot, slug in Task { await viewModel.choose(slot: slot, slug: slug) } },
                format: { format in Task { await viewModel.choose(format: format) } },
                open: { sheet.open($0) }
            ))
        } pin: { _ in
            EmptyView()
        }
    }
}
