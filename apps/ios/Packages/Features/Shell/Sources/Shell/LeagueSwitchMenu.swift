import CommishCore
import CommishDesign
import SwiftUI

/// The switch opened, under the bar across the screen as the web's menu is on a phone
/// (LeagueMenu.svelte): every followed league, the selected one first and marked, its platform under
/// its name and its phase beside it where the leagues differ, one tap each to its home. With none
/// followed, where to follow one.
public struct LeagueSwitchMenu: View {
    @Environment(\.colorScheme) private var colorScheme
    private let model: LeagueSwitchModel
    private let choose: (String) -> Void

    public init(model: LeagueSwitchModel, choose: @escaping (String) -> Void) {
        self.model = model
        self.choose = choose
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            if let none = model.none {
                BasisText(none)
            } else {
                Text(model.title)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.xs, weight: .medium))
                    .textCase(.uppercase)
                    .tracking(Tokens.TypeScale.xs * 0.06)
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
                    .accessibilityAddTraits(.isHeader)
                ForEach(model.rows) { row in
                    SwitchRow(row: row) { choose(row.id) }
                }
            }
        }
        .padding(Tokens.Space.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: Tokens.Radius.md)
                .fill(theme.color(Tokens.Color.bg))
                .shadow(color: .black.opacity(colorScheme == .dark ? 0.5 : 0.12), radius: 12, y: 6)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Tokens.Radius.md)
                .strokeBorder(theme.color(Tokens.Color.lineStrong), lineWidth: 1)
        )
    }
}

/// One league: its name with its phase at the name's end, its platform on the line under.
struct SwitchRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let row: LeagueSwitchRow
    let choose: () -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        Button(action: choose) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s2) {
                    Text(row.name)
                        .font(Faces.font(.ui, size: Tokens.TypeScale.md, weight: .semibold))
                        .foregroundStyle(theme.color(Tokens.Color.ink))
                        .fixedSize(horizontal: false, vertical: true)
                    if let phase = row.phase {
                        Text(phase)
                            .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .medium))
                            .foregroundStyle(theme.color(Tokens.Color.ink2))
                            .lineLimit(1)
                            .layoutPriority(1)
                    }
                }
                Text(row.line)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm))
                    .foregroundStyle(theme.color(Tokens.Color.ink2))
            }
            .padding(.vertical, Tokens.Space.s2)
            .padding(.horizontal, Tokens.Space.s3)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: Tokens.Radius.sm)
                    .fill(row.selected ? theme.color(Tokens.Color.surface) : .clear)
            )
            .overlay(alignment: .leading) {
                if row.selected {
                    Rectangle().fill(theme.color(Tokens.Color.accent)).frame(width: 3)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(row.selected ? .isSelected : [])
    }
}
