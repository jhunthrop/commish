import BoxScore
import CommishCore
import CommishDesign
import SwiftUI

/// The record table's columns at 390: the week (or the position) takes the rest, each order a figure.
enum RecordColumn {
    static let figure: Double = 64
}

/// A record's head (record.css .rec-head): its name in the number face over what it grades, ruled off.
struct RecordHeadView: View {
    @Environment(\.colorScheme) private var colorScheme
    let title: String
    let what: String

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            Text(title)
                .font(Faces.font(.num, size: Tokens.TypeScale.head, weight: .bold))
                .textCase(.uppercase)
                .foregroundStyle(theme.color(Tokens.Color.ink))
                .accessibilityAddTraits(.isHeader)
            Text(what)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(theme.color(Tokens.Color.ink2))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, Tokens.Space.s2)
        .overlay(alignment: .bottom) { Rectangle().fill(theme.color(Tokens.Color.ink)).frame(height: 2) }
    }
}

/// One figure for ours and a yardstick at one size, the leader named under them (PairTile.svelte):
/// ours accented only where it leads.
struct PairTileView: View {
    @Environment(\.colorScheme) private var colorScheme
    let label: String?
    let key: String?
    let pair: FigurePair

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: 2) {
            if let label {
                Text(label)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                    .textCase(.uppercase)
                    .tracking(Tokens.TypeScale.xs * 0.06)
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
            }
            if let key {
                Text(key)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
            }
            HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s4) {
                figure(Words.Pair.ours, pair.ours, lit: pair.accented, theme)
                figure(pair.name, pair.theirs, lit: false, theme)
                Spacer(minLength: 0)
                if let lead = pair.lead {
                    Text(lead)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                        .foregroundStyle(theme.color(Tokens.Color.ink2))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func figure(_ name: String, _ value: String, lit: Bool, _ theme: Theme) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s1) {
            Text(name)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                .foregroundStyle(theme.color(Tokens.Color.ink3))
            Text(value)
                .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(theme.color(lit ? Tokens.Color.accentText : Tokens.Color.ink))
        }
    }
}

/// The bug over the weeks (WeeklySection.svelte's .bug at 390): the standing and the order or span,
/// each figure's tile, the gaps and the honest sentence; before a week is graded the week and when it
/// grades; or the headline's one figure and its sentence.
struct RecordBugView: View {
    @Environment(\.colorScheme) private var colorScheme
    let bug: RecordBug

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            switch bug {
            case let .tiles(standing, head, tiles, gaps, honest):
                VStack(alignment: .leading, spacing: 2) {
                    if let standing {
                        Text(standing)
                            .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                            .foregroundStyle(theme.color(Tokens.Color.ink2))
                    }
                    Text(head)
                        .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                }
                ForEach(tiles) { tile in
                    tileView(tile, theme)
                }
                said(gaps, theme)
                said(honest, theme)
            case let .pending(title, when, gaps):
                Text(title)
                    .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                Text(when)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                said(gaps, theme)
            case let .headline(value, caption, gaps):
                Text(value)
                    .font(Faces.font(.num, size: Tokens.TypeScale.display, weight: .bold))
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                Text(caption)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                    .fixedSize(horizontal: false, vertical: true)
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                said(gaps, theme)
            }
        }
        .padding(Tokens.Space.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.color(Tokens.Color.surface))
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md).strokeBorder(theme.color(Tokens.Color.line)))
    }

    @ViewBuilder
    private func tileView(_ tile: RecordTile, _ theme: Theme) -> some View {
        if let pairs = tile.pairs {
            VStack(alignment: .leading, spacing: Tokens.Space.s1) {
                ForEach(Array(pairs.enumerated()), id: \.offset) { index, pair in
                    PairTileView(label: index == 0 ? tile.label : nil, key: nil, pair: pair)
                }
            }
        } else {
            HStack(alignment: .firstTextBaseline) {
                Text(tile.label)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                    .textCase(.uppercase)
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
                Spacer(minLength: Tokens.Space.s2)
                Text(tile.ours ?? "")
                    .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                    .monospacedDigit()
                ForEach(tile.beside) { beside in
                    Text([beside.head, beside.value, beside.ours].compactMap(\.self).joined(separator: " "))
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                        .foregroundStyle(theme.color(Tokens.Color.ink2))
                }
            }
        }
    }

    @ViewBuilder
    private func said(_ text: String?, _ theme: Theme) -> some View {
        if let text, !text.isEmpty {
            Text(text)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(theme.color(Tokens.Color.ink2))
        }
    }
}

/// A row of chips that scrolls sideways (ChipGroup.svelte), or lies still in a snapshot.
struct ChipRow: View {
    let labels: [String]
    let pressed: String
    let choose: (String) -> Void
    var still = false

    var body: some View {
        if still {
            chips
        } else {
            ScrollView(.horizontal, showsIndicators: false) { chips }
        }
    }

    private var chips: some View {
        HStack(spacing: Tokens.Space.s2) {
            ForEach(labels, id: \.self) { label in
                ChoiceChip(label, pressed: label == pressed) { choose(label) }
            }
        }
    }
}

/// A table's head: the lead column's word and each order's.
struct RecordHeadRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let lead: String
    let heads: [String]

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(spacing: 0) {
            head(lead, theme).frame(maxWidth: .infinity, alignment: .leading)
            ForEach(heads, id: \.self) { words in
                head(words, theme).frame(width: RecordColumn.figure, alignment: .trailing)
            }
        }
        .padding(.horizontal, Tokens.Space.s3)
        .frame(minHeight: 32)
        .background(theme.color(Tokens.Color.bg))
        .overlay(alignment: .bottom) { Hairline() }
        .accessibilityHidden(true)
    }

    private func head(_ words: String, _ theme: Theme) -> some View {
        Text(words)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
            .textCase(.uppercase)
            .tracking(Tokens.TypeScale.xs * 0.06)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .foregroundStyle(theme.color(Tokens.Color.ink3))
    }
}

/// A figure cell: ours in the accent where it leads, ours over the same weeks beside a yardstick's.
struct RecordFigureView: View {
    @Environment(\.colorScheme) private var colorScheme
    let cell: RecordCell
    let lit: Bool

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .trailing, spacing: 0) {
            Text(cell.value)
                .font(Faces.font(.num, size: Tokens.TypeScale.md, weight: .bold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .foregroundStyle(theme.color(lit ? Tokens.Color.accentText : Tokens.Color.ink))
            if let same = cell.same {
                Text(same)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
            }
        }
        .frame(width: RecordColumn.figure, alignment: .trailing)
    }
}
