import BoxScore
import CommishCore
import CommishDesign
import SwiftUI

/// The switch between the rosters as a phone stacks them (TradeBuilder's .switch): "You, 1" and
/// "Max_Jensen10, 2", one roster drawn at a time; the ticks are the picks, so they hold across it.
struct RosterSwitchView: View {
    let rosters: RosterSwitch
    let drawn: TradePicks.Side
    let show: (TradePicks.Side) -> Void

    var body: some View {
        HStack(spacing: Tokens.Space.s2) {
            ChoiceChip(rosters.yours, pressed: drawn == .give) { show(.give) }
            ChoiceChip(rosters.theirs, pressed: drawn == .get) { show(.get) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Words.Analyzer.rosters)
    }
}

/// The roster the switch shows (TradeBox.svelte at 390): its head in one line (the member's team with
/// its face, You and its record, or the team choice on theirs) and what the side holds, the heads, and
/// each row at the Lineup's height with its tick, two a side at most.
struct BuilderBoxView: View {
    @Environment(\.colorScheme) private var colorScheme
    let shown: TradesShown
    let actions: TradeActions

    private var side: TradePicks.Side {
        shown.drawn
    }

    private var box: BuilderBox {
        side == .give ? shown.builder.yours : shown.builder.theirs
    }

    var body: some View {
        let theme = Theme(colorScheme)
        TableFrame {
            head(theme)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Tokens.Space.s2)
                .padding(.vertical, 6)
                .background(theme.color(Tokens.Color.bg))
                .overlay(alignment: .bottom) {
                    Rectangle()
                        .fill(theme.color(box.mine ? Tokens.Color.accent : Tokens.Color.lineStrong))
                        .frame(height: 2)
                }
            if !box.rows.isEmpty {
                HeadRow(style: .trade)
            }
            ForEach(box.rows) { row in
                PickRowView(cells: row.cells, tick: row.tick, actions: RowActions(open: actions.open)) {
                    actions.tap(side, row.id)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(box.team.isEmpty ? Words.Builder.team : box.team)
    }

    private func head(_ theme: Theme) -> some View {
        HStack(spacing: Tokens.Space.s2) {
            if box.mine {
                Avatar(box.initials, side: 22, mine: true)
                Text(box.team)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .bold))
                    .lineLimit(1)
                Text(Words.Box.you)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                    .textCase(.uppercase)
                    .foregroundStyle(theme.color(Tokens.Color.accentText))
            } else {
                // The team whole: what the side holds takes the room left, in two short lines.
                TeamMenu(builder: shown.builder, choose: actions.team)
                    .fixedSize(horizontal: true, vertical: false)
                    .layoutPriority(1)
            }
            Spacer(minLength: Tokens.Space.s1)
            Text(box.holds)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                .foregroundStyle(theme.color(Tokens.Color.ink2))
                .lineLimit(2)
                .multilineTextAlignment(.trailing)
        }
        .foregroundStyle(theme.color(Tokens.Color.ink))
    }
}

/// The team the trade is with, by name, owner and record (TradeBuilder's PickSelect at the head of
/// their roster), "Pick a team" before one is chosen.
struct TeamMenu: View {
    let builder: TradeBuilderModel
    let choose: (Int) -> Void

    var body: some View {
        ChoiceField(
            label: Words.Builder.team, value: builder.teamLabel, chosen: builder.team.map(String.init),
            groups: [ChoiceGroup(title: nil, choices: builder.teams.map { (String($0.id), $0.choice) })]
        ) { key in
            if let team = Int(key) {
                choose(team)
            }
        }
    }
}

/// The verdict under the rosters (TradeBuilder's .verdict at 390): one box-score row per side, read
/// again on every tick, the answer line under it with the close call's chip, then the platform's line
/// and the builder's own.
struct VerdictView: View {
    @Environment(\.colorScheme) private var colorScheme
    let builder: TradeBuilderModel
    let checking: Bool

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            TradeBugView(bug: builder.bug)
                .opacity(checking ? 0.6 : 1)
            HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s2) {
                Text(builder.sentence)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: builder.quiet ? .regular : .medium))
                    .foregroundStyle(theme.color(builder.quiet ? Tokens.Color.ink2 : Tokens.Color.ink))
                    .fixedSize(horizontal: false, vertical: true)
                    .opacity(checking ? 0.6 : 1)
                if let close = builder.close {
                    Pill(close)
                }
            }
            .accessibilityElement(children: .combine)
            if let line = builder.hostLine {
                BasisText(line)
            }
            BasisText(builder.own)
        }
    }
}

/// The pin above the bar (TradeBuilder's .pin under 1180 px): why a side would not take it, or the two
/// gains, or the answer line; Share and the verb; the line under them once pressed.
struct BuilderPin: View {
    @Environment(\.colorScheme) private var colorScheme
    let builder: TradeBuilderModel
    let verb: String
    let page: URL?
    let checking: Bool
    let copied: CopiedLine?
    let shared: String?
    let actions: TradeActions

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            HStack(spacing: Tokens.Space.s2) {
                gains(theme)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .opacity(checking ? 0.6 : 1)
                QuietButton(Words.Analyzer.share, action: actions.share)
                    .disabled(!builder.live)
                    .opacity(builder.live ? 1 : 0.5)
                Button(action: actions.press) {
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
            if let shared {
                Text(shared)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
            }
            if let copied {
                CopiedText(line: copied, page: page)
            }
        }
        .padding(.horizontal, Tokens.Space.s3)
        .padding(.vertical, Tokens.Space.s2)
        .background(theme.color(Tokens.Color.surface))
        .overlay(alignment: .top) {
            Rectangle().fill(theme.color(Tokens.Color.lineStrong)).frame(height: 1)
        }
    }

    @ViewBuilder
    private func gains(_ theme: Theme) -> some View {
        switch builder.pin {
        case let .gains(mine, rest):
            (Text(mine)
                .font(Faces.font(.num, size: Tokens.TypeScale.md, weight: .bold))
                .foregroundStyle(theme.color(Tokens.Color.gainInk))
                + Text(verbatim: " \(rest)")
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                .foregroundStyle(theme.color(Tokens.Color.ink2)))
                .fixedSize(horizontal: false, vertical: true)
        case let .words(words):
            Text(words)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                .foregroundStyle(theme.color(Tokens.Color.ink2))
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
