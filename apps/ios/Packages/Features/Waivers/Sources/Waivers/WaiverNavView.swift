import BoxScore
import CommishCore
import CommishDesign
import SwiftUI

/// What the position cards draw and do (web PositionNav.svelte): the cards in the toggle's figures, the
/// chosen one, the toggle, the line over the comparison; a card chosen, the toggle set.
struct NavActions {
    let cards: [NavCard]
    let chosen: String
    let mode: PanelMode
    let hasWeek: Bool
    let lead: NavLead?
    let choose: (String) -> Void
    let chooseMode: (PanelMode) -> Void
    /// Draws the row at rest, the chosen card in view (a snapshot draws no scroll view).
    var still = false
}

/// The card's measures: at least 120 wide, as Lane 304's panel card, growing rather than cut its rank.
enum NavMeasure {
    static let card: Double = 120
    static let meter: Double = 4
    /// The chosen card's pointer down to the comparison it opens.
    static let pointer: Double = 12
}

/// The Waivers screen's navigation (web PositionNav.svelte at 390): "Your positions" with the toggle, one
/// row of cards scrolling sideways (All first, then a card a position the league starts with the member's
/// rank there, his figure against the median and the Need mark), the chosen card solid ink and kept in
/// view; the rank's meaning once a mode under the row; then the chosen card's line over the comparison.
struct WaiverNavView: View {
    @Environment(\.colorScheme) private var colorScheme
    let nav: NavActions

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            head(theme)
            if nav.still {
                // The row as a phone shows it with the chosen card scrolled into view: a part card at an edge
                // says the row scrolls.
                cards(Array(nav.cards.dropFirst(max(0, chosenIndex - 2))))
                    .fixedSize(horizontal: true, vertical: false)
                    .offset(x: chosenIndex >= 2 && chosenIndex < nav.cards.count - 1 ? -NavMeasure.card / 2 : 0)
                    .frame(width: 0, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .clipped()
            } else {
                ScrollViewReader { reader in
                    ScrollView(.horizontal, showsIndicators: false) { cards(nav.cards) }
                        .onAppear { reader.scrollTo(nav.chosen) }
                        .onChange(of: nav.chosen) { _, chosen in
                            withAnimation { reader.scrollTo(chosen) }
                        }
                }
            }
            Text(nav.mode.explain)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                .foregroundStyle(theme.color(Tokens.Color.ink3))
                .fixedSize(horizontal: false, vertical: true)
            if let lead = nav.lead {
                leadLine(lead, theme)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Words.WaiverPanel.label)
    }

    private var chosenIndex: Int {
        nav.cards.firstIndex { $0.key == nav.chosen } ?? 0
    }

    private func head(_ theme: Theme) -> some View {
        HStack(spacing: Tokens.Space.s2) {
            Text(Words.WaiverPanel.label)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
                .textCase(.uppercase)
                .tracking(Tokens.TypeScale.xs * 0.08)
                .foregroundStyle(theme.color(Tokens.Color.ink2))
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            if nav.hasWeek {
                HStack(spacing: Tokens.Space.s2) {
                    ForEach(PanelMode.allCases, id: \.self) { mode in
                        chip(mode, theme)
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Words.WaiverNav.figuresFor)
            } else {
                Text(Words.WaiverPanel.season)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
            }
        }
    }

    private func chip(_ mode: PanelMode, _ theme: Theme) -> some View {
        let lit = nav.mode == mode
        return Button { nav.chooseMode(mode) } label: {
            Text(mode.word)
                .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                .foregroundStyle(theme.color(lit ? Tokens.Color.bg : Tokens.Color.ink2))
                .padding(.horizontal, Tokens.Space.s3)
                .frame(minHeight: 30)
                .background(Capsule().fill(theme.color(lit ? Tokens.Color.ink : Tokens.Color.surface)))
                .overlay(Capsule().strokeBorder(theme.color(lit ? Tokens.Color.ink : Tokens.Color.lineStrong)))
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(lit ? .isSelected : [])
    }

    private func cards(_ cards: [NavCard]) -> some View {
        HStack(alignment: .top, spacing: Tokens.Space.s2) {
            ForEach(cards) { card in
                NavCardView(card: card, chosen: card.key == nav.chosen) { nav.choose(card.key) }
                    .id(card.key)
            }
        }
        .padding(.bottom, NavMeasure.pointer / 2 + 2)
    }

    private func leadLine(_ lead: NavLead, _ theme: Theme) -> some View {
        (Text(lead.head).font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .bold))
            .foregroundStyle(theme.color(Tokens.Color.ink))
            + Text(lead.words.map { "  \($0)" } ?? "")
            .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
            .foregroundStyle(theme.color(Tokens.Color.ink2)))
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, Tokens.Space.s1)
    }
}

/// One card: the position with the Pickup mark, its rank, the member's figure with its tag and Need, the
/// meter against the median's tick, the median team's figure; or what it waits on. The chosen card is solid
/// ink with a pointer down to the comparison.
private struct NavCardView: View {
    @Environment(\.colorScheme) private var colorScheme
    let card: NavCard
    let chosen: Bool
    let tap: () -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        Button(action: tap) {
            VStack(alignment: .leading, spacing: 2) {
                top(theme)
                if let place = card.place {
                    Text(place)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                        .foregroundStyle(muted(theme))
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                }
                if let waits = card.waits {
                    Text(waits)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                        .foregroundStyle(muted(theme))
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(width: NavMeasure.card - Tokens.Space.s2 * 2, alignment: .leading)
                } else {
                    figures(theme)
                    meter(theme)
                    Text(card.foot ?? " ")
                        .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                        .monospacedDigit()
                        .foregroundStyle(chosen ? muted(theme) : theme.color(Tokens.Color.ink3))
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                }
            }
            .frame(minWidth: NavMeasure.card - Tokens.Space.s2 * 2, alignment: .leading)
            .padding(Tokens.Space.s2)
            .background(theme.color(chosen ? Tokens.Color.ink : Tokens.Color.surface))
            .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md)
                .strokeBorder(theme.color(chosen ? Tokens.Color.ink : Tokens.Color.lineStrong)))
            .overlay(alignment: .bottom) {
                if chosen {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(theme.color(Tokens.Color.ink))
                        .frame(width: NavMeasure.pointer, height: NavMeasure.pointer)
                        .rotationEffect(.degrees(45))
                        .offset(y: NavMeasure.pointer / 2)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(card.spoken)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }

    private func ink(_ theme: Theme) -> Color {
        theme.color(chosen ? Tokens.Color.bg : Tokens.Color.ink)
    }

    private func muted(_ theme: Theme) -> Color {
        chosen ? theme.color(Tokens.Color.bg).opacity(0.78) : theme.color(Tokens.Color.ink2)
    }

    private func top(_ theme: Theme) -> some View {
        HStack(alignment: .center, spacing: 6) {
            Text(card.word)
                .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
                .foregroundStyle(ink(theme))
            Spacer(minLength: 0)
            if card.pickup {
                mark(
                    Words.WaiverNav.pickup, ink: chosen ? Tokens.Color.accentInk : Tokens.Color.accentText,
                    fill: chosen ? theme.color(Tokens.Color.accent) : theme.color(Tokens.Color.accent).opacity(0.18),
                    theme
                )
            }
        }
    }

    private func figures(_ theme: Theme) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(card.figure ?? "")
                .font(Faces.font(.num, size: Tokens.TypeScale.lg, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(ink(theme))
            if let tag = card.tag {
                Text(tag)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs))
                    .foregroundStyle(muted(theme))
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
            }
            Spacer(minLength: 0)
            if card.need {
                mark(
                    Words.WaiverPanel.need, ink: chosen ? Tokens.Color.bg : Tokens.Color.lossInk,
                    fill: chosen ? theme.color(Tokens.Color.lossInk) : theme.color(Tokens.Color.lossInk).opacity(0.16),
                    theme
                )
            }
        }
    }

    private func mark(_ words: String, ink: ThemedColor, fill: Color, _ theme: Theme) -> some View {
        Text(words)
            .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .bold))
            .foregroundStyle(theme.color(ink))
            .padding(.horizontal, 6)
            .background(Capsule().fill(fill))
            .fixedSize()
    }

    /// The member's figure against the median team's: the tick is the median, at the middle.
    private func meter(_ theme: Theme) -> some View {
        GeometryReader { box in
            ZStack(alignment: .leading) {
                Capsule().fill(chosen ? theme.color(Tokens.Color.bg).opacity(0.3) : theme.color(Tokens.Color.line))
                if let meter = card.meter {
                    Capsule()
                        .fill(theme.color(meter.under ? Tokens.Color.lossInk : Tokens.Color.gainInk))
                        .frame(width: box.size.width * meter.share)
                    Rectangle()
                        .fill(theme.color(chosen ? Tokens.Color.bg : Tokens.Color.ink2))
                        .frame(width: 2, height: NavMeasure.meter + 6)
                        .offset(x: box.size.width / 2 - 1)
                }
            }
        }
        .frame(height: NavMeasure.meter)
        .padding(.vertical, 3)
        .accessibilityHidden(true)
    }
}
