import BoxScore
import CommishAPI
import CommishCore
import CommishDesign
import SwiftUI

/// The heads: Player, Proj (once the week's projection is read), Beats, each a button that sorts the
/// table by it (WaiverTable.svelte's sort buttons); the sorted head is in the ink with its caret, up
/// when lowest first.
struct WaiverHeadRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let projected: Bool
    let sort: WaiverSort
    let onSort: (WaiverSortKey) -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(spacing: 0) {
            head(Words.Box.player, .name, alignment: .leading).frame(maxWidth: .infinity, alignment: .leading)
            if projected {
                head(Words.Box.proj, .proj, alignment: .trailing).frame(width: WaiverColumn.proj, alignment: .trailing)
            }
            head(Words.Waivers.beats, .beats, alignment: .trailing)
                .frame(width: WaiverColumn.beats, alignment: .trailing)
            Color.clear.frame(width: WaiverColumn.act, height: 1)
        }
        .padding(.horizontal, Tokens.Space.s2)
        .frame(minHeight: 32)
        .background(theme.color(Tokens.Color.bg))
        .overlay(alignment: .bottom) { Hairline() }
    }

    private func head(_ words: String, _ key: WaiverSortKey, alignment _: Alignment) -> some View {
        let theme = Theme(colorScheme)
        let lit = sort.key == key
        return Button { onSort(key) } label: {
            HStack(spacing: 3) {
                Text(words)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .semibold))
                    .textCase(.uppercase)
                    .tracking(Tokens.TypeScale.xs * 0.06)
                    .foregroundStyle(theme.color(lit ? Tokens.Color.ink : Tokens.Color.ink3))
                if lit {
                    Image(systemName: sort.down ? "chevron.down" : "chevron.up")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(theme.color(Tokens.Color.accentText))
                }
            }
            .frame(minHeight: 32)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(words)
        .accessibilityValue(lit ? (sort.down ? "descending" : "ascending") : "")
    }
}

/// The position chips over the table, every position first (WaiverScreen.svelte's ChipGroup, one line
/// that scrolls on a phone), the name search under them, and why a position could not be read.
struct FiltersView: View {
    @Environment(\.colorScheme) private var colorScheme
    let positions: [PositionChip]
    let chosen: WaiverPosition?
    let choose: (WaiverPosition?) -> Void
    let query: String
    let find: @MainActor (String) -> Void
    let problem: String?
    /// Draws the chips and the field at rest (a snapshot draws no scroll view or text field contents).
    var still = false

    var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            if still {
                chips
            } else {
                ScrollView(.horizontal, showsIndicators: false) { chips }
            }
            HStack(spacing: Tokens.Space.s2) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
                if still {
                    Text(query.isEmpty ? Words.Waivers.find : query)
                        .foregroundStyle(theme.color(query.isEmpty ? Tokens.Color.ink3 : Tokens.Color.ink))
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    TextField(Words.Waivers.find, text: Binding(get: { query }, set: { find($0) }))
                    #if os(iOS)
                        .textInputAutocapitalization(.never)
                    #endif
                        .autocorrectionDisabled()
                        .submitLabel(.search)
                }
            }
            .font(Faces.font(.ui, size: Tokens.TypeScale.md))
            .padding(.horizontal, Tokens.Space.s3)
            .frame(height: 36)
            .background(theme.color(Tokens.Color.surface))
            .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md)
                .strokeBorder(theme.color(Tokens.Color.lineStrong)))
            .accessibilityLabel(Words.Waivers.find)
            if let problem {
                Text(problem)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.lossInk))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var chips: some View {
        HStack(spacing: Tokens.Space.s2) {
            chip(Words.InSeason.all, lit: chosen == nil) { choose(nil) }
            ForEach(positions) { position in
                chip(position.word, lit: chosen == position.position) { choose(position.position) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Words.InSeason.position)
    }

    private func chip(_ words: String, lit: Bool, action: @escaping () -> Void) -> some View {
        let theme = Theme(colorScheme)
        return Button(action: action) {
            Text(words)
                .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                .foregroundStyle(theme.color(lit ? Tokens.Color.accentInk : Tokens.Color.ink2))
                .padding(.horizontal, Tokens.Space.s3)
                .frame(minHeight: 30)
                .background(Capsule().fill(theme.color(lit ? Tokens.Color.accent : Tokens.Color.surface)))
                .overlay(Capsule().strokeBorder(theme.color(lit ? Tokens.Color.accent : Tokens.Color.lineStrong)))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(lit ? .isSelected : [])
    }
}
