import BoxScore
import CommishCore
import CommishDesign
import SwiftUI

/// The builder as a phone draws it (TradeBuilder.svelte at 390): Build a trade with the team chosen by
/// name and record and Not now; the scoreboard of each side before and after; the answer line, quiet
/// while it is the prompt, with the close call's chip; the builder's own line; then the member's roster
/// and theirs as box scores with a tick on every row, two a side at most. The gains and the verb are
/// pinned above the bar by the caller (BuilderPin), as the web pins them.
struct TradeBuilderView: View {
    @Environment(\.colorScheme) private var colorScheme
    let builder: TradeBuilderModel
    let checking: Bool
    let actions: TradeActions

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            BuilderBoardView(builder: builder, checking: checking, actions: actions)
            BuilderBoxView(box: builder.yours, side: .give, actions: actions)
            if let theirs = builder.theirs {
                BuilderBoxView(box: theirs, side: .get, actions: actions)
            }
        }
        .padding(Tokens.Space.s4)
        .background(theme.color(Tokens.Color.surface))
        .overlay(alignment: .leading) {
            Rectangle().fill(theme.color(Tokens.Color.accent)).frame(width: 4)
        }
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md).strokeBorder(theme.color(Tokens.Color.line)))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Words.Builder.open)
    }
}

/// The builder's head (Build a trade, Not now, the team), its scoreboard, the answer line with the
/// close call's chip, and its own line.
struct BuilderBoardView: View {
    @Environment(\.colorScheme) private var colorScheme
    let builder: TradeBuilderModel
    let checking: Bool
    let actions: TradeActions

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            head(theme)
            TradeBugView(bug: builder.bug)
                .opacity(checking ? 0.6 : 1)
            HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s2) {
                Text(builder.sentence)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: builder.quiet ? .regular : .semibold))
                    .foregroundStyle(theme.color(builder.quiet ? Tokens.Color.ink2 : Tokens.Color.ink))
                    .fixedSize(horizontal: false, vertical: true)
                    .opacity(checking ? 0.6 : 1)
                if let close = builder.close {
                    Pill(close)
                }
            }
            BasisText(builder.own)
        }
    }

    private func head(_ theme: Theme) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            HStack {
                Text(Words.Builder.open)
                    .font(Faces.font(.num, size: Tokens.TypeScale.xl, weight: .bold))
                    .textCase(.uppercase)
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: Tokens.Space.s2)
                QuietButton(Words.Builder.notNow, action: actions.builder.close)
            }
            HStack(spacing: Tokens.Space.s2) {
                Text(Words.Builder.team)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                TeamMenu(builder: builder, choose: actions.builder.team)
            }
        }
    }
}

/// The team the trade is with, by name, owner and record (TradeBuilder's PickSelect).
struct TeamMenu: View {
    let builder: TradeBuilderModel
    let choose: (Int) -> Void

    var body: some View {
        let chosen = builder.teams.first { $0.id == builder.team }
        ChoiceField(
            label: Words.Builder.team, value: chosen?.choice ?? "", chosen: chosen.map { String($0.id) },
            groups: [ChoiceGroup(title: nil, choices: builder.teams.map { (String($0.id), $0.choice) })]
        ) { key in
            if let team = Int(key) {
                choose(team)
            }
        }
    }
}

/// One roster of the builder (TradeBox.svelte at 390): the team with its face, You on the member's,
/// its record, what the side holds, the heads, and its rows with their ticks.
struct BuilderBoxView: View {
    @Environment(\.colorScheme) private var colorScheme
    let box: BuilderBox
    let side: TradePicks.Side
    let actions: TradeActions

    var body: some View {
        let theme = Theme(colorScheme)
        TableFrame {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Tokens.Space.s2) {
                    Avatar(box.initials, side: 30, mine: box.mine)
                    Text(box.team)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .bold))
                        .lineLimit(1)
                    if box.mine {
                        Text(Words.Box.you)
                            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                            .textCase(.uppercase)
                            .foregroundStyle(theme.color(Tokens.Color.accentText))
                    }
                    if !box.aside.isEmpty {
                        Text(box.aside)
                            .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .medium))
                            .foregroundStyle(theme.color(Tokens.Color.ink3))
                            .lineLimit(1)
                    }
                }
                Text(box.holds)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
            }
            .foregroundStyle(theme.color(Tokens.Color.ink))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Tokens.Space.s3)
            .background(theme.color(Tokens.Color.bg))
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(theme.color(box.mine ? Tokens.Color.accent : Tokens.Color.lineStrong))
                    .frame(height: 2)
            }
            HeadRow(style: .trade)
            ForEach(box.rows) { row in
                PickRowView(
                    cells: row.cells, line: row.line, tick: row.tick, actions: RowActions(open: actions.open)
                ) { actions.builder.tap(side, row.id) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(box.team)
    }
}

/// The builder's pin above the bar (TradeBuilder's .pin under 760 px), on the lit board: the two
/// gains, or the answer line before an answer; the verb; the line under it once pressed.
struct BuilderPin: View {
    @Environment(\.colorScheme) private var colorScheme
    let builder: TradeBuilderModel
    let verb: String
    let page: URL?
    let copied: CopiedLine?
    let press: () -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            HStack(spacing: Tokens.Space.s2) {
                gains(theme)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button(action: press) {
                    Text(verb)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .bold))
                        .foregroundStyle(theme.color(builder.verbEnabled ? Tokens.Color.accentInk : Tokens.Color.ink3))
                        .padding(.horizontal, Tokens.Space.s3)
                        .frame(minHeight: 40)
                        .background(
                            RoundedRectangle(cornerRadius: Tokens.Radius.md)
                                .fill(theme.color(builder.verbEnabled ? Tokens.Color.accent : Tokens.Color.surface2))
                        )
                }
                .buttonStyle(.plain)
                .disabled(!builder.verbEnabled)
            }
            if let copied {
                CopiedText(line: copied, page: page, onBoard: true)
            }
        }
        .padding(.horizontal, Tokens.Space.s3)
        .padding(.vertical, Tokens.Space.s2)
        .background(theme.color(Tokens.Color.scoreboard))
        .foregroundStyle(theme.color(Tokens.Color.scoreboardInk))
    }

    @ViewBuilder
    private func gains(_ theme: Theme) -> some View {
        switch builder.pin {
        case let .gains(mine, rest):
            (Text(mine)
                .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
                .foregroundStyle(theme.color(Tokens.Color.scoreboardNum))
                + Text(verbatim: " \(rest)").font(Faces.font(.ui, size: Tokens.TypeScale.xs)))
                .fixedSize(horizontal: false, vertical: true)
        case let .words(words):
            Text(words)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                .lineLimit(2)
        }
    }
}
