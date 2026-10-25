import CommishCore
import CommishDesign
import SwiftUI

/// The top bar on every tab, the web's phone bar (Shell.svelte at 760 px and under): the league switch
/// across the first row with the account's way in in its last cell, the player search across the
/// second. The caller owns what is typed and whether the switch is open.
public struct TopBar: View {
    @Environment(\.colorScheme) private var colorScheme
    private let face: String
    private let open: Bool
    private let query: Binding<String>
    private let still: Bool
    private let actions: TopBarActions

    /// `still` draws the search at rest, its words where a field would be, for a render with no
    /// keyboard (the snapshot).
    public init(face: String, open: Bool, query: Binding<String>, still: Bool = false, actions: TopBarActions) {
        self.face = face
        self.open = open
        self.query = query
        self.still = still
        self.actions = actions
    }

    public var body: some View {
        let theme = Theme(colorScheme)
        VStack(spacing: Tokens.Space.s2) {
            HStack(spacing: Tokens.Space.s2) {
                SwitchFace(face: face, open: open, toggle: actions.toggleSwitch)
                AccountButton(action: actions.openAccount)
            }
            SearchField(query: query, still: still, submit: actions.search)
        }
        .padding(.horizontal, Tokens.Space.s4)
        .padding(.vertical, Tokens.Space.s2)
        .background(theme.color(Tokens.Color.shell))
        .overlay(alignment: .bottom) {
            Rectangle().fill(theme.color(Tokens.Color.shellLine)).frame(height: 1)
        }
    }
}

/// What the bar's controls do: open or close the switch, open the account, search for what was typed.
public struct TopBarActions {
    let toggleSwitch: () -> Void
    let openAccount: () -> Void
    let search: (String) -> Void

    public init(
        toggleSwitch: @escaping () -> Void, openAccount: @escaping () -> Void, search: @escaping (String) -> Void
    ) {
        self.toggleSwitch = toggleSwitch
        self.openAccount = openAccount
        self.search = search
    }
}

/// The switch's face: the shown league's name, cut at its end, with the switch's flag and chevron;
/// one width at every state, so the bar never moves when the name arrives (LeagueSwitch.svelte).
struct SwitchFace: View {
    @Environment(\.colorScheme) private var colorScheme
    let face: String
    let open: Bool
    let toggle: () -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        Button(action: toggle) {
            HStack(spacing: Tokens.Space.s2) {
                Image(systemName: "flag").font(.system(size: 15)).foregroundStyle(theme.color(Tokens.Color.accentText))
                Text(face)
                    .font(Faces.font(.ui, size: Tokens.TypeScale.sm, weight: .semibold))
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.down").font(.system(size: 13))
                    .foregroundStyle(theme.color(Tokens.Color.ink3))
            }
            .padding(.horizontal, Tokens.Space.s3)
            .frame(height: 40)
            .background(RoundedRectangle(cornerRadius: Tokens.Radius.md).fill(theme.color(Tokens.Color.surface)))
            .overlay(
                RoundedRectangle(cornerRadius: Tokens.Radius.md)
                    .strokeBorder(theme.color(open ? Tokens.Color.ink : Tokens.Color.lineStrong), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(face)
        .accessibilityHint(Words.Shell.yourLeagues)
        .accessibilityAddTraits(open ? .isSelected : [])
    }
}

/// The account's way in, the bar's last cell (the rail's foot at a desk).
struct AccountButton: View {
    @Environment(\.colorScheme) private var colorScheme
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "person.crop.circle")
                .font(.system(size: 22))
                .foregroundStyle(Theme(colorScheme).color(Tokens.Color.ink2))
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(PhoneRail.account.label)
    }
}

/// The player search across the bar: what is typed opens the Players screen with it.
struct SearchField: View {
    @Environment(\.colorScheme) private var colorScheme
    let query: Binding<String>
    let still: Bool
    let submit: (String) -> Void

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(spacing: Tokens.Space.s2) {
            Image(systemName: "magnifyingglass").font(.system(size: 14)).foregroundStyle(theme.color(Tokens.Color.ink3))
            if still {
                Text(query.wrappedValue.isEmpty ? Words.Shell.searchPlayers : query.wrappedValue)
                    .foregroundStyle(theme.color(query.wrappedValue.isEmpty ? Tokens.Color.ink3 : Tokens.Color.ink))
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                TextField(Words.Shell.searchPlayers, text: query)
                    .textFieldStyle(.plain)
                    .foregroundStyle(theme.color(Tokens.Color.ink))
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    .onSubmit { submit(query.wrappedValue) }
            }
        }
        .font(Faces.font(.ui, size: Tokens.TypeScale.md))
        .padding(.horizontal, Tokens.Space.s3)
        .frame(height: 40)
        .background(RoundedRectangle(cornerRadius: Tokens.Radius.md).fill(theme.color(Tokens.Color.surface)))
        .overlay(
            RoundedRectangle(cornerRadius: Tokens.Radius.md)
                .strokeBorder(theme.color(Tokens.Color.line), lineWidth: 1)
        )
        .accessibilityLabel(Words.Shell.searchPlayers)
    }
}
