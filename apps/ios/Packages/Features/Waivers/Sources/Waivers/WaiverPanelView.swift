import BoxScore
import CommishAPI
import CommishCore
import CommishDesign
import SwiftUI

/// What the position panel draws and does (PositionPanel.svelte): the cards in the toggle's figures, the
/// one open, the toggle, a card tapped, a free agent's Add (the screen's one verb) and a name's sheet.
struct PanelActions {
    let cards: [PanelCard]
    let mode: PanelMode
    let hasWeek: Bool
    let opened: PanelCard?
    let choose: (PanelMode) -> Void
    let toggle: (String) -> Void
    let add: (WaiverRow) -> Void
    let open: (SheetPlayer) -> Void
    /// Draws the cards at rest (a snapshot draws no scroll view).
    var still = false
}

/// The phone's panel columns: the player taking the rest, the figure, Beats and the Add. A card is at
/// least 120 wide, as Android's, and grows rather than cut its rank.
enum PanelColumn {
    static let card: Double = 120
    static let figure: Double = 60
    static let beats: Double = 88
    static let act: Double = 44
    /// The Add's tap target, the platform's minimum.
    static let target: Double = 44
}

/// The Waivers screen's position panel (web PositionPanel.svelte at 390): "Your positions" with the
/// toggle, one row of cards scrolling sideways (a position each, its rank in the league, the member's
/// figure, the need mark and the median team's), and the open card's ranked list under the row: the
/// member's players first, then the best free agents there, each with the table's Beats words and Add.
/// Nothing at all from an answer without the panel.
struct WaiverPanelView: View {
    @Environment(\.colorScheme) private var colorScheme
    let panel: PanelActions

    var body: some View {
        if !panel.cards.isEmpty {
            VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                head
                if panel.still {
                    // The row as a phone shows it before a swipe: its first cards, the rest past the edge.
                    cards.fixedSize(horizontal: true, vertical: false)
                        .frame(width: 0, alignment: .leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .clipped()
                } else {
                    ScrollView(.horizontal, showsIndicators: false) { cards }
                }
                if let opened = panel.opened {
                    PanelListView(card: opened, panel: panel)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Words.WaiverPanel.label)
        }
    }

    private var head: some View {
        let theme = Theme(colorScheme)
        return HStack(spacing: Tokens.Space.s2) {
            Text(Words.WaiverPanel.label)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                .textCase(.uppercase)
                .tracking(Tokens.TypeScale.xs * 0.08)
                .foregroundStyle(theme.color(Tokens.Color.ink2))
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            if panel.hasWeek {
                ForEach(PanelMode.allCases, id: \.self) { mode in
                    chip(mode, theme)
                }
            } else {
                Text(Words.WaiverPanel.season)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
            }
        }
    }

    private func chip(_ mode: PanelMode, _ theme: Theme) -> some View {
        let lit = panel.mode == mode
        return Button { panel.choose(mode) } label: {
            Text(mode.word)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                .foregroundStyle(theme.color(lit ? Tokens.Color.accentInk : Tokens.Color.ink2))
                .padding(.horizontal, Tokens.Space.s3)
                .frame(minHeight: 28)
                .background(Capsule().fill(theme.color(lit ? Tokens.Color.accent : Tokens.Color.surface)))
                .overlay(Capsule().strokeBorder(theme.color(lit ? Tokens.Color.accent : Tokens.Color.lineStrong)))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(lit ? .isSelected : [])
    }

    private var cards: some View {
        HStack(spacing: Tokens.Space.s2) {
            ForEach(panel.cards) { card in
                PanelCardView(card: card, open: panel.opened?.key == card.key) { panel.toggle(card.key) }
            }
        }
    }
}

/// One card, three lines: the position and its rank, the member's figure with Need, the median team's.
private struct PanelCardView: View {
    @Environment(\.colorScheme) private var colorScheme
    let card: PanelCard
    let open: Bool
    let tap: () -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        Button(action: tap) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(card.word)
                        .font(Faces.font(.num, size: Tokens.TypeScale.sm, weight: .bold))
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                    Text(card.place)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                        .foregroundStyle(theme.color(Tokens.Color.ink2))
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                }
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(card.figure)
                        .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                    if card.need {
                        Pill(Words.WaiverPanel.need, tone: .loss)
                    }
                }
                Text(card.median ?? " ")
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .monospacedDigit()
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
            }
            .frame(minWidth: PanelColumn.card - Tokens.Space.s2 * 2, alignment: .leading)
            .padding(Tokens.Space.s2)
            .background(theme.color(open ? Tokens.Color.accentWash : Tokens.Color.surface))
            .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md)
                .strokeBorder(theme.color(open ? Tokens.Color.accent : Tokens.Color.line)))
        }
        .buttonStyle(.plain)
        .accessibilityLabel([card.rank, card.figure, card.need ? Words.WaiverPanel.need : nil, card.median]
            .compactMap(\.self).joined(separator: ", "))
        .accessibilityAddTraits(open ? .isSelected : [])
    }
}

/// The open card's list: its rank with what the rank is, the heads, the member's players, then the free
/// agents with their Beats and Add, or the line that none we list plays there.
private struct PanelListView: View {
    @Environment(\.colorScheme) private var colorScheme
    let card: PanelCard
    let panel: PanelActions

    var body: some View {
        let theme = Theme(colorScheme)
        TableFrame {
            VStack(alignment: .leading, spacing: 2) {
                Text(card.rank)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .bold))
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                Text(WaiverPanel.explain(panel.mode, cards: [card]))
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Tokens.Space.s3)
            .padding(.vertical, Tokens.Space.s2)
            .background(theme.color(Tokens.Color.surface2))
            .overlay(alignment: .bottom) { Hairline() }
            heads(theme)
            ForEach(card.mine) { entry in PanelEntryRow(entry: entry, panel: panel) }
            if card.free.isEmpty {
                NoteRow(text: Words.WaiverPanel.noneFree)
            }
            ForEach(card.free) { entry in PanelEntryRow(entry: entry, panel: panel) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(card.rank)
    }

    private func heads(_ theme: Theme) -> some View {
        HStack(spacing: 0) {
            head(Words.Box.player, theme).frame(maxWidth: .infinity, alignment: .leading)
            head(panel.mode.head, theme).frame(width: PanelColumn.figure, alignment: .trailing)
            head(Words.Waivers.beats, theme).frame(width: PanelColumn.beats, alignment: .trailing)
            Color.clear.frame(width: PanelColumn.act, height: 1)
        }
        .padding(.horizontal, Tokens.Space.s2)
        .frame(minHeight: 28)
        .overlay(alignment: .bottom) { Hairline() }
        .accessibilityHidden(true)
    }

    private func head(_ words: String, _ theme: Theme) -> some View {
        Text(words)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
            .textCase(.uppercase)
            .tracking(Tokens.TypeScale.xs * 0.06)
            .lineLimit(2)
            .multilineTextAlignment(.trailing)
            .fixedSize(horizontal: false, vertical: true)
            .foregroundStyle(theme.color(Tokens.Color.ink3))
    }
}

/// One player on the list: his name (it opens his sheet) and club with his mark, the figure, a free
/// agent's Beats words and Add.
private struct PanelEntryRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let entry: PanelEntry
    let panel: PanelActions

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(alignment: .center, spacing: 0) {
            VStack(alignment: .leading, spacing: 1) {
                name(theme)
                Text(entry.mark)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Figure(text: entry.figure, width: PanelColumn.figure, muted: entry.figure == Words.Box.none)
            Text(entry.beats ?? "")
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: entry.pool?.gains == true ? .bold : .regular))
                .monospacedDigit()
                .multilineTextAlignment(.trailing)
                .foregroundStyle(theme.color(entry.pool?.gains == true ? Tokens.Color.gainInk : Tokens.Color.ink2))
                .fixedSize(horizontal: false, vertical: true)
                .frame(width: PanelColumn.beats, alignment: .trailing)
            add(theme).frame(width: PanelColumn.act, alignment: .trailing)
        }
        .padding(.horizontal, Tokens.Space.s2)
        .padding(.vertical, 6)
        .background(theme.color(Tokens.Color.surface))
        .overlay(alignment: .bottom) { Hairline() }
    }

    @ViewBuilder
    private func name(_ theme: Theme) -> some View {
        let words = (Text(entry.name).bold().foregroundStyle(theme.color(Tokens.Color.ink))
            + Text(verbatim: " \(entry.team)").foregroundStyle(theme.color(Tokens.Color.ink3)))
            .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
            .lineLimit(1)
        if let player = entry.sheetPlayer {
            Button { panel.open(player) } label: { words }
                .buttonStyle(.plain)
                .accessibilityLabel(entry.full)
        } else {
            words.accessibilityLabel(entry.full)
        }
    }

    @ViewBuilder
    private func add(_ theme: Theme) -> some View {
        if let pool = entry.pool {
            Button { panel.add(pool.source) } label: {
                Image(systemName: "plus")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.color(pool.gains ? Tokens.Color.ink : Tokens.Color.ink3))
                    .frame(minWidth: 30, minHeight: 30)
                    .background(RoundedRectangle(cornerRadius: Tokens.Radius.sm)
                        .strokeBorder(theme.color(Tokens.Color.lineStrong)))
                    // The drawn square stays compact; the tap target is the 44 pt minimum.
                    .frame(width: PanelColumn.target, height: PanelColumn.target, alignment: .trailing)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(Words.InSeason.add) \(entry.full)")
        } else {
            // The member's own: no verb, the column kept so his figure sits in it.
            Color.clear.frame(height: 1)
        }
    }
}
