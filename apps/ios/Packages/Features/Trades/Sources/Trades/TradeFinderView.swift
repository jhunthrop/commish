import BoxScore
import CommishCore
import CommishDesign
import SwiftUI

/// The finder as a phone draws it (TradeFinder.svelte at 390): the heads, You give over the deal and
/// the two gains that sort it, the line under them saying what a Gain is, then one trade a row; a tap
/// opens the trade under its row.
struct TradeFinderView: View {
    let model: TradesModel
    let shown: TradesShown
    let actions: TradeActions

    var body: some View {
        TableFrame {
            FinderHead(model: model, sort: shown.sort, choose: actions.sort)
            ForEach(model.rows) { line in
                let open = shown.opened.contains(line.id)
                FinderRowView(line: line, open: open, sort: shown.sort) { actions.toggle(line.id) }
                if open {
                    OpenedTradeView(
                        line: line, model: model, copied: shown.copied[line.id],
                        actions: actions
                    )
                }
            }
            ForEach(model.noIdeas) { NoIdeaRow(line: $0) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Words.Trades.every)
    }
}

/// A team the finder lists no trade with (B271): "With Carried by QJs", then "No idea they would
/// take.", quiet, nothing to open.
struct NoIdeaRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let line: NoIdeaLine

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 2) {
            Text(line.with)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                .foregroundStyle(theme.color(Tokens.Color.ink2))
            Text(line.note)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                .foregroundStyle(theme.color(Tokens.Color.ink2))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Tokens.Space.s2)
        .padding(.leading, FinderColumn.open)
        .padding(.vertical, 6)
        .overlay(alignment: .bottom) { Hairline() }
        .accessibilityElement(children: .combine)
    }
}

/// The heads: You give, then Your gain and Their gain, each a button that sorts by it, the sorted one
/// with its chevron; the line under them saying what a Gain is.
struct FinderHead: View {
    @Environment(\.colorScheme) private var colorScheme
    let model: TradesModel
    let sort: TradeSort
    let choose: (TradeSort) -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                head(Words.Trades.give, theme: theme)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, FinderColumn.open)
                ForEach(TradeSort.allCases, id: \.self) { order in
                    Button { choose(order) } label: {
                        HStack(spacing: 2) {
                            head(order.head, theme: theme)
                                .multilineTextAlignment(.trailing)
                            if sort == order {
                                Image(systemName: "chevron.down")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                            }
                        }
                        .frame(width: FinderColumn.gain, alignment: .trailing)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(sort == order ? .isSelected : [])
                }
            }
            .padding(.horizontal, Tokens.Space.s2)
            .frame(minHeight: 40)
            if let basis = model.gainBasis {
                Text(basis)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Tokens.Space.s2)
                    .padding(.bottom, 6)
            }
        }
        .background(theme.color(Tokens.Color.bg))
        .overlay(alignment: .bottom) { Hairline() }
    }

    private func head(_ words: String, theme: Theme) -> some View {
        Text(words)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
            .textCase(.uppercase)
            .tracking(Tokens.TypeScale.xs * 0.06)
            .fixedSize(horizontal: false, vertical: true)
            .foregroundStyle(theme.color(Tokens.Color.ink3))
    }
}

/// The finder's phone columns: the chevron that opens a trade, and each gain.
enum FinderColumn {
    static let open: Double = 36
    static let gain: Double = 62
}

/// One trade: the chevron, "Rodgers > Skattebo and Strong", "with Max_Jensen10, you drop Dart" and the
/// need it fills under it, then both gains, each in its ink, the sorted column on its tint.
struct FinderRowView: View {
    @Environment(\.colorScheme) private var colorScheme
    let line: TradeLine
    let open: Bool
    let sort: TradeSort
    let toggle: () -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        Button(action: toggle) {
            HStack(spacing: 0) {
                Image(systemName: "chevron.down")
                    .font(.system(size: 13, weight: .semibold))
                    .rotationEffect(.degrees(open ? 180 : 0))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                    .frame(width: 26, height: 30)
                    .background(RoundedRectangle(cornerRadius: Tokens.Radius.sm)
                        .strokeBorder(theme.color(Tokens.Color.lineStrong)))
                    .frame(width: FinderColumn.open, alignment: .leading)
                deal(theme)
                    .frame(maxWidth: .infinity, alignment: .leading)
                gain(line.mine, sorted: sort == .mine, theme: theme)
                gain(line.theirs, sorted: sort == .theirs, theme: theme)
            }
            .fixedSize(horizontal: false, vertical: true)
            .padding(.leading, Tokens.Space.s2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(theme.color(open ? Tokens.Color.surface2 : Tokens.Color.surface))
        .overlay(alignment: .bottom) { Hairline() }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(line.offer)
        .accessibilityValue("\(line.mine.words), \(line.theirs.words)")
        .accessibilityHint(Words.Trades.why)
        .accessibilityAddTraits(open ? .isSelected : [])
    }

    private func deal(_ theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            (Text(line.give).bold() + Text(verbatim: " ")
                + Text(Image(systemName: "chevron.right")).font(.system(size: 9, weight: .bold))
                .foregroundStyle(theme.color(Tokens.Color.ink3)) + Text(verbatim: " ")
                + Text(line.get).bold().foregroundStyle(theme.color(Tokens.Color.accentText)))
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                .fixedSize(horizontal: false, vertical: true)
            Text(line.with)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                .foregroundStyle(theme.color(Tokens.Color.ink2))
                .fixedSize(horizontal: false, vertical: true)
            if let need = line.need {
                Text(need)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .foregroundStyle(theme.color(Tokens.Color.ink))
        .padding(.vertical, Tokens.Space.s2)
    }

    private func gain(_ cell: GainCell, sorted: Bool, theme: Theme) -> some View {
        Text(cell.words)
            .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
            .monospacedDigit()
            .foregroundStyle(TradeInk.color(cell.tone, theme: theme))
            .frame(width: FinderColumn.gain, alignment: .trailing)
            .padding(.trailing, Tokens.Space.s2)
            .frame(maxHeight: .infinity)
            .background(sorted ? theme.mix(Tokens.Color.gainBg, 60, into: Tokens.Color.surface) : .clear)
    }
}

/// A figure's ink by its tone: a gain's, a loss's, or the plain ink.
enum TradeInk {
    static func color(_ tone: Tone, theme: Theme) -> Color {
        switch tone {
        case .gain: theme.color(Tokens.Color.gainInk)
        case .loss: theme.color(Tokens.Color.lossInk)
        case .even: theme.color(Tokens.Color.ink)
        }
    }
}

/// A trade opened (TradeFinder's opened row at 390): its week in one line and the drop's sentence; both
/// sides' players as box-score rows (Give and Drop from the member's roster, Get from theirs), each name
/// opening the player sheet; Build from this, which opens the builder with the trade and its check; the
/// verb and the line under it.
struct OpenedTradeView: View {
    @Environment(\.colorScheme) private var colorScheme
    let line: TradeLine
    let model: TradesModel
    let copied: CopiedLine?
    let actions: TradeActions

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            ForEach([line.opened.week, line.opened.dropReason].compactMap(\.self), id: \.self) { said in
                Text(said)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                    .fixedSize(horizontal: false, vertical: true)
            }
            TableFrame {
                HeadRow(style: .trade)
                ForEach(line.opened.groups) { group in
                    SectionRow(title: group.head)
                    ForEach(group.rows) { cells in
                        BoxRowView(cells: cells, bench: false, actions: RowActions(open: actions.open), style: .trade)
                    }
                }
            }
            verb(theme)
        }
        .foregroundStyle(theme.color(Tokens.Color.ink))
        .padding(Tokens.Space.s3)
        .background(theme.color(Tokens.Color.surface2))
        .overlay(alignment: .bottom) { Hairline() }
    }

    private func verb(_ theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            HStack(spacing: Tokens.Space.s2) {
                if line.built != nil {
                    QuietButton(Words.Trades.fromThis) { actions.builder.from(line.id) }
                        .padding(.horizontal, Tokens.Space.s2)
                }
                Spacer(minLength: 0)
                QuietButton(model.verb) { actions.press(line.id) }
                    .padding(.horizontal, Tokens.Space.s3)
                    .background(
                        RoundedRectangle(cornerRadius: Tokens.Radius.md).fill(theme.color(Tokens.Color.surface))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: Tokens.Radius.md)
                            .strokeBorder(theme.color(Tokens.Color.lineStrong))
                    )
                    .disabled(model.page == nil)
            }
            if let copied {
                CopiedText(line: copied, page: model.page)
            } else if let reason = model.reason {
                BasisText(reason)
            }
        }
    }
}
